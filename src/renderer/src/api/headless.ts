/**
 * The browser-side transport: the same `electronAPI` object, over HTTP and SSE.
 *
 * When the UI is served by a headless daemon (WSL, a container) there is no preload and
 * therefore no `window.electronAPI`. Rather than a second method list - which is how a
 * screen ends up with a switch nothing reads - this builds the *same* object from
 * `@shared/api` against a wire that calls `/v1/management/rpc` and reads
 * `/v1/management/events`.
 *
 * Two rules this file is holding:
 * - The management secret lives in `sessionStorage`, not `localStorage`: it is a
 *   credential, a tab that closes should not leave it on a shared machine, and putting
 *   it in the URL would land it in every proxy and request log on the way.
 * - A 401 anywhere drops the secret and asks again. Silently continuing with a dead
 *   secret is how "the screen shows an empty list" becomes a mystery.
 */
import { createElectronAPI, type ApiWire } from '@shared/api'
import type { BackupExportOptions, BackupExportResult, BackupPickResult } from '@shared/backup'
import type { ShellBridge } from '@shared/shellBridge'
import { parseEventFrame } from '@shared/sseFrames'
import { IpcChannels } from '../../../main/ipc/channels'
import i18n from '../i18n'

const SECRET_KEY = 'modelport.managementSecret'
const UNAUTHORIZED = 'modelport:unauthorized'

export function hasManagementSecret(): boolean {
  return sessionStorage.getItem(SECRET_KEY) !== null
}

export function setManagementSecret(secret: string): void {
  if (secret.trim() === '') sessionStorage.removeItem(SECRET_KEY)
  else sessionStorage.setItem(SECRET_KEY, secret.trim())
}

function secret(): string {
  return sessionStorage.getItem(SECRET_KEY) ?? ''
}

function forgetSecret(): void {
  sessionStorage.removeItem(SECRET_KEY)
  // Inside the shell, the remembered copy is what just failed: dropping only the tab copy
  // would make every start re-offer a secret the gateway already rejected.
  void shellBridge()?.forgetGatewaySecret(location.origin)
  window.dispatchEvent(new Event(UNAUTHORIZED))
}

/**
 * The Windows shell can keep the secret in the OS keystore; a browser tab must not keep it
 * anywhere. Presence of the bridge is the whole capability check - the main process decides
 * whether a keystore exists and says so per call.
 */
export type { ShellBridge } from '@shared/shellBridge'

function shellBridge(): ShellBridge | null {
  const host = window as unknown as { modelportShell?: Partial<ShellBridge> }
  const bridge = host.modelportShell
  return bridge && typeof bridge.getGatewaySecret === 'function' ? (bridge as ShellBridge) : null
}

export function secretCanRemember(): boolean {
  return shellBridge() !== null
}

/** Returns true when the keystore handed us a usable secret for this origin. */
export async function loadRememberedSecret(): Promise<boolean> {
  const bridge = shellBridge()
  if (!bridge) return false
  try {
    const found = await bridge.getGatewaySecret(location.origin)
    if (found.status !== 'found' || !found.secret) return false
    setManagementSecret(found.secret)
    return true
  } catch {
    // A missing bridge method (older shell build) must fall back to asking, not hang.
    return false
  }
}

export function rememberSecret(secret: string): void {
  void shellBridge()?.setGatewaySecret(location.origin, secret)
}

export const unauthorizedEventName = UNAUTHORIZED

type RpcEnvelope = {
  success: boolean
  data?: unknown
  error?: { code?: string; message?: string; retryAfterMs?: number }
}

/** The channel list the daemon reports, for the connect screen's sanity check. */
export async function probeGateway(): Promise<number> {
  const response = await fetch('/v1/management/rpc/channels', {
    headers: { 'X-Management-Secret': secret() },
  })
  if (response.status === 401) throw new Error('unauthorized')
  if (!response.ok) throw new Error(`gateway responded ${response.status}`)
  const body = (await response.json()) as { data?: string[] }
  return Array.isArray(body.data) ? body.data.length : 0
}

