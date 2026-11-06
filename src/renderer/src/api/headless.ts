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
import type { BackupPickResult } from '@shared/backup'
import type { ShellBridge } from '@shared/shellBridge'
import { parseEventFrame } from '@shared/sseFrames'

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

async function invokeOnce(channel: string, args: unknown[], retried = false): Promise<any> {
  const response = await fetch('/v1/management/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Management-Secret': secret() },
    body: JSON.stringify({ channel, args }),
  })
  if (response.status === 401) {
    forgetSecret()
    throw new Error('management secret rejected')
  }
  const body = (await response.json().catch(() => null)) as RpcEnvelope | null
  // 管理面限流由 UI 自己的轮询触发，不是用户操作失败：等一个窗口再试一次。
  // 第二次仍 429 就按普通失败抛出，避免把一次点击挂成无限重试。
  if (response.status === 429 && !retried) {
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs(response, body)))
    return invokeOnce(channel, args, true)
  }
  if (!body) throw new Error(`rpc ${channel}: empty response (${response.status})`)
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

  const pending = invokeOnce(channel, args)
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
