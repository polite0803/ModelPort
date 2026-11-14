/**
 * In-UI online update for the Docker-deployed gateway (opt-in docker.sock mount).
 *
 * The daemon is PID 1 of its container: it can download, verify and `docker load`
 * the new image, but `docker stop` on itself would kill the orchestrator mid-swap.
 * So the last step is handed to a one-shot helper container from the RUNNING daemon's
 * own image (`/app/update-swap.cjs`, guaranteed present there): stop old -> start new
 * -> probe /health -> rollback on failure. The helper sleeps a grace period first so
 * this RPC response reaches the browser before the daemon dies.
 *
 * Without the socket the surface reports which absence it is (not-docker /
 * no-socket / socket-denied) and points at scripts/upgrade-docker.sh - never a
 * button that pretends to work.
 */
import { accessSync, constants, createReadStream, createWriteStream, existsSync, readFileSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { getHost } from '../runtime/host'
import { storeManager } from '../store/store'
import { isNewer, parseSha256, releaseFromTag, selectAsset } from '../../shell/updatePlan'
import type { DockerUpdateCheck, DockerUpdateStatus } from '../../shared/dockerUpdate'
import {
  dockerArchFromNodeArch,
  dockerDaemonAssetName,
  dockerUpdateCapability,
  recreateConfig,
  selfContainerId,
  swapHelperBody,
  swapHelperEnv,
  type ContainerInspect,
} from './dockerUpdatePlan'
import { DOCKER_SOCKET, dockerApi, dockerLoadImage } from './dockerSocket'
import { fetchLatestDockerRelease } from './updateFeed'

const HELPER_NAME = 'modelport-update-swap'
const PROBE_TIMEOUT_MS = 60_000
const GRACE_MS = 3_000

let state: DockerUpdateStatus = {
  phase: 'idle',
  capability: 'ok',
  current: '',
  targetVersion: null,
  error: null,
}
let running = false

export function dockerUpdateCapabilityNow(): DockerUpdateStatus['capability'] {
  const inDocker = existsSync('/.dockerenv')
  const socketPresent = existsSync(DOCKER_SOCKET)
  let socketAccessible = false
  if (socketPresent) {
    try {
      accessSync(DOCKER_SOCKET, constants.R_OK | constants.W_OK)
      socketAccessible = true
    } catch {
      socketAccessible = false
    }
  }
  return dockerUpdateCapability({ inDocker, socketPresent, socketAccessible })
}

function absenceMessage(capability: DockerUpdateStatus['capability']): string {
  switch (capability) {
    case 'not-docker':
      return '此网关不是 Docker 容器部署；在线更新仅适用于 Docker 形态，其他部署请用 scripts/upgrade-docker.sh 或重新安装'
    case 'no-socket':
      return '容器未挂载 /var/run/docker.sock，无法在线更新。重新部署时加 -v /var/run/docker.sock:/var/run/docker.sock（并 --group-add docker 组 GID），或改用 scripts/upgrade-docker.sh'
    case 'socket-denied':
      return 'docker.sock 已挂载但当前用户无权读写：重新部署时加 --group-add <docker 组 GID>（宿主机 getent group docker 查）'
    default:
      return ''
  }
}

export function getDockerUpdateStatus(): DockerUpdateStatus {
  return { ...state, capability: dockerUpdateCapabilityNow(), current: getHost().getVersion() }
}

export async function checkDockerUpdate(): Promise<DockerUpdateCheck> {
  const capability = dockerUpdateCapabilityNow()
  const current = getHost().getVersion()
  if (capability !== 'ok') {
    return { capability, current, latest: '', newer: false, pageUrl: '' }
  }
  const release = await fetchLatestDockerRelease()
  return {
    capability,
    current,
    latest: release.version,
    newer: isNewer(release.version, current),
    pageUrl: release.pageUrl,
  }
}

async function downloadTo(url: string, path: string): Promise<void> {
  const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'ModelPort' } })
  if (!response.ok || response.body === null) {
    throw new Error(`下载失败 HTTP ${response.status}: ${url}`)
  }
  await pipeline(
    Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream),
    createWriteStream(path),
  )
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

interface DockerCreateResult { Id: string; Warnings?: string[] }

/**
 * Runs the whole update. Returns once the helper container is started (phase
 * 'swapping'); the daemon dies seconds later and the new one comes up on the same
 * ports. Every pre-swap failure restores the old container's name and removes any
 * staged replacement, so a failed attempt leaves the running gateway untouched.
 */
