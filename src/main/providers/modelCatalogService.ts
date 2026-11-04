/**
 * 标准模型库的服务层：显式刷新、候选匹配、逐字段采用/撤销。
 *
 * 这里没有定时器、没有启动抓取，也没有打开页面就发请求的路径 —— 唯一的网络调用
 * 是 `refreshCatalog(source)`，只能由用户点击触发。刷新失败时旧快照原样保留。
 */
import { createHash } from 'crypto'
import {
  CATALOG_SOURCE_META,
  catalogFieldValue,
  catalogIndexFromStore,
  catalogSnapshotStatuses,
  adoptionsForModel,
  matchCatalogEntries,
  removeCatalogAdoptions,
  sanitizeCatalogAdoptionValue,
  upsertCatalogAdoption,
  type CatalogAdoption,
  type CatalogAdoptionField,
  type CatalogCandidatesResult,
  type CatalogEntry,
  type CatalogRefreshErrorKind,
  type CatalogRefreshResult,
  type CatalogSnapshotStatus,
  type CatalogSnapshot,
  type CatalogSourceId,
} from '../../shared/modelCatalog.ts'
import { storeManager } from '../store/store.ts'
import { parseCatalogPayload } from './modelCatalogParsers.ts'
import { readCatalogStore, writeCatalogSnapshot } from './modelCatalogStore.ts'

/**
 * LiteLLM 的原始文件约 3.2 MB（4,500+ 条）；慢链路下 30s 不够，给 60s。
 * 这是「整体抓取」超时，不是单条解析超时。
 */
const FETCH_TIMEOUT_MS = 60_000
/** 失败时把响应体前 200 字符带进错误信息，便于区分代理页/限流页/真 JSON。 */
const ERROR_BODY_SNIPPET = 200

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

function failure(
  kind: CatalogRefreshErrorKind,
  error: string,
  startedAt: number,
  statuses: CatalogSnapshotStatus[],
): CatalogRefreshResult {
  return { success: false, errorKind: kind, error, statuses, elapsedMs: Date.now() - startedAt }
}

/**
 * 刷新一个来源。成功才写盘；任何失败（网络、HTTP 非 2xx、JSON 损坏、解析为空）
 * 都返回 `success:false`，磁盘上的旧快照保持不变，界面提示「保留上一份数据」。
 *
 * 三个来源彼此独立：只覆盖被刷新的来源，另一个来源失败不会清掉这里的快照。
 */
export async function refreshCatalog(source: CatalogSourceId): Promise<CatalogRefreshResult> {
  const meta = CATALOG_SOURCE_META[source]
  const startedAt = Date.now()
  try {
    const response = await fetch(meta.sourceUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      // raw.githubusercontent 会 301/302 到 CDN；显式跟随，避免把重定向当成失败。
      redirect: 'follow',
      headers: {
        accept: 'application/json',
        'user-agent': 'ModelPort model-catalog refresh (manual)',
      },
    })
    if (!response.ok) {
      let detail = ''
      try {
        detail = snippetOf(await response.text())
      } catch {
        // 读响应体失败不影响「HTTP 非 2xx」这个结论。
      }
      return failure(
        'http',
        `HTTP ${response.status} ${response.statusText}${detail ? `：${detail}` : ''}`,
        startedAt,
        catalogSnapshotStatuses(await readCatalogStore()),
      )
    }
    const text = await response.text()
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return failure(
        'parse',
        `响应不是合法 JSON（${text.length} 字节）：${message}`,
        startedAt,
        catalogSnapshotStatuses(await readCatalogStore()),
      )
    }
    const entries = parseCatalogPayload(source, raw)
    if (entries.length === 0) {
      return failure(
        'empty',
        '响应中没有可用的模型条目（保留上一份快照）',
        startedAt,
        catalogSnapshotStatuses(await readCatalogStore()),
      )
    }
    const store = await writeCatalogSnapshot({
      source,
      sourceUrl: meta.sourceUrl,
      fetchedAt: new Date().toISOString(),
      contentHash: sha256(text),
      license: meta.license,
      attribution: meta.attribution,
      entries,
    })
    return {
      success: true,
      status: catalogSnapshotStatuses(store).find((item) => item.source === source),
      statuses: catalogSnapshotStatuses(store),
      elapsedMs: Date.now() - startedAt,
    }
  } catch (error) {
    const classified = classifyFetchError(error)
    return failure(
      classified.kind,
      classified.message,
      startedAt,
      catalogSnapshotStatuses(await readCatalogStore()),
    )
  }
}

/** 当前快照元数据（不含 entries）；页面打开只读这一份，不联网。 */
export async function getCatalogStatuses(): Promise<CatalogSnapshotStatus[]> {
  return catalogSnapshotStatuses(await readCatalogStore())
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
  const store = await readCatalogStore()
  const matches = matchCatalogEntries(catalogIndexFromStore(store), {
    modelId: input.actualModelId,
    displayName: input.displayName,
  })
  return {
    statuses: catalogSnapshotStatuses(store),
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
  const known =
    provider.modelCapabilities?.[input.displayName] !== undefined ||
    provider.modelMappings?.[input.displayName] !== undefined
  if (!known) return { success: false, error: '模型不属于该供应商' }

  const store = await readCatalogStore()
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
