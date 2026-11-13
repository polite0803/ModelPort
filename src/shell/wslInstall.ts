/**
 * WSL first install: gateway absent → install it (Node runtime included), then hand the
 * console the origin and the management secret.
 *
 * The upgrade path (`updater.ts`) assumes a systemd unit already exists and fails without
 * one; that is why this is a separate flow rather than a branch of it. Everything it writes
 * as root is planned in `wslInstallPlan.ts` so the scripts can be asserted without a WSL host.
 */
import { app, net } from 'electron'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { archFromUname, selectAsset, type DaemonArch } from './updatePlan'
import {
  downloadFile,
  fetchLatestRelease,
  fetchText,
  runWsl,
  sha256File,
  toWslPath,
  verifyDownload,
} from './wslExec'
import {
  buildFirstInstallRollbackScript,
  buildFirstInstallScript,
  parseInitHostHandshake,
  parseNodeMajor,
  parseShasums,
  planNodeProvision,
  systemdUsable,
} from './wslInstallPlan'

const SERVICE = 'modelport'
const INSTALL_DIR = '/opt/modelport'

export interface WslInstallProgress {
  stage: 'detecting' | 'downloading' | 'installing' | 'starting' | 'done' | 'error'
  message: string
  percent?: number
}

export interface WslProbe {
  available: boolean
  systemd: boolean
  installed: boolean
  active: boolean
  nodeMajor: number | null
  arch: DaemonArch | null
  error?: string
}

export interface WslInstallResult {
  ok: boolean
  origin?: string
  port?: number
  /** Returned once, to be sealed by the console; never logged. */
  secret?: string
  apiKey?: string
  error?: string
}

/** Cheap, non-destructive checks: is WSL usable, is a gateway already installed here. */
export async function probeWslGateway(distro?: string): Promise<WslProbe> {
  const empty: WslProbe = { available: false, systemd: false, installed: false, active: false, nodeMajor: null, arch: null }
  let uname: { stdout: string }
  try {
    uname = await runWsl(distro, false, ['uname', '-m'], 20_000)
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : String(error) }
  }
  const arch = archFromUname(uname.stdout)
  const systemdResult = await runWsl(distro, true, ['sh', '-lc', 'systemctl is-system-running || true'], 20_000)
    .then(result => systemdUsable(result.stdout))
    .catch(() => false)
  const nodeResult = await runWsl(distro, true, ['sh', '-lc', 'command -v node >/dev/null 2>&1 && node -v || true'], 20_000)
    .then(result => parseNodeMajor(result.stdout))
    .catch(() => null)
  const installed = await runWsl(distro, true, ['systemctl', 'cat', `${SERVICE}.service`], 20_000)
    .then(result => result.stdout.includes('ExecStart='))
    .catch(() => false)
  const active = installed
    ? await runWsl(distro, true, ['systemctl', 'is-active', SERVICE], 20_000)
        .then(result => result.stdout.trim() === 'active')
        .catch(() => false)
    : false
  return { available: true, systemd: systemdResult, installed, active, nodeMajor: nodeResult, arch }
}

async function waitForHealth(origin: string, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await net.fetch(new URL('/health', origin).toString(), {
        signal: AbortSignal.timeout(1_500),
      })
      if (response.ok) return true
    } catch {
      // Still booting (or a bind failure the wait below turns into an error).
    }
    await new Promise(resolve => setTimeout(resolve, 600))
  }
  return false
}

