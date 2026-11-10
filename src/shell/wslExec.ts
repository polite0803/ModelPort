/**
 * The two transports every WSL install/upgrade needs: `wsl.exe` and HTTPS.
 *
 * Extracted so first install (`wslInstall.ts`) and upgrade (`updater.ts`) share one
 * checksum rule, one path translation and one decoder. A second copy is how "refuses an
 * artifact without a `.sha256`" ends up true on one path and false on the other.
 */
import { net } from 'electron'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { parseSha256, type AssetPair } from './updatePlan'
import { decodeWslOutput } from './wslInstallPlan'

const execFileAsync = promisify(execFile)

export { decodeWslOutput }

export const RELEASE_API = 'https://api.github.com/repos/polite0803/ModelPort/releases/latest'

export function releaseFeedUrl(): string {
  const override = process.env.MODELPORT_UPDATE_FEED?.trim()
  if (!override) return RELEASE_API
  const url = new URL(override)
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'
  if (url.protocol !== 'https:' && !local) {
    throw new Error('MODELPORT_UPDATE_FEED must be https (localhost is allowed for tests)')
  }
  return url.toString()
}

/**
 * One release-feed read shared by every caller, with a TTL.
 *
 * The feed is anonymous HTTPS, so GitHub caps it at 60 requests per hour per IP. Before this
 * existed the console asked again on startup, on every panel open, on every tray check, before
 * every upgrade and during every WSL install - so one user's own clicking spent the whole
 * quota and every later check reported a bare 403.
 */
const RELEASE_FEED_TTL_MS = 10 * 60 * 1000
/** Fallback when the server states no reset time; asking sooner only burns the quota again. */
const RELEASE_FEED_FAILURE_BACKOFF_MS = 60 * 1000
/** A bogus or far-future reset must not park the console forever. */
const RELEASE_FEED_RETRY_CAP_MS = 60 * 60 * 1000

let releaseFeedSuccess: { url: string; text: string; expiresAt: number } | null = null
let releaseFeedFailure: { url: string; message: string; retryAtMs: number } | null = null

export async function fetchReleaseFeed(): Promise<string> {
  const url = releaseFeedUrl()
  const now = Date.now()
  if (releaseFeedSuccess && releaseFeedSuccess.url === url && releaseFeedSuccess.expiresAt > now) {
    return releaseFeedSuccess.text
  }
  if (releaseFeedFailure && releaseFeedFailure.url === url && releaseFeedFailure.retryAtMs > now) {
    const waitSeconds = Math.ceil((releaseFeedFailure.retryAtMs - now) / 1000)
    throw new Error(`${releaseFeedFailure.message}（已退避，${waitSeconds}s 后才会再次请求）`)
  }
  try {
    const text = await fetchText(url)
    releaseFeedSuccess = { url, text, expiresAt: now + RELEASE_FEED_TTL_MS }
    releaseFeedFailure = null
    return text
  } catch (error) {
    const failure = error as { message?: string; rateLimitResetAtMs?: number }
    const message = failure.message ?? String(error)
    // Honour the server's own reset time when it states one, so the console waits for the
    // window to roll over instead of re-burning the same quota on every click.
    const statedRetryAtMs = failure.rateLimitResetAtMs ?? now + RELEASE_FEED_FAILURE_BACKOFF_MS
    releaseFeedFailure = {
      url,
      message,
      retryAtMs: Math.min(statedRetryAtMs, now + RELEASE_FEED_RETRY_CAP_MS),
    }
    throw error
  }
}

export function wslExecutable(): string {
  const root = process.env.SystemRoot
  const candidate = root ? join(root, 'System32', 'wsl.exe') : ''
  return candidate !== '' && existsSync(candidate) ? candidate : 'wsl.exe'
}

export function wslArgs(distro: string | undefined, root: boolean, command: string[]): string[] {
  const args: string[] = []
  const name = distro?.trim()
  if (name) args.push('-d', name)
  if (root) args.push('-u', 'root')
  args.push('-e', ...command)
  return args
}

export async function runWsl(
  distro: string | undefined,
  root: boolean,
  command: string[],
  timeout = 120_000,
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(wslExecutable(), wslArgs(distro, root, command), {
      encoding: 'buffer',
      windowsHide: true,
      timeout,
      maxBuffer: 16 * 1024 * 1024,
    })
    return {
      stdout: decodeWslOutput(Buffer.from(result.stdout ?? '')),
      stderr: decodeWslOutput(Buffer.from(result.stderr ?? '')),
    }
  } catch (error) {
    const failure = error as { stdout?: unknown; stderr?: unknown; message?: string }
    const stdout = Buffer.isBuffer(failure.stdout) ? decodeWslOutput(failure.stdout) : String(failure.stdout ?? '')
    const stderr = Buffer.isBuffer(failure.stderr) ? decodeWslOutput(failure.stderr) : String(failure.stderr ?? '')
    const detail = stderr.trim() || stdout.trim() || failure.message || String(error)
    // Keep both streams on the thrown error: the install script prints BACKUP= to stdout
    // and the failure reason to stderr, and the caller needs the backup path even then.
    throw Object.assign(new Error(`WSL command failed: ${detail}`), { stdout, stderr })
  }
}

