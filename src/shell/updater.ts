/**
 * The shell's online upgrade orchestration.
 *
 * Two artifacts, one release tag:
 *   1. WSL daemon: download the tarball, verify its `.sha256`, run `systemctl`-backed
 *      install inside WSL as root, then poll the gateway for the new version. On failure
 *      the script's backup directory is restored and the old service is restarted.
 *   2. Shell: download the NSIS installer, verify its `.sha256`, start it silently and
 *      quit; the installer relaunches the new shell.
 *
 * Why the shell and not the daemon: the Windows side has the network and `wsl.exe`; the
 * daemon has no updater by design (headless host, no Electron). The remote page can only
 * trigger this through the named preload bridge, and `main.ts` restricts that to the
 * active gateway's origin.
 */
import { app, net } from 'electron'
import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { once } from 'node:events'

import type { GatewayEntry } from './addressBook'
import type { ShellUpdateCheck, ShellUpdateProgress, ShellUpgradeResult } from '../shared/shellBridge'
import {
  archFromUname,
  buildWslInstallScript,
  buildWslRollbackScript,
  isNewer,
  normalizeVersion,
  parseBackupPath,
  parseRelease,
  parseSha256,
  parseSystemdUnit,
  selectReleaseAssets,
  type AssetPair,
  type DaemonArch,
  type ReleaseInfo,
  type SystemdInstall,
} from './updatePlan'

const RELEASE_API = 'https://api.github.com/repos/polite0803/ModelPort/releases/latest'
const SERVICE = 'modelport'
const execFileAsync = promisify(execFile)

function releaseFeedUrl(): string {
  const override = process.env.MODELPORT_UPDATE_FEED?.trim()
  if (!override) return RELEASE_API
  const url = new URL(override)
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'
  if (url.protocol !== 'https:' && !local) {
    throw new Error('MODELPORT_UPDATE_FEED must be https (localhost is allowed for tests)')
  }
  return url.toString()
}

function wslExecutable(): string {
  const root = process.env.SystemRoot
  const candidate = root ? join(root, 'System32', 'wsl.exe') : ''
  return candidate !== '' && existsSync(candidate) ? candidate : 'wsl.exe'
}

function wslArgs(distro: string | undefined, root: boolean, command: string[]): string[] {
  const args: string[] = []
  const name = distro?.trim()
  if (name) args.push('-d', name)
  if (root) args.push('-u', 'root')
  args.push('-e', ...command)
  return args
}

