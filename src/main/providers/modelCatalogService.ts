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
  type CatalogRefreshResult,
  type CatalogSnapshotStatus,
  type CatalogSnapshot,
  type CatalogSourceId,
} from '../../shared/modelCatalog.ts'
import { storeManager } from '../store/store.ts'
import { parseCatalogPayload } from './modelCatalogParsers.ts'
import { readCatalogStore, writeCatalogSnapshot } from './modelCatalogStore.ts'

const FETCH_TIMEOUT_MS = 30_000

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * 刷新一个来源。成功才写盘；任何失败（网络、HTTP 非 2xx、JSON 损坏、解析为空）
 * 都返回 `success:false`，磁盘上的旧快照保持不变，界面提示「保留上一份数据」。
 */
export async function refreshCatalog(source: CatalogSourceId): Promise<CatalogRefreshResult> {
  const meta = CATALOG_SOURCE_META[source]
  try {
    const response = await fetch(meta.sourceUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        accept: 'application/json',
        'user-agent': 'ModelPort model-catalog refresh (manual)',
      },
    })
    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status} ${response.statusText}`,
        statuses: catalogSnapshotStatuses(await readCatalogStore()),
      }
    }
    const text = await response.text()
    const raw: unknown = JSON.parse(text)
    const entries = parseCatalogPayload(source, raw)
    if (entries.length === 0) {
      return {
        success: false,
        error: '响应中没有可用的模型条目（保留上一份快照）',
        statuses: catalogSnapshotStatuses(await readCatalogStore()),
      }
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
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      error: message,
      statuses: catalogSnapshotStatuses(await readCatalogStore()),
    }
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