export async function fetchText(url: string): Promise<string> {
  const response = await net.fetch(url, {
    redirect: 'follow',
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'ModelPort' },
  })
  if (!response.ok) {
    // The server's own reason must survive the throw. GitHub answers an exhausted anonymous
    // quota with 403 plus a body naming the IP and a reset time; discarding that body leaves
    // the console reporting a bare "HTTP 403", which is indistinguishable from a permission
    // failure and tells the user nothing they can act on.
    const body = (await response.text().catch(() => '')).trim().slice(0, 400)
    const remaining = response.headers.get('x-ratelimit-remaining')
    const resetHeader = response.headers.get('x-ratelimit-reset')
    const rateLimitResetAtMs = resetHeader === null ? NaN : Number(resetHeader) * 1000
    const details = [
      `HTTP ${response.status} for ${url}`,
      body === '' ? '' : `服务端响应：${body}`,
      remaining === null ? '' : `该 IP 本小时剩余配额：${remaining}`,
      Number.isFinite(rateLimitResetAtMs) ? `配额重置时间：${new Date(rateLimitResetAtMs).toISOString()}` : '',
    ].filter(line => line !== '')
    throw Object.assign(new Error(details.join(' | ')), {
      status: response.status,
      ...(Number.isFinite(rateLimitResetAtMs) ? { rateLimitResetAtMs } : {}),
    })
  }
  return await response.text()
}

export async function downloadFile(
  url: string,
  destination: string,
  onProgress?: (received: number, total: number | null) => void,
): Promise<void> {
  const response = await net.fetch(url, { redirect: 'follow' })
  if (!response.ok || response.body === null) {
    throw new Error(`HTTP ${response.status} for ${url}`)
  }
  const total = Number(response.headers.get('content-length')) || null
  const reader = response.body.getReader()
  const file = createWriteStream(destination)
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      const chunk = Buffer.from(value)
      received += chunk.byteLength
      if (!file.write(chunk)) await once(file, 'drain')
      onProgress?.(received, total)
    }
    await new Promise<void>((resolve, reject) => {
      file.once('error', reject)
      file.end(() => resolve())
    })
  } catch (error) {
    file.destroy()
    throw error
  }
}

export async function sha256File(path: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('data', chunk => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}

/**
 * Downloads an artifact and its `.sha256`, then verifies. A missing or mismatched checksum
 * is a refusal, never a warning: the daemon side of this runs as root.
 */
export async function verifyDownload(
  pair: AssetPair,
  directory: string,
  onProgress: (received: number, total: number | null) => void,
  onVerify: () => void,
): Promise<string> {
  const assetPath = join(directory, pair.name)
  const checksumPath = join(directory, pair.checksumName)
  await downloadFile(pair.url, assetPath, onProgress)
  await downloadFile(pair.checksumUrl, checksumPath)
  onVerify()
  const expected = parseSha256(readFileSync(checksumPath, 'utf8'), pair.name)
  if (expected === null) {
    throw new Error(`${pair.checksumName} 不是有效的 SHA-256 文件，已拒绝安装`)
  }
  const actual = await sha256File(assetPath)
  if (actual !== expected) {
    throw new Error(`${pair.name} 的 SHA-256 不匹配，已拒绝安装`)
  }
  return assetPath
}

export async function toWslPath(distro: string | undefined, windowsPath: string): Promise<string> {
  try {
    const result = await runWsl(distro, false, ['wslpath', '-u', windowsPath], 20_000)
    const converted = result.stdout.trim()
    if (converted.startsWith('/')) return converted
  } catch {
    // wslpath is normally present; the drive mapping below is the fallback.
  }
  if (!/^[A-Za-z]:[\\/]/.test(windowsPath)) {
    throw new Error(`无法把 Windows 路径映射进 WSL：${windowsPath}`)
  }
  const drive = windowsPath.slice(0, 1).toLowerCase()
  const rest = windowsPath.slice(2).replace(/\\/g, '/')
  return `/mnt/${drive}${rest.startsWith('/') ? rest : `/${rest}`}`
}
