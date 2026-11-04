/**
 * 标准模型库的服务层：显式刷新、候选匹配、逐字段采用/撤销。
 *
 * 这里没有定时器、没有启动抓取，也没有打开页面就发请求的路径 —— 唯一的网络调用
 * 是 `refreshCatalog(source)`，只能由用户点击触发。刷新失败时旧快照原样保留。
 */
import { createHash } from 'crypto'
import { lookup } from 'dns/promises'
import {
  CATALOG_SOURCE_META,
  catalogEndpointPlan,
  catalogFieldValue,
  catalogIndexFromStore,
  adoptionsForModel,
  matchCatalogEntries,
  removeCatalogAdoptions,
  sanitizeCatalogAdoptionValue,
  upsertCatalogAdoption,
  type CatalogAdoption,
  type CatalogAdoptionField,
  type CatalogCandidatesResult,
  type CatalogEntry,
  type CatalogRefreshEndpointAttempt,
  type CatalogRefreshErrorKind,
  type CatalogRefreshResult,
  type CatalogSnapshotStatus,
  type CatalogSnapshot,
  type CatalogSourceId,
} from '../../shared/modelCatalog.ts'
import { storeManager } from '../store/store.ts'
import { parseCatalogPayload } from './modelCatalogParsers.ts'
import {
  readCatalogStore,
  readEffectiveCatalogStatuses,
  readEffectiveCatalogStore,
  writeCatalogSnapshot,
} from './modelCatalogStore.ts'

/**
 * LiteLLM 的原始文件约 3.2 MB（4,500+ 条）；慢链路下 30s 不够，给 60s。
 * 这是「整体抓取」超时，不是单条解析超时。
 */
const FETCH_TIMEOUT_MS = 60_000
/** 失败时把响应体前 200 字符带进错误信息，便于区分代理页/限流页/真 JSON。 */
const ERROR_BODY_SNIPPET = 200
/**
 * 响应体上限：源文件约 3.3 MB，8 MB 足够覆盖上游增长，同时挡住
 * 被劫持/镜像返回的超大文件把内存打满。
 */
const MAX_CATALOG_BYTES = 8 * 1024 * 1024
/** 手动跟随重定向的跳数上限（GitHub raw 到 CDN 通常 1–2 跳）。 */
const MAX_CATALOG_REDIRECTS = 5

/**
 * SSRF 面：镜像地址是用户输入的，且重定向目标不受我们控制。
 * 结论：所有端点（含每一跳重定向）只接受 https；拒绝环回、链路本地与私网地址
 * （IPv4 + IPv6 字面量与 DNS 解析结果都查）；响应体硬上限 8 MB。
 */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase()
  if (host === '' || host === 'localhost' || host === '0.0.0.0' || host === '::1') return true
  if (host.startsWith('127.') || host.startsWith('10.')) return true
  if (host.startsWith('192.168.')) return true
  const v4 = /^172\.(\d{1,3})\./.exec(host)
  if (v4 && Number(v4[1]) >= 16 && Number(v4[1]) <= 31) return true
  if (host === '169.254.169.254' || host.startsWith('169.254.')) return true
  // IPv6 私网/链路本地：::1、fc00::/7、fe80::/10
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true
  return false
}

async function assertSafeCatalogUrl(raw: string): Promise<URL> {
  const url = new URL(raw)
  if (url.protocol !== 'https:') throw new Error('端点必须使用 https')
  if (isPrivateHost(url.hostname)) throw new Error(`拒绝私网/环回地址：${url.hostname}`)
  // 域名可能解析到私网地址：字面量检查不够，必须看实际解析结果。
  const resolved = await lookup(url.hostname, { all: true, verbatim: true })
  for (const entry of resolved) {
    if (isPrivateHost(entry.address)) {
      throw new Error(`域名解析到私网/环回地址：${entry.address}`)
    }
  }
  return url
}

/** 逐跳手动跟随重定向，每一跳都重新做协议/地址校验。 */
async function fetchCatalogEndpoint(url: string): Promise<Response> {
  let current = url
  for (let hop = 0; hop <= MAX_CATALOG_REDIRECTS; hop += 1) {
    await assertSafeCatalogUrl(current)
    const response = await fetch(current, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'manual',
      headers: {
        accept: 'application/json',
        'user-agent': 'ModelPort model-catalog refresh (manual)',
      },
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location) throw new Error(`HTTP ${response.status} 重定向缺少 Location`)
      current = new URL(location, current).toString()
      continue
    }
    return response
  }
  throw new Error(`重定向超过 ${MAX_CATALOG_REDIRECTS} 跳`)
}