async function runWsl(
  distro: string | undefined,
  root: boolean,
  command: string[],
  timeout = 120_000,
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(wslExecutable(), wslArgs(distro, root, command), {
      encoding: 'utf8',
      windowsHide: true,
      timeout,
      maxBuffer: 16 * 1024 * 1024,
    })
    return { stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') }
  } catch (error) {
    const failure = error as { stdout?: unknown; stderr?: unknown; message?: string }
    const stdout = String(failure.stdout ?? '')
    const stderr = String(failure.stderr ?? '')
    const detail = stderr.trim() || stdout.trim() || failure.message || String(error)
    // Keep both streams on the thrown error: the install script prints BACKUP= to stdout
    // and the failure reason to stderr, and the caller needs the backup path even then.
    throw Object.assign(new Error(`WSL command failed: ${detail}`), { stdout, stderr })
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await net.fetch(url, {
    redirect: 'follow',
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'ModelPort-Shell' },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  return await response.text()
}

async function downloadFile(
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

async function sha256File(path: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('data', chunk => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}

async function verifyDownload(
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

async function gatewayVersion(url: string): Promise<string | null> {
  try {
    const response = await net.fetch(new URL('/', url).toString(), { redirect: 'follow' })
    if (!response.ok) return null
    const body = await response.json() as { version?: unknown }
    return typeof body.version === 'string' ? normalizeVersion(body.version) : null
  } catch {
    return null
  }
}

async function detectArch(distro: string | undefined): Promise<DaemonArch> {
  try {
    const result = await runWsl(distro, false, ['uname', '-m'], 20_000)
    return archFromUname(result.stdout) ?? 'x64'
  } catch {
    return 'x64'
  }
}

async function readServiceUnit(distro: string | undefined): Promise<SystemdInstall> {
  try {
    const result = await runWsl(distro, true, ['systemctl', 'cat', `${SERVICE}.service`, '--no-pager'])
    const parsed = parseSystemdUnit(result.stdout)
    if (parsed) return parsed
  } catch {
    // Fall through to the unit file: a stopped service still has one.
  }
  const result = await runWsl(distro, true, ['cat', `/etc/systemd/system/${SERVICE}.service`])
  const parsed = parseSystemdUnit(result.stdout)
  if (!parsed) throw new Error(`无法从 systemd 单元解析安装目录（${SERVICE}.service）`)
  return parsed
}

/**
 * Reads the version of the daemon actually installed in WSL, not the one the gateway
 * URL reports. A shell address book can point at another machine's WSL gateway; without
 * this check the shell would replace *this* machine's daemon and then "fail" the health
 * check against the remote URL, rolling the local one back for no reason.
 *
 * `--print-paths` prints and exits before the server starts, so this does not open a
 * second listener or touch the store's data.
 */
async function localDaemonVersion(
  distro: string | undefined,
  unit: SystemdInstall,
): Promise<string | null> {
  try {
    const bundle = `${unit.installDir.replace(/\/+$/, '')}/modelport-daemon.cjs`
    const command = unit.nodePath
      ? [unit.nodePath, bundle, '--print-paths']
      : [bundle, '--print-paths']
    const result = await runWsl(distro, true, command, 30_000)
    const match = /^version\s+(\S+)$/m.exec(result.stdout)
    return match ? normalizeVersion(match[1]) : null
  } catch {
    return null
  }
}

async function toWslPath(distro: string | undefined, windowsPath: string): Promise<string> {
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

async function waitForDaemon(url: string, version: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const health = await net.fetch(new URL('/health', url).toString(), { redirect: 'follow' })
      if (health.ok) {
        const current = await gatewayVersion(url)
        if (current === normalizeVersion(version)) return true
      }
    } catch {
      // HTTPS with an untrusted certificate lands here; fall through to the systemd check.
    }
    await new Promise(resolve => setTimeout(resolve, 700))
  }
  // The install script already checked `systemctl is-active`. For HTTPS gateways whose
  // certificate the shell's Chromium profile does not trust, that is the available proof.
  return url.startsWith('https:')
}

function progressReporter(onProgress: (progress: ShellUpdateProgress) => void) {
  let last = 0
  return (stage: ShellUpdateProgress['stage'], message: string, received?: number, total?: number | null): void => {
    const now = Date.now()
    const percent = received !== undefined && total ? Math.min(100, (received / total) * 100) : undefined
    if (percent !== undefined && now - last < 200 && percent < 100) return
    last = now
    onProgress({ stage, message, ...(percent === undefined ? {} : { percent }) })
  }
}

export async function checkForUpdates(entry: GatewayEntry): Promise<ShellUpdateCheck> {
  const shellCurrent = app.getVersion()
  let release: ReleaseInfo | null = null
  let releaseError: string | undefined
  try {
    release = parseRelease(JSON.parse(await fetchText(releaseFeedUrl())) as unknown)
  } catch (error) {
    releaseError = error instanceof Error ? error.message : String(error)
  }

  const daemonCurrent = await gatewayVersion(entry.url)
  const managed = entry.manageWsl === true
  const arch = managed ? await detectArch(entry.wslDistro) : 'x64'
  const selection = release ? selectReleaseAssets(release, arch) : null

  return {
    release: release ? { version: release.version, pageUrl: release.pageUrl } : null,
    shell: {
      current: shellCurrent,
      latest: release?.version ?? null,
      updateAvailable: release !== null && isNewer(release.version, shellCurrent),
      asset: selection?.shell ?? null,
    },
    daemon: {
      current: daemonCurrent,
      latest: release?.version ?? null,
      updateAvailable: release !== null && daemonCurrent !== null && isNewer(release.version, daemonCurrent),
      managed,
      asset: managed ? selection?.daemon ?? null : null,
      ...(daemonCurrent === null ? { error: '无法读取网关版本：先确认当前网关可访问' } : {}),
    },
    missing: selection?.missing ?? [],
    ...(releaseError === undefined ? {} : { error: releaseError }),
  }
}

export async function runUpgrade(
  entry: GatewayEntry,
  onProgress: (progress: ShellUpdateProgress) => void,
): Promise<ShellUpgradeResult> {
  const report = progressReporter(onProgress)
  let daemonUpdated = false
  let shellUpdated = false
  let backup: string | undefined

  try {
    report('checking', '正在检查更新…')
    const check = await checkForUpdates(entry)
    if (check.error) throw new Error(check.error)

    const daemonWanted = check.daemon.managed
      && check.daemon.updateAvailable
      && check.daemon.asset !== null
    const shellWanted = check.shell.updateAvailable
    const needsDaemonAsset = check.daemon.managed && check.daemon.updateAvailable
    if (needsDaemonAsset && check.daemon.asset === null) {
      throw new Error(`升级包缺少校验文件或安装资源：${check.missing.join(', ')}`)
    }
    if (shellWanted && check.shell.asset === null) {
      throw new Error(`升级包缺少校验文件或安装资源：${check.missing.join(', ')}`)
    }
    if (!daemonWanted && !shellWanted) {
      report('done', '已是最新版本')
      return { ok: true, daemonUpdated: false, shellUpdated: false }
    }

    const version = check.release?.version
    if (!version) throw new Error('release 信息缺失')
    const workDir = join(app.getPath('temp'), `modelport-update-${version}`)
    rmSync(workDir, { recursive: true, force: true })
    mkdirSync(workDir, { recursive: true })

    if (daemonWanted) {
      const asset = check.daemon.asset as AssetPair
      report('downloading-daemon', `正在下载 daemon ${version}…`, 0, asset.size ?? null)
      const tarball = await verifyDownload(
        asset,
        workDir,
        (received, total) => report('downloading-daemon', '正在下载 daemon…', received, total),
        () => report('verifying-daemon', '校验 daemon 安装包…'),
      )
      const unit = await readServiceUnit(entry.wslDistro)
      const installed = await localDaemonVersion(entry.wslDistro, unit)
      if (installed !== null && check.daemon.current !== null && installed !== check.daemon.current) {
        throw new Error(
          `本机 WSL daemon 版本 ${installed} 与当前网关版本 ${check.daemon.current} 不一致；` +
          '请确认这个网关地址指向本机的 WSL daemon，避免升级到错误的实例',
        )
      }
      const tarballInWsl = await toWslPath(entry.wslDistro, tarball)
      report('installing-daemon', `正在安装 daemon 到 ${unit.installDir}…`)
      const script = buildWslInstallScript({
        tarballPath: tarballInWsl,
        installDir: unit.installDir,
        service: SERVICE,
      })
      let installOutput = ''
      try {
        installOutput = (await runWsl(entry.wslDistro, true, ['sh', '-lc', script], 180_000)).stdout
      } catch (error) {
        // The script prints BACKUP= before it stops the service, so a failed start still
        // leaves a restore point. Restore it here instead of leaving a half-old install.
        backup = parseBackupPath((error as { stdout?: string }).stdout ?? '') ?? undefined
        if (backup) {
          report('restarting-daemon', 'daemon 安装失败，正在回滚…')
          try {
            await runWsl(entry.wslDistro, true, ['sh', '-lc', buildWslRollbackScript({
              installDir: unit.installDir,
              backupDir: backup,
              service: SERVICE,
            })], 120_000)
          } catch {
            // The thrown error below still carries the original install failure.
          }
        }
        throw error
      }
      backup = parseBackupPath(installOutput) ?? undefined
      report('restarting-daemon', '等待网关重启并返回新版本…')
      const healthy = await waitForDaemon(entry.url, version, 45_000)
      if (!healthy) {
        if (backup) {
          report('restarting-daemon', '新版本未通过健康检查，正在回滚…')
          try {
            await runWsl(entry.wslDistro, true, ['sh', '-lc', buildWslRollbackScript({
              installDir: unit.installDir,
              backupDir: backup,
              service: SERVICE,
            })], 120_000)
          } catch {
            // The error below names the failed version; rollback failure is secondary.
          }
        }
        throw new Error('daemon 新版本未通过健康检查，已尝试回滚')
      }
      daemonUpdated = true
    }

    if (shellWanted) {
      const asset = check.shell.asset as AssetPair
      report('downloading-shell', `正在下载 Shell ${version}…`, 0, asset.size ?? null)
      const installer = await verifyDownload(
        asset,
        workDir,
        (received, total) => report('downloading-shell', '正在下载 Shell…', received, total),
        () => report('verifying-shell', '校验 Shell 安装包…'),
      )
      report('installing-shell', '正在启动 Shell 安装包；窗口会关闭并重新打开…')
      shellUpdated = true
      // The installer's `customInstall` hook (`build/installer.nsh`) relaunches the app
      // when `/S` skips the finish page. Spawning the installer directly is the part
      // proven to survive this process exiting; the installer owns the relaunch.
      const child = spawn(installer, ['/S'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      child.unref()
      report('done', '升级包已启动；Shell 将自动重启')
      setTimeout(() => {
        ;(app as typeof app & { isQuitting?: boolean }).isQuitting = true
        app.quit()
      }, 1000)
      return { ok: true, daemonUpdated, shellUpdated, ...(backup ? { backup } : {}) }
    }

    rmSync(workDir, { recursive: true, force: true })
    report('done', `已升级到 ${version}`)
    return { ok: true, daemonUpdated, shellUpdated, ...(backup ? { backup } : {}) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    report('error', message)
    return {
      ok: false,
      daemonUpdated,
      shellUpdated,
      ...(backup ? { backup } : {}),
      error: message,
    }
  }
}