export async function applyDockerUpdate(version?: string): Promise<DockerUpdateStatus> {
  const capability = dockerUpdateCapabilityNow()
  if (capability !== 'ok') throw new Error(absenceMessage(capability))
  if (running) throw new Error('已有更新正在进行')
  const arch = dockerArchFromNodeArch(process.arch)
  if (arch === null) throw new Error(`不支持的容器架构: ${process.arch}`)

  running = true
  const current = getHost().getVersion()
  state = { phase: 'downloading', capability, current, targetVersion: null, error: null }
  let workDir: string | null = null
  let renamed = false
  let createdNewId: string | null = null
  let oldName = ''
  try {
    const release = version !== undefined && version.trim() !== ''
      ? releaseFromTag(`v${version.trim().replace(/^v/i, '')}`)
      : await fetchLatestDockerRelease()
    const target = release.version
    state = { ...state, targetVersion: target }
    if (!isNewer(target, current) && version === undefined) {
      throw new Error(`已是最新版本 ${current}`)
    }
    const assetName = dockerDaemonAssetName(target, arch)
    const pair = selectAsset(release, assetName)
    if (pair === null) throw new Error(`Release ${target} 缺少 ${assetName} 或其 .sha256`)

    workDir = await mkdtemp(join(tmpdir(), 'modelport-update-'))
    const tarPath = join(workDir, assetName)
    await downloadTo(pair.url, tarPath)
    state = { ...state, phase: 'verifying' }
    const checksumText = await (await fetch(pair.checksumUrl, { headers: { 'user-agent': 'ModelPort' } })).text()
    const expected = parseSha256(checksumText, assetName)
    if (expected === null) throw new Error(`${pair.checksumName} 不是合法的 sha256 清单`)
    const actual = await sha256Of(tarPath)
    if (actual !== expected) throw new Error('镜像包 sha256 与发布清单不一致，已拒绝安装')

    state = { ...state, phase: 'loading' }
    await dockerLoadImage(tarPath)
    const image = `modelport-daemon:${target}`
    await dockerApi('GET', `/images/${encodeURIComponent(image)}/json`)

    state = { ...state, phase: 'staging' }
    const cgroup = existsSync('/proc/self/cgroup') ? readFileSync('/proc/self/cgroup', 'utf8') : ''
    const selfId = selfContainerId(cgroup, hostname())
    if (selfId === null) throw new Error('无法识别自身容器（/proc/self/cgroup 与 hostname 都不含容器 id）')
    const inspect = await dockerApi<ContainerInspect>('GET', `/containers/${selfId}/json`)
    oldName = inspect.Name.replace(/^\//, '')
    const prevName = `${oldName}-prev`

    // A leftover -prev from an earlier swap is the replaced old version; drop it so
    // the rename below cannot collide. A leftover helper is a crashed earlier attempt.
    await removeContainerIfExists(prevName)
    await removeContainerIfExists(HELPER_NAME)

    await dockerApi('POST', `/containers/${selfId}/rename?name=${encodeURIComponent(prevName)}`)
    renamed = true
    const created = await dockerApi<DockerCreateResult>('POST', `/containers/create?name=${encodeURIComponent(oldName)}`, {
      ...recreateConfig(inspect, image),
    })
    createdNewId = created.Id

    const config = storeManager.getConfig()
    const httpPort = config.proxyPort
    const scheme: 'http' | 'https' = httpPort > 0 ? 'http' : 'https'
    const port = httpPort > 0 ? httpPort : (config.httpsPort || 8443)
    const networkMode = recreateConfig(inspect, image).HostConfig.NetworkMode
    // The helper runs as the image's `node` user; the mounted sock is root:docker 660,
    // so it needs the socket's group as a supplementary group or every API call 403s.
    const socketGid = String(statSync(DOCKER_SOCKET).gid)
    const helper = await dockerApi<DockerCreateResult>('POST', `/containers/create?name=${encodeURIComponent(HELPER_NAME)}`, swapHelperBody({
      // By stable id, not the target tag: the target may lack update-swap.cjs, and a
      // same-tag load retags the target over this image. See swapHelperBody.
      selfImageId: inspect.Image,
      env: swapHelperEnv({
        oldName: prevName,
        newName: oldName,
        port,
        scheme,
        probeHost: networkMode === 'host' ? '127.0.0.1' : '',
        timeoutMs: PROBE_TIMEOUT_MS,
        graceMs: GRACE_MS,
      }),
      socketPath: DOCKER_SOCKET,
      socketGid,
      networkMode,
    }))
    await dockerApi('POST', `/containers/${helper.Id}/start`)
    state = { ...state, phase: 'swapping' }
    return { ...state }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Undo the staging so a failed attempt leaves the running gateway untouched.
    if (createdNewId !== null) {
      await dockerApi('DELETE', `/containers/${createdNewId}?force=true`).catch(() => undefined)
    }
    if (renamed && oldName !== '') {
      const selfId = selfContainerId(
        existsSync('/proc/self/cgroup') ? readFileSync('/proc/self/cgroup', 'utf8') : '',
        hostname(),
      )
      if (selfId !== null) {
        await dockerApi('POST', `/containers/${selfId}/rename?name=${encodeURIComponent(oldName)}`).catch(() => undefined)
      }
    }
    state = { ...state, phase: 'failed', error: message }
    throw error
  } finally {
    running = false
    if (workDir !== null) await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function removeContainerIfExists(name: string): Promise<void> {
  try {
    await dockerApi('GET', `/containers/${encodeURIComponent(name)}/json`)
  } catch {
    return // 404: nothing to remove
  }
  await dockerApi('DELETE', `/containers/${encodeURIComponent(name)}?force=true`)
}