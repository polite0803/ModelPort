/**
 * Driving Qoder's own BYOK model interface over a debug pipe.
 *
 * Qoder's GUI custom models live in its daemon's encrypted store; the settings.json on
 * disk is a derived export for the CLI/agent SDK and editing it never moves the model
 * picker. The app itself, however, serves the same management as a preload bridge
 * (`window.qoderDesktop`: listByokConfigs / createByokConfig / updateByokConfig) on every
 * page it opens. This module spawns the app with `--remote-debugging-pipe` (CDP over
 * anonymous fds 3/4 - no TCP port, nothing decrypted, no credentials replayed) and calls
 * that bridge: the same controlled-launch trick the open-source qoder-model-bridge uses
 * for the Qoder IDE, adapted to the desktop agent whose bridge is the IPC one.
 *
 * Hard boundaries, each visible in a row or a message rather than silently skipped:
 * - the app holds a single-instance lock, so a write requires it closed first
 *   (`app-running` otherwise);
 * - the create payload takes at most 32 models, so the overflow is reported as unserved;
 * - vision/reasoning/effort capabilities are not derivable from `/v1/models` (the
 *   gateway never invents them), so they are written conservatively and Qoder's own
 *   model editor stays the place to adjust them;
 * - the context window is the gateway-advertised one, or Qoder's own 200000 preset when
 *   the gateway publishes none (the payload schema demands a positive int);
 * - every write is verified by read-back; a model the list cannot see counts as failed.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import type { ClientChange, ClientSyncModel } from '../shared/clientSync.ts'
import { CLIENT_LABELS } from './clientSyncPlan.ts'

/** The create payload validator accepts 1..32 models (Qoder asar, `LZr`/`y$e`). */
export const QODER_NATIVE_MAX_MODELS = 32

/** Qoder's own preset for a custom model without a declared window (asar default). */
export const QODER_DEFAULT_CONTEXT_WINDOW = 200000

const QODER_NO_KEY_MANUAL = '没有规范 key：端点与模型会写入，但 API Key 是空的，请在 Qoder 的模型设置里填成目标网关的 key'

export interface QoderInstall {
  id: 'qoder' | 'qoder-cn'
  /** The desktop app executable; launching it with `--remote-debugging-pipe` opens CDP. */
  exePath: string
}

export function findQoderInstalls(): QoderInstall[] {
  const candidates: QoderInstall[] = []
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA
    if (local) {
      candidates.push(
        { id: 'qoder', exePath: join(local, 'Programs', 'Qoder', 'Qoder.exe') },
        { id: 'qoder-cn', exePath: join(local, 'Programs', 'Qoder CN', 'Qoder CN.exe') },
      )
    }
  } else if (process.platform === 'darwin') {
    candidates.push(
      { id: 'qoder', exePath: '/Applications/Qoder.app/Contents/MacOS/Qoder' },
      { id: 'qoder-cn', exePath: '/Applications/Qoder CN.app/Contents/MacOS/Qoder CN' },
    )
  }
  return candidates.filter(install => existsSync(install.exePath))
}

/**
 * ModelPort serves `/v1/chat/completions`, and Qoder's custom endpoint wants the base
 * URL it should append that path to - the same `/v1` base the settings.json export face
 * used for this gateway.
 */