/** 流式读取并累计字节，超过上限立即取消，避免把超大响应读进内存。 */
async function readCatalogBody(response: Response): Promise<{ text: string; bytes: number }> {
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > MAX_CATALOG_BYTES) {
    await response.body?.cancel()
    throw new Error(`响应体过大：${declared} 字节（上限 ${MAX_CATALOG_BYTES}）`)
  }
  if (!response.body) {
    const text = await response.text()
    return { text, bytes: Buffer.byteLength(text, 'utf8') }
  }
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let bytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > MAX_CATALOG_BYTES) {
      await reader.cancel()
      throw new Error(`响应体过大：超过 ${MAX_CATALOG_BYTES} 字节上限`)
    }
    chunks.push(Buffer.from(value))
  }
  return { text: Buffer.concat(chunks).toString('utf8'), bytes }
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function snippetOf(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > ERROR_BODY_SNIPPET
    ? `${collapsed.slice(0, ERROR_BODY_SNIPPET)}…`
    : collapsed
}

/**
 * 把异常折成人读分类。`AbortSignal.timeout` 在 Node/Electron 里抛出 `TimeoutError`；
 * 连接失败通常是 `TypeError: fetch failed`，根因在 `cause.code`（ENOTFOUND/ECONNREFUSED/
 * ECONNRESET/ETIMEDOUT）。分类只用于界面提示，不改变「失败即保留旧快照」的语义。
 */
function classifyFetchError(error: unknown): { kind: CatalogRefreshErrorKind; message: string } {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return { kind: 'timeout', message: `请求超时（${FETCH_TIMEOUT_MS / 1000}s 内未完成）` }
    }
    const cause = (error as { cause?: { code?: unknown } }).cause
    const code = typeof cause?.code === 'string' ? cause.code : ''
    if (error.name === 'TypeError' || code.startsWith('E')) {
      return { kind: 'network', message: `网络不可达（${error.message}${code ? ` / ${code}` : ''}）` }
    }
    return { kind: 'unknown', message: error.message }
  }
  return { kind: 'unknown', message: String(error) }
}

/**
 * 刷新一个来源：按主端点 → jsDelivr → 用户镜像的顺序逐个尝试，任一成功即停。
 *
 * 每个端点单独记录耗时与错误类型（全部失败时一并返回，界面能区分
 * 「全都不可达」与「某个端点挂了」）。成功才写盘；任何失败都保留旧快照，
 * 从未成功刷新过时界面仍显示内置快照。
 *
 * 三个来源彼此独立：只覆盖被刷新的来源，另一个来源失败不会清掉这里的快照。
 */
export async function refreshCatalog(
  source: CatalogSourceId,
  options?: { mirrorUrl?: string },
): Promise<CatalogRefreshResult> {
  const meta = CATALOG_SOURCE_META[source]
  const startedAt = Date.now()
  const endpoints = catalogEndpointPlan(source, options?.mirrorUrl)
  const attempts: CatalogRefreshEndpointAttempt[] = []
  let lastKind: CatalogRefreshErrorKind = 'unknown'
  let lastError = ''

  for (const endpoint of endpoints) {
    const attemptStartedAt = Date.now()
    const base = {
      url: endpoint.url,
      label: endpoint.label,
      elapsedMs: 0,
    }
    try {
      const response = await fetchCatalogEndpoint(endpoint.url)
      if (!response.ok) {
        let detail = ''
        try {
          detail = snippetOf((await readCatalogBody(response)).text)
        } catch {
          // 读响应体失败不影响「HTTP 非 2xx」这个结论。
        }
        const message = `HTTP ${response.status} ${response.statusText}${detail ? `：${detail}` : ''}`
        attempts.push({
          ...base,
          status: response.status,
          errorKind: 'http',
          error: message,
          elapsedMs: Date.now() - attemptStartedAt,
        })
        lastKind = 'http'
        lastError = message
        continue
      }
      const body = await readCatalogBody(response)
      let raw: unknown
      try {
        raw = JSON.parse(body.text)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const detail = `响应不是合法 JSON（${body.bytes} 字节）：${message}`
        attempts.push({
          ...base,
          status: response.status,
          errorKind: 'parse',
          error: detail,
          elapsedMs: Date.now() - attemptStartedAt,
          bytes: body.bytes,
        })
        lastKind = 'parse'
        lastError = detail
        continue
      }
      const entries = parseCatalogPayload(source, raw)
      if (entries.length === 0) {
        const detail = '响应中没有可用的模型条目（保留上一份快照）'
        attempts.push({
          ...base,
          status: response.status,
          errorKind: 'empty',
          error: detail,
          elapsedMs: Date.now() - attemptStartedAt,
          bytes: body.bytes,
        })
        lastKind = 'empty'
        lastError = detail
        continue
      }
      await writeCatalogSnapshot({
        source,
        sourceUrl: endpoint.url,
        fetchedAt: new Date().toISOString(),
        contentHash: sha256(body.text),
        license: meta.license,
        attribution: meta.attribution,
        entries,
      })
      const bytes = body.bytes
      attempts.push({
        ...base,
        status: response.status,
        elapsedMs: Date.now() - attemptStartedAt,
        bytes,
      })
      const statuses = await readEffectiveCatalogStatuses()
      return {
        success: true,
        status: statuses.find((item) => item.source === source),
        statuses,
        attempts,
        usedEndpoint: endpoint.url,
        elapsedMs: Date.now() - startedAt,
      }
    } catch (error) {
      const classified = classifyFetchError(error)
      attempts.push({
        ...base,
        errorKind: classified.kind,
        error: classified.message,
        elapsedMs: Date.now() - attemptStartedAt,
      })
      lastKind = classified.kind
      lastError = classified.message
    }
  }

  const summary = attempts
    .map((attempt) => `${attempt.label}: ${attempt.error ?? 'failed'}`)
    .join('; ')
  return {
    success: false,
    errorKind: lastKind,
    error: `全部端点均失败（${attempts.length} 个）：${summary || lastError}`,
    statuses: await readEffectiveCatalogStatuses(),
    attempts,
    elapsedMs: Date.now() - startedAt,
  }
}

/** 当前快照元数据（不含 entries）；页面打开只读这一份，不联网。 */
export async function getCatalogStatuses(): Promise<CatalogSnapshotStatus[]> {
  return readEffectiveCatalogStatuses()
}

/**
 * 某个模型的候选列表 + 已采用字段。匹配按「exact → alias → family」排序，
 * 默认不采用任何一条；界面必须让用户逐字段点击。
 */
export async function getCatalogCandidates(input: {
  providerId: string
  displayName: string
  actualModelId: string
}): Promise<CatalogCandidatesResult> {
  const { store } = await readEffectiveCatalogStore()
  const matches = matchCatalogEntries(catalogIndexFromStore(store), {
    modelId: input.actualModelId,
    displayName: input.displayName,
  })
  return {
    statuses: await readEffectiveCatalogStatuses(),
    matches,
    adoptions: adoptionsForModel(
      storeManager.getCatalogAdoptions(),
      input.providerId,
      input.displayName,
    ),
  }
}

function findEntry(
  store: Awaited<ReturnType<typeof readCatalogStore>>,
  catalogId: string,
): { entry: CatalogEntry; contentHash: string } | undefined {
  for (const snapshot of Object.values(store.snapshots) as Array<CatalogSnapshot | undefined>) {
    if (!snapshot) continue
    const entry = snapshot.entries.find((item) => item.catalogId === catalogId)
    if (entry) return { entry, contentHash: snapshot.contentHash }
  }
  return undefined
}

/**
 * 逐字段采用。值必须来自当前快照的对应条目，避免界面伪造一个「标准库值」；
 * 写入进 adoption ledger（`data.json`），不碰 `userModelMarks`。
 */
export async function adoptCatalogField(input: {
  providerId: string
  displayName: string
  catalogId: string
  field: CatalogAdoptionField
}): Promise<{ success: boolean; adoptions?: CatalogAdoption[]; error?: string }> {
  const provider = storeManager.getProviders().find((item) => item.id === input.providerId)
  if (!provider) return { success: false, error: '供应商不存在' }
  // 归属判定必须与 `store.ts::setUserModelMark` 同一口径：目录是 `supportedModels` /
  // `addedModels` / `fetchedModels` 的超集，只看 modelCapabilities/modelMappings 会把
  // 只填 supportedModels 的自定义供应商整片判成“不属于”，批量采用便静默失败。
  const known = storeManager
    .getModelCatalogue(input.providerId)
    .some((model) => model.displayName === input.displayName)
  if (!known) return { success: false, error: '模型不属于该供应商' }

  const { store } = await readEffectiveCatalogStore()
  const found = findEntry(store, input.catalogId)
  if (!found) return { success: false, error: '快照中找不到该条目，请先刷新标准库' }
  const value = sanitizeCatalogAdoptionValue(
    input.field,
    catalogFieldValue(found.entry, input.field),
  )
  if (value === undefined) return { success: false, error: '该条目没有这个可用字段' }

  const adoption: CatalogAdoption = {
    providerId: input.providerId,
    displayName: input.displayName,
    catalogId: input.catalogId,
    field: input.field,
    value,
    source: found.entry.source,
    evidenceId: `${found.contentHash}:${found.entry.id}`,
    adoptedAt: new Date().toISOString(),
  }
  const next = storeManager.setCatalogAdoptions(
    upsertCatalogAdoption(storeManager.getCatalogAdoptions(), adoption),
  )
  return {
    success: true,
    adoptions: adoptionsForModel(next, input.providerId, input.displayName),
  }
}

/** 撤销：不传 field 时撤销该模型的全部 adopted 字段，回退到自动解析结果。 */
export function revokeCatalogAdoption(input: {
  providerId: string
  displayName: string
  field?: CatalogAdoptionField
}): { success: boolean; adoptions?: CatalogAdoption[]; error?: string } {
  const next = storeManager.setCatalogAdoptions(
    removeCatalogAdoptions(
      storeManager.getCatalogAdoptions(),
      input.providerId,
      input.displayName,
      input.field,
    ),
  )
  return {
    success: true,
    adoptions: adoptionsForModel(next, input.providerId, input.displayName),
  }
}