/**
 * 同一次调用的并发合并。Channels 页一次刷新会同时发 list + 每渠道 credits +
 * autoCheckin + identity，`channels:changed` 又会把它们再触发一遍；相同的
 * `channel + args` 在途时只发一次，既省限额也避免两个调用拿到不同的快照。
 *
 * 只合并**完全相同**的调用：不同参数的写入不会被折叠。
 */
const inFlightRpc = new Map<string, Promise<unknown>>()

function rpcKey(channel: string, args: unknown[]): string {
  try {
    return `${channel}\u0000${JSON.stringify(args)}`
  } catch {
    // 含循环引用的参数不该被静默当成同一个调用。
    return `${channel}\u0000<unserializable:${Date.now()}:${Math.random()}>`
  }
}

/** 429 后的等待：优先用网关给的机器可读值，单次最多等 5s，再试一次。 */
function retryDelayMs(response: Response, body: RpcEnvelope | null): number {
  const fromBody = body?.error?.retryAfterMs
  if (typeof fromBody === 'number' && Number.isFinite(fromBody) && fromBody > 0) {
    return Math.min(fromBody, 5000)
  }
  const header = response.headers.get('Retry-After')
  const seconds = header === null ? Number.NaN : Number(header)
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 5000)
  }
  return 1000
}

/**
 * 按调用键的 429 闸门。
 *
 * 只等自己那一次重试是不够的：页面的下一轮刷新（1.5s 去抖）会在同一个被限的桶上
 * 再发一次，于是「等 5 秒再试一次」反而把窗口继续打满（2026-11-09 1542 条 429、
 * 持续 11 分钟就是这么续上的）。网关现在按 `(channel, args)` 分桶，这里就用同一个
 * 键记住窗口释放时间：同键的所有调用一起等，别的桶不受影响。
 *
 * `invoke` 在 `inFlightRpc` 里登记的是**包含闸门等待**的整段 promise，所以重叠的
 * 刷新会共享这一次等待，不会排队制造一串请求。
 */
const gateUntilByKey = new Map<string, number>()

async function waitForGate(key: string): Promise<void> {
  // 循环而不是单次 sleep：等的过程里别的调用可能把同一个键的窗口又往后推了。
  for (;;) {
    const until = gateUntilByKey.get(key)
    if (until === undefined) return
    const wait = until - Date.now()
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait))
      continue
    }
    gateUntilByKey.delete(key)
    return
  }
}

/**
 * 连接类失败的统一标记：请求没拿到管理面应答（网络错误，或代理/重启窗口的
 * 502/503/504 非 JSON 体）。UI 按「网关不可达」做保留旧数据 + 自动重连，
 * 而不是把传输层故障报成某个 channel 的数据错误。
 */
export const GATEWAY_UNREACHABLE = 'gateway_unreachable'

function unreachableError(status: number | null): Error {
  const detail = status === null ? i18n.t('gatewayConnection.network') : `HTTP ${status}`
  return Object.assign(new Error(i18n.t('gatewayConnection.unreachable', { status: detail })), {
    code: GATEWAY_UNREACHABLE,
  })
}