export function qoderEndpointUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/v1`
}

/** Both sides of the endpoint comparison are folded the same way. */
export function normalizeEndpointUrl(url: string): string {
  return url.replace(/\/+$/, '').toLowerCase()
}

interface QoderModelEntry {
  modelKey: string
  modelDisplayName: string
  typeKey: null
  typeDisplayName: string
  isVision: boolean
  isReasoning: boolean
  availableContextWindows: number[]
  defaultContextWindow: number
  efforts: string[]
}

export interface QoderCreatePayload {
  connection: { kind: 'custom-endpoint'; protocol: 'openai'; endpointUrl: string; displayName: string }
  apiKey: string
  models: QoderModelEntry[]
}

export interface QoderUpdatePayload {
  reference: { kind: 'custom'; providerId: string }
  modelKey: string
  modelDisplayName: string
  isVision: boolean
  isReasoning: boolean
  availableContextWindows: number[]
  defaultContextWindow: number
  efforts: string[]
}

function contextWindowFor(model: ClientSyncModel): number {
  return model.contextWindow !== null && model.contextWindow > 0 ? model.contextWindow : QODER_DEFAULT_CONTEXT_WINDOW
}

function modelEntry(model: ClientSyncModel): QoderModelEntry {
  const window = contextWindowFor(model)
  return {
    modelKey: model.name,
    modelDisplayName: model.displayName === model.name ? model.name : model.displayName,
    typeKey: null,
    typeDisplayName: 'Custom',
    isVision: false,
    isReasoning: false,
    availableContextWindows: [window],
    defaultContextWindow: window,
    efforts: [],
  }
}

/** Exactly the key sets the Qoder asar validators accept - no more, no less. */
export function buildCreatePayload(input: { endpointUrl: string; apiKey: string; models: ClientSyncModel[] }): QoderCreatePayload {
  return {
    connection: { kind: 'custom-endpoint', protocol: 'openai', endpointUrl: input.endpointUrl, displayName: 'ModelPort' },
    apiKey: input.apiKey,
    models: input.models.map(modelEntry),
  }
}

export function buildUpdatePayload(input: { providerId: string; model: ClientSyncModel }): QoderUpdatePayload {
  const entry = modelEntry(input.model)
  return {
    reference: { kind: 'custom', providerId: input.providerId },
    modelKey: entry.modelKey,
    modelDisplayName: entry.modelDisplayName,
    isVision: entry.isVision,
    isReasoning: entry.isReasoning,
    availableContextWindows: entry.availableContextWindows,
    defaultContextWindow: entry.defaultContextWindow,
    efforts: entry.efforts,
  }
}

// ---------------------------------------------------------------------------
// Planning (pure - the preview never spawns Qoder)
// ---------------------------------------------------------------------------

export interface QoderPlanInput {
  id: 'qoder' | 'qoder-cn'
  install: QoderInstall | null
  running: boolean
  hasKey: boolean
  origin: string
  models: ClientSyncModel[]
}

export interface QoderPlan {
  state: 'not-installed' | 'app-running' | 'ready'
  reason: string | null
  manualStep: string | null
  unserved: string[]
  changes: ClientChange[]
}

export function planQoderNative(input: QoderPlanInput): QoderPlan {
  if (input.install === null) {
    return {
      state: 'not-installed',
      reason: `没有检测到 ${CLIENT_LABELS[input.id]} 的桌面应用安装`,
      manualStep: null,
      unserved: [],
      changes: [],
    }
  }
  if (input.running) {
    return {
      state: 'app-running',
      reason: 'Qoder 正在运行：它持有单实例锁，写入需要用调试管道重新启动它',
      manualStep: '退出 Qoder 后重试',
      unserved: [],
      changes: [],
    }
  }
  const served = input.models.slice(0, QODER_NATIVE_MAX_MODELS)
  const unserved = input.models.slice(QODER_NATIVE_MAX_MODELS).map(model => model.name)
  const steps: string[] = []
  if (!input.hasKey) steps.push(QODER_NO_KEY_MANUAL)
  if (unserved.length > 0) {
    steps.push(`Qoder 的自定义端点一次最多收 ${QODER_NATIVE_MAX_MODELS} 个模型，其余 ${unserved.length} 个请在 Qoder 的模型设置里手动添加`)
  }
  return {
    state: 'ready',
    reason: null,
    manualStep: steps.length === 0 ? null : steps.join('；'),
    unserved,
    changes: [
      { label: '端点地址', before: null, after: qoderEndpointUrl(input.origin) },
      { label: '模型清单', before: null, after: `${served.length} 个路由模型（经 Qoder 原生接口写入它的加密模型库）` },
    ],
  }
}

// ---------------------------------------------------------------------------
// CDP transport: JSON messages NUL-delimited over the app's fds 3/4
// ---------------------------------------------------------------------------

export function encodeCdpMessage(message: object): string {
  return `${JSON.stringify(message)}\0`
}

/** Splits one accumulated buffer into complete NUL-terminated messages plus the tail. */
export function decodeCdpMessages(buffer: string): { messages: object[]; rest: string } {
  const messages: object[] = []
  let rest = buffer
  let boundary = rest.indexOf('\0')
  while (boundary >= 0) {
    const chunk = rest.slice(0, boundary)
    rest = rest.slice(boundary + 1)
    try {
      messages.push(JSON.parse(chunk) as object)
    } catch {
      // A partial or corrupt frame is dropped, not fatal - the next frame still lands.
    }
    boundary = rest.indexOf('\0')
  }
  return { messages, rest }
}

interface CdpTransport {
  write(chunk: string): void
  onData(listener: (chunk: Buffer) => void): void
  onClose(listener: () => void): void
  close(): void
}

function spawnQoderTransport(exePath: string): CdpTransport {
  const env = { ...process.env }
  // ELECTRON_RUN_AS_NODE would boot the app as a plain Node process (no bridge, no
  // window); NODE_OPTIONS could inject arbitrary boot scripts into it. Neither belongs
  // in a controlled launch.
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_OPTIONS
  const child = spawn(exePath, ['--remote-debugging-pipe'], {
    env,
    stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
    windowsHide: false,
  })
  const stdin = child.stdio[3]
  const stdout = child.stdio[4]
  if (stdin === null || stdin === undefined || stdout === null || stdout === undefined) {
    child.kill()
    throw new Error('启动 Qoder 的调试管道失败：子进程没有提供 pipe fd')
  }
  const pipeIn = stdin as Writable
  const pipeOut = stdout as Readable
  let open = true
  return {
    write(chunk: string): void {
      if (open) pipeIn.write(chunk)
    },
    onData(listener: (chunk: Buffer) => void): void {
      pipeOut.on('data', listener)
    },
    onClose(listener: () => void): void {
      child.on('exit', listener)
      pipeOut.on('close', listener)
      pipeIn.on('close', listener)
    },
    close(): void {
      if (!open) return
      open = false
      pipeOut.destroy()
      pipeIn.destroy()
    },
  }
}

interface PendingEntry {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

interface CdpTargetInfo {
  targetId: string
  type: string
  url: string
}

const PROBE_EXPRESSION = `(() => { try { const api = window.qoderDesktop; return typeof api?.listByokConfigs === 'function' ? 'ready' : 'absent' } catch { return 'absent' } })()`

const MAX_CDP_BUFFER = 8 * 1024 * 1024

export class QoderCdpClient {
  private seq = 0
  private pending = new Map<number, PendingEntry>()
  private buffer = ''
  private closed = false
  private closeError: Error | null = null
  private sessionId: string | null = null
  private readonly transport: CdpTransport

  constructor(transport: CdpTransport) {
    this.transport = transport
    transport.onData(chunk => {
      this.buffer += chunk.toString('utf8')
      if (this.buffer.length > MAX_CDP_BUFFER) {
        this.fail(new Error('Qoder 的调试管道返回了异常体积的数据'))
        return
      }
      const { messages, rest } = decodeCdpMessages(this.buffer)
      this.buffer = rest
      for (const message of messages) this.dispatch(message)
    })
    transport.onClose(() => {
      this.closed = true
      this.closeError = this.closeError ?? new Error('Qoder 已退出，调试管道随之关闭')
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer)
        entry.reject(this.closeError)
      }
      this.pending.clear()
    })
  }

  /** The session every page-level command is sent through (flatten mode); null while probing. */
  useSession(sessionId: string | null): void {
    this.sessionId = sessionId
  }

  request<T = unknown>(method: string, params: object = {}, timeoutMs = 30000): Promise<T> {
    if (this.closed) return Promise.reject(this.closeError ?? new Error('调试管道已关闭'))
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Qoder 调试命令 ${method} 超时（${timeoutMs}ms）`))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      this.transport.write(encodeCdpMessage({
        id,
        method,
        params,
        ...(this.sessionId !== null ? { sessionId: this.sessionId } : {}),
      }))
    })
  }

  /** `Runtime.evaluate` that resolves the awaited promise's value or surfaces the page error. */
  async evaluate<T = unknown>(expression: string, timeoutMs = 120000): Promise<T> {
    const reply = await this.request<{ result?: { type?: string; value?: unknown }; exceptionDetails?: { exception?: { description?: string }; text?: string } }>(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      timeoutMs,
    )
    if (reply.exceptionDetails) {
      const detail = reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text ?? '未知页面错误'
      throw new Error(`Qoder 页面执行失败：${detail.split('\n')[0]}`)
    }
    return (reply.result?.value ?? null) as T
  }

  fail(error: Error): void {
    this.closed = true
    this.closeError = this.closeError ?? error
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(this.closeError)
    }
    this.pending.clear()
    this.transport.close()
  }

  private dispatch(message: object): void {
    const entry = message as { id?: unknown; result?: unknown; error?: unknown }
    if (typeof entry.id !== 'number') return
    const pending = this.pending.get(entry.id)
    if (!pending) return
    this.pending.delete(entry.id)
    clearTimeout(pending.timer)
    if (entry.error !== undefined) {
      pending.reject(new Error(`Qoder 调试协议返回错误：${JSON.stringify(entry.error)}`))
      return
    }
    pending.resolve(entry.result)
  }
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Attaches to whichever page target carries the app's own bridge. The app may open more
 * than one window, and the target URL is an implementation detail - the probe asks the
 * page itself whether `window.qoderDesktop` is there.
 */
export async function connectQoderBridge(transport: CdpTransport, timeoutMs = 45000): Promise<QoderCdpClient> {
  const client = new QoderCdpClient(transport)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { targetInfos } = await client.request<{ targetInfos: CdpTargetInfo[] }>('Target.getTargets', {}, 15000)
    for (const target of targetInfos) {
      if (target.type !== 'page') continue
      let sessionId: string | null = null
      try {
        const attached = await client.request<{ sessionId: string }>('Target.attachToTarget', { targetId: target.targetId, flatten: true }, 15000)
        sessionId = attached.sessionId
        client.useSession(sessionId)
        const probe = await client.evaluate<string>(PROBE_EXPRESSION, 15000)
        if (probe === 'ready') return client
        client.useSession(null)
        await client.request('Target.detachFromTarget', { sessionId }, 15000)
      } catch {
        if (sessionId !== null) client.useSession(null)
      }
    }
    await delay(500)
  }
  client.fail(new Error('没有在 Qoder 的窗口里找到原生模型接口（window.qoderDesktop）'))
  throw new Error('没有在 Qoder 的窗口里找到原生模型接口（window.qoderDesktop）')
}

// ---------------------------------------------------------------------------
// Listing + applying
// ---------------------------------------------------------------------------

export interface QoderConfigGroup {
  providerId: string
  endpointUrl: string | null
  protocolStyle: string | null
  modelKeys: Set<string>
}

/**
 * The list returns model-profile rows (one per model, each carrying its config
 * reference); older shapes carried the connection inline. Both fold into one group per
 * config so matching only needs providerId + endpoint + model keys.
 */
export function normalizeQoderConfigs(items: unknown[]): QoderConfigGroup[] {
  const groups = new Map<string, QoderConfigGroup>()
  for (const item of items) {
    if (item === null || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    const reference = entry.configReference as { kind?: unknown; providerId?: unknown } | undefined
    const providerId = typeof reference?.providerId === 'string' && reference.providerId !== ''
      ? reference.providerId
      : typeof entry.providerId === 'string' && entry.providerId !== '' ? entry.providerId : null
    if (providerId === null) continue
    const connection = entry.connection as Record<string, unknown> | undefined
    const endpointUrl = typeof entry.endpointUrl === 'string'
      ? entry.endpointUrl
      : typeof connection?.endpointUrl === 'string' ? connection.endpointUrl : null
    const protocolStyle = typeof entry.protocolStyle === 'string'
      ? entry.protocolStyle
      : typeof entry.protocol === 'string' ? entry.protocol : null
    let group = groups.get(providerId)
    if (!group) {
      group = { providerId, endpointUrl, protocolStyle, modelKeys: new Set() }
      groups.set(providerId, group)
    }
    if (group.endpointUrl === null && endpointUrl !== null) group.endpointUrl = endpointUrl
    if (group.protocolStyle === null && protocolStyle !== null) group.protocolStyle = protocolStyle
    if (typeof entry.modelKey === 'string' && entry.modelKey !== '') group.modelKeys.add(entry.modelKey)
    const models = entry.models
    if (Array.isArray(models)) {
      for (const model of models) {
        if (model === null || typeof model !== 'object') continue
        const key = (model as Record<string, unknown>).id ?? (model as Record<string, unknown>).model
        if (typeof key === 'string' && key !== '') group.modelKeys.add(key)
      }
    }
  }
  return [...groups.values()]
}

export interface QoderNativeInput {
  install: QoderInstall
  origin: string
  /** Plaintext canonical key; null writes an empty key (the endpoint kind allows it). */
  key: string | null
  models: ClientSyncModel[]
}

export interface QoderNativeResult {
  createdConfig: boolean
  verifiedModels: string[]
  failedModels: { model: string; error: string }[]
  endpointUrl: string
}

const LIST_EXPRESSION = 'window.qoderDesktop.listByokConfigs()'

/**
 * What the pre-list decides: no config points at this endpoint yet, so the whole model
 * list goes into one create; otherwise only the models the existing config is missing.
 */
export function decideQoderWrites(
  before: QoderConfigGroup[],
  endpointUrl: string,
  models: ClientSyncModel[],
): { create: boolean; providerId: string | null; toAdd: ClientSyncModel[] } {
  const target = before.find(group =>
    group.endpointUrl !== null &&
    normalizeEndpointUrl(group.endpointUrl) === normalizeEndpointUrl(endpointUrl) &&
    (group.protocolStyle === null || group.protocolStyle === 'openai'))
  if (target === undefined) return { create: true, providerId: null, toAdd: models }
  return { create: false, providerId: target.providerId, toAdd: models.filter(model => !target.modelKeys.has(model.name)) }
}

/** Read-back decides: whatever the list cannot see did not happen. */
export function verifyQoderReadback(
  after: QoderConfigGroup[],
  endpointUrl: string,
  models: ClientSyncModel[],
): { verifiedModels: string[]; failedModels: { model: string; error: string }[] } {
  const present = new Set<string>()
  for (const group of after) {
    if (group.endpointUrl === null) continue
    if (normalizeEndpointUrl(group.endpointUrl) !== normalizeEndpointUrl(endpointUrl)) continue
    for (const key of group.modelKeys) present.add(key)
  }
  const verifiedModels: string[] = []
  const failedModels: { model: string; error: string }[] = []
  for (const model of models) {
    if (present.has(model.name)) verifiedModels.push(model.name)
    else failedModels.push({ model: model.name, error: '写入后回读未确认' })
  }
  return { verifiedModels, failedModels }
}

/**
 * Creates a ModelPort endpoint config (when none points here yet) or adds missing
 * models to the existing one, then re-lists and counts only what came back.
 */
export async function applyQoderNative(input: QoderNativeInput): Promise<QoderNativeResult> {
  const endpointUrl = qoderEndpointUrl(input.origin)
  const served = input.models.slice(0, QODER_NATIVE_MAX_MODELS)
  if (served.length === 0) throw new Error('网关没有公布任何路由模型，没有可写入 Qoder 的清单')
  const transport = spawnQoderTransport(input.install.exePath)
  try {
    const client = await connectQoderBridge(transport)
    const before = normalizeQoderConfigs(await client.evaluate<unknown[]>(LIST_EXPRESSION))
    const decision = decideQoderWrites(before, endpointUrl, served)
    if (decision.create) {
      const payload = buildCreatePayload({ endpointUrl, apiKey: input.key ?? '', models: decision.toAdd })
      await client.evaluate(`window.qoderDesktop.createByokConfig(${JSON.stringify(payload)})`)
    } else {
      for (const model of decision.toAdd) {
        const payload = buildUpdatePayload({ providerId: decision.providerId as string, model })
        await client.evaluate(`window.qoderDesktop.updateByokConfig(${JSON.stringify(payload)})`)
      }
    }
    const after = normalizeQoderConfigs(await client.evaluate<unknown[]>(LIST_EXPRESSION))
    const readback = verifyQoderReadback(after, endpointUrl, served)
    return { createdConfig: decision.create, ...readback, endpointUrl }
  } finally {
    // The app stays open for the user; only our pipe ends go away.
    transport.close()
  }
}
