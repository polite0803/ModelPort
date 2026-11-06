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
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
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