async function invokeOnce(channel: string, args: unknown[], key: string, retried = false): Promise<any> {
  await waitForGate(key)
  let response: Response
  try {
    response = await fetch('/v1/management/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Management-Secret': secret() },
      body: JSON.stringify({ channel, args }),
    })
  } catch {
    throw unreachableError(null)
  }
  if (response.status === 401) {
    forgetSecret()
    throw new Error('management secret rejected')
  }
  const body = (await response.json().catch(() => null)) as RpcEnvelope | null
  // 管理面限流由 UI 自己的轮询触发，不是用户操作失败：等一个窗口再试一次。
  // 第二次仍 429 就按普通失败抛出，避免把一次点击挂成无限重试。
  if (response.status === 429) {
    const delay = retryDelayMs(response, body)
    // 同键之后的调用（包括下一轮刷新）都先等这个窗口，而不是各自再撞一次。
    gateUntilByKey.set(key, Math.max(gateUntilByKey.get(key) ?? 0, Date.now() + delay))
    if (!retried) return invokeOnce(channel, args, key, true)
  }
  if (!body) {
    // 502/503/504 且非 JSON：应答来自代理或重启窗口，不是管理面（管理面错误
    // 永远是 JSON 信封）。2026-11-14 的 235 事故：系统代理在后端不可达时回 502
    // 空体，旧文案把传输层故障报成某个 channel 的数据错误。
    if (response.status === 502 || response.status === 503 || response.status === 504) {
      throw unreachableError(response.status)
    }
    throw new Error(`rpc ${channel}: empty response (${response.status})`)
  }
  if (!body.success) {
    const code = body.error?.code ?? 'rpc_failed'
    // `desktop-only` is a fact about the host, not a failure to retry: the UI can show
    // it as "this install has no window/tray" instead of a generic error toast.
    throw Object.assign(new Error(body.error?.message ?? code), { code })
  }
  return body.data
}

function invoke(channel: string, ...args: unknown[]): Promise<any> {
  const key = rpcKey(channel, args)
  const existing = inFlightRpc.get(key)
  if (existing) return existing

  const pending = invokeOnce(channel, args, key)
  inFlightRpc.set(key, pending)
  const settle = (): void => {
    if (inFlightRpc.get(key) === pending) inFlightRpc.delete(key)
  }
  // 用 then 的两个分支而不是 finally：后者的派生 promise 会再抛一次 rejection。
  pending.then(settle, settle)
  return pending
}

// ---------------------------------------------------------------- backup upload

/**
 * The browser's own file picker, then a byte upload to the gateway.
 *
 * Import is the one action that cannot be a plain RPC call: the backup file lives on the
 * machine showing the page, not on the machine running the gateway. So this transport answers
 * the `pick` capability itself - native dialog from `<input type=file>`, bytes to
 * `/v1/management/backup/stage`, which feeds the same importer the desktop dialog and
 * `--import-backup` use. There is still exactly one thing that knows the backup format.
 */
function chooseBackupFile(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.style.display = 'none'
    let settled = false
    const done = (file: File | null): void => {
      if (settled) return
      settled = true
      input.remove()
      resolve(file)
    }
    input.addEventListener('change', () => done(input.files?.[0] ?? null))
    // Dismissing the dialog is a cancel, not an error: the caller must see `canceled`.
    input.addEventListener('cancel', () => done(null))
    document.body.appendChild(input)
    input.click()
  })
}

async function uploadBackup(): Promise<BackupPickResult> {
  const file = await chooseBackupFile()
  if (!file) return { canceled: true }
  // Read the bytes here rather than handing the File to fetch: the first field report was a
  // 400 (empty body) with no way to tell whether the picker, the read or the transport lost
  // it. With the length in hand, an empty read is named before it leaves the page.
  const bytes = await file.arrayBuffer()
  if (bytes.byteLength === 0) {
    throw Object.assign(new Error(`${file.name} is empty`), { code: 'empty-file' })
  }

  const response = await fetch('/v1/management/backup/stage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Management-Secret': secret() },
    body: bytes,
  })
  if (response.status === 401) {
    forgetSecret()
    throw new Error('management secret rejected')
  }
  const body = (await response.json().catch(() => null)) as RpcEnvelope | null
  if (!body) {
    console.error(`[headless] backup stage: ${bytes.byteLength} bytes sent, gateway replied ${response.status} without an envelope`)
    // A gateway without this route answers with something that is not the envelope; saying
    // so beats reporting the operator's chosen file as unreadable.
    throw Object.assign(new Error(`backup stage unavailable (${response.status})`), {
      code: 'upload-unavailable',
    })
  }
  if (!body.success) {
    console.error(`[headless] backup stage refused: ${JSON.stringify(body.error)} for ${bytes.byteLength} bytes`)
    throw Object.assign(new Error(body.error?.message ?? 'stage_failed'), {
      code: body.error?.code ?? 'stage_failed',
    })
  }
  return body.data as BackupPickResult
}