export async function installWslGateway(input: {
  distro?: string
  port?: number
  onProgress?: (progress: WslInstallProgress) => void
}): Promise<WslInstallResult> {
  const report = (stage: WslInstallProgress['stage'], message: string, percent?: number): void => {
    input.onProgress?.({ stage, message, ...(percent === undefined ? {} : { percent }) })
  }
  const port = input.port ?? 8080

  try {
    report('detecting', '正在检查 WSL 与已安装的网关…')
    const probe = await probeWslGateway(input.distro)
    if (!probe.available) {
      return {
        ok: false,
        error:
          `这台机器上没有可用的 WSL：${probe.error ?? 'unknown'}\n` +
          '先执行 `wsl --install`（需要管理员并重启），再回来安装。',
      }
    }
    if (!probe.arch) {
      return { ok: false, error: '无法识别 WSL 的 CPU 架构（uname -m）' }
    }
    if (!probe.systemd) {
      return {
        ok: false,
        error:
          '这个发行版没有以 systemd 启动，服务装上去也无法常驻。\n' +
          '在 /etc/wsl.conf 写入 [boot]\\nsystemd=true，执行 `wsl --shutdown` 后重试。',
      }
    }
    if (probe.installed) {
      return { ok: false, error: '这个发行版里已经装过网关；请用「检查更新」升级，而不是重新安装。' }
    }

    report('detecting', '正在读取发布版本…')
    const release = await fetchLatestRelease()
    const assetName = `modelport-daemon-${release.version}-${probe.arch}.tar.gz`
    const daemon = selectAsset(release, assetName)
    if (!daemon) {
      return {
        ok: false,
        error: `发布里没有可安装的 ${assetName}，或缺少它的 .sha256；已拒绝安装。`,
      }
    }
    const nodePlan = planNodeProvision({ nodeMajor: probe.nodeMajor, arch: probe.arch })

    const workDir = join(app.getPath('temp'), `modelport-wsl-${release.version}`)
    rmSync(workDir, { recursive: true, force: true })
    mkdirSync(workDir, { recursive: true })

    report('downloading', `正在下载 daemon ${release.version}…`, 0)
    const tarball = await verifyDownload(
      daemon,
      workDir,
      (received, total) => {
        const percent = total ? Math.min(100, (received / total) * 100) : undefined
        report('downloading', '正在下载 daemon…', percent)
      },
      () => report('downloading', '正在校验 daemon 安装包…'),
    )

    let nodeTarball: string | null = null
    if (nodePlan.needed) {
      report('downloading', `正在下载 Node ${nodePlan.version}（WSL 里没有可用版本）…`, 0)
      const nodePath = join(workDir, nodePlan.fileName)
      const shasumsText = await fetchText(nodePlan.checksumsUrl)
      const expected = parseShasums(shasumsText, nodePlan.fileName)
      if (!expected) {
        return { ok: false, error: `Node 的校验清单里没有 ${nodePlan.fileName}；已拒绝安装。` }
      }
      await downloadWithProgress(nodePlan.url, nodePath, report)
      const actual = await sha256File(nodePath)
      if (actual !== expected) {
        return { ok: false, error: 'Node 安装包 SHA-256 不匹配；已拒绝安装。' }
      }
      nodeTarball = nodePath
    }

    const tarballInWsl = await toWslPath(input.distro, tarball)
    const nodeInWsl = nodeTarball ? await toWslPath(input.distro, nodeTarball) : null
    const script = buildFirstInstallScript({
      tarballPath: tarballInWsl,
      nodeTarballPath: nodeInWsl,
      existingNodePath: nodeTarball ? null : '/usr/bin/node',
      installDir: INSTALL_DIR,
      service: SERVICE,
      port,
    })

    report('installing', `正在安装到 ${INSTALL_DIR}（root）…`)
    let output = ''
    try {
      output = (await runWsl(input.distro, true, ['sh', '-lc', script], 300_000)).stdout
    } catch (error) {
      const stdout = (error as { stdout?: string }).stdout ?? ''
      report('error', '安装失败，正在回滚…')
      try {
        await runWsl(input.distro, true, ['sh', '-lc', buildFirstInstallRollbackScript({
          installDir: INSTALL_DIR,
          service: SERVICE,
        })], 120_000)
      } catch {
        // The original failure is what the operator needs; a rollback failure is secondary.
      }
      return {
        ok: false,
        error: `${error instanceof Error ? error.message : String(error)}` +
          (stdout.trim() ? `\n${stdout.trim()}` : '') +
          '\n已回滚：临时文件与服务单元已移除；~/.modelport 数据未动。',
      }
    }

    const handshake = parseInitHostHandshake(output)
    if (!handshake) {
      return { ok: false, error: '安装脚本没有返回管理口令（--init-host 输出无法解析）；请检查服务状态。' }
    }
    const effectivePort = handshake.port ?? port
    const origin = `http://127.0.0.1:${effectivePort}`
    report('starting', '正在等待网关应答…')
    const healthy = await waitForHealth(origin)
    if (!healthy) {
      return {
        ok: false,
        error: `网关已安装但没有应答（${origin}/health）。可在 WSL 里执行 systemctl status ${SERVICE} 查看原因。`,
      }
    }

    rmSync(workDir, { recursive: true, force: true })
    report('done', `已安装 ${release.version}，网关在 ${origin}`)
    return {
      ok: true,
      origin,
      port: effectivePort,
      secret: handshake.secret,
      ...(handshake.apiKey ? { apiKey: handshake.apiKey } : {}),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    report('error', message)
    return { ok: false, error: message }
  }
}

async function downloadWithProgress(
  url: string,
  destination: string,
  report: (stage: WslInstallProgress['stage'], message: string, percent?: number) => void,
): Promise<void> {
  await downloadFile(url, destination, (received, total) => {
    const percent = total ? Math.min(100, (received / total) * 100) : undefined
    report('downloading', '正在下载 Node…', percent)
  })
}