/**
 * `uploadBackup` 的导出镜像：网关用同一套引擎序列化备份（`delivery: 'payload'`），
 * 字节由浏览器自己存——无头宿主没有保存对话框，但展示页面的这台机器有下载目录。
 */
async function downloadBackup(options: BackupExportOptions): Promise<BackupExportResult> {
  const result = await invoke(IpcChannels.BACKUP_EXPORT, { ...options, delivery: 'payload' })
  // 旧网关不认识 payload：无头守护进程仍回 desktop-only（界面有专门文案）；
  // 无窗 Electron 网关会忽略该标志走自己的对话框，结果带 filePath 而无 payload，原样透传。
  if (typeof result.payload !== 'string' || typeof result.fileName !== 'string') return result
  const url = URL.createObjectURL(new Blob([result.payload], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = result.fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { ...result, filePath: result.fileName }
}

// ---------------------------------------------------------------- events (SSE)

type Listener = (event: unknown, payload: any) => void

const listeners = new Map<string, Set<Listener>>()
let streamReader: Promise<void> | null = null
let streamAbort: AbortController | null = null

async function readEvents(signal: AbortSignal): Promise<void> {
  let backoffMs = 1000
  while (!signal.aborted) {
    try {
      const response = await fetch('/v1/management/events', {
        headers: { 'X-Management-Secret': secret() },
        signal,
      })
      if (response.status === 401) {
        forgetSecret()
        return
      }
      if (!response.ok || !response.body) throw new Error(`events ${response.status}`)

      backoffMs = 1000
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let boundary = buffer.indexOf('\n\n')
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          applyFrame(frame)
          boundary = buffer.indexOf('\n\n')
        }
      }
    } catch {
      // aborted, or the daemon went away; the loop below decides whether to retry
    }
    if (signal.aborted) return
    await new Promise(resolve => setTimeout(resolve, backoffMs))
    backoffMs = Math.min(backoffMs * 2, 15_000)
  }
}

function applyFrame(frame: string): void {
  // `: ping` heartbeats and any frame without a payload parse to null: they must not be
  // delivered as an empty update.
  const event = parseEventFrame(frame)
  if (!event) return
  for (const listener of listeners.get(event.channel) ?? []) listener(null, event.payload)
}

function ensureStream(): void {
  if (streamReader) return
  streamAbort = new AbortController()
  streamReader = readEvents(streamAbort.signal)
}

const wire: ApiWire = {
  invoke,
  on: (channel, handler) => {
    const set = listeners.get(channel) ?? new Set<Listener>()
    set.add(handler)
    listeners.set(channel, set)
    ensureStream()
  },
  off: (channel, handler) => {
    listeners.get(channel)?.delete(handler)
  },
  // The tray window is an Electron surface; a browser client has no tray to talk to.
  send: () => undefined,
  uploadBackup,
  downloadBackup,
}

/**
 * Installs the API object when nothing else did.
 * Returns true when this browser is now driving a remote gateway.
 */
export function installHeadlessApi(): boolean {
  const target = window as unknown as { electronAPI?: unknown; __MODELPORT_REMOTE__?: boolean }
  if (target.electronAPI) return false
  target.electronAPI = createElectronAPI(wire)
  // The About page must be able to say "there is no desktop updater here" instead of
  // showing a button whose only outcome is `desktop-only`. The shell bridge is checked
  // separately; this marks the plain browser/remote-gateway case.
  target.__MODELPORT_REMOTE__ = true
  return true
}
