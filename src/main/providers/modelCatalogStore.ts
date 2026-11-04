/**
 * 标准模型库快照的读写（衍生数据，可删除重建）。
 *
 * 路径：`<storage>/derived/model-catalog.json`。写盘用「唯一临时文件 + rename」，
 * 与探测 sidecar 同一套原子写口径；读取时任何缺失/损坏都降级为空台账，
 * 界面据此显示「尚未抓取」，而不是让页面报错。
 */
import { existsSync, readFileSync, statSync } from 'fs'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { join } from 'path'
import { storeManager } from '../store/store.ts'
import {
  EMPTY_CATALOG_STORE,
  catalogSnapshotStatuses,
  sanitizeCatalogSnapshot,
  sanitizeCatalogStore,
  type CatalogSnapshot,
  type CatalogSnapshotStatus,
  type CatalogSourceId,
  type CatalogStore,
} from '../../shared/modelCatalog.ts'

export function modelCatalogSidecarPath(): string {
  return join(storeManager.getStoragePath(), 'derived', 'model-catalog.json')
}

/**
 * 进程内读缓存：批量补全会对每个模型读一次台账，每次都 `readFile + JSON.parse`
 * 会把「本地匹配」变成磁盘瓶颈。缓存键是 `mtime + size + 写入代次`，
 * 外部改文件或本进程写盘都会让签名变化；写盘后直接把新值放进缓存，避免再读一遍。
 */
interface CatalogStoreCache {
  signature: string
  store: CatalogStore
}

let storeGeneration = 0
let storeCache: CatalogStoreCache | undefined

function storeSignature(): string {
  try {
    const stat = statSync(modelCatalogSidecarPath())
    return `${stat.mtimeMs}:${stat.size}:${storeGeneration}`
  } catch {
    return `missing:${storeGeneration}`
  }
}

export async function readCatalogStore(): Promise<CatalogStore> {
  const signature = storeSignature()
  if (storeCache && storeCache.signature === signature) return storeCache.store
  try {
    const raw = await readFile(modelCatalogSidecarPath(), 'utf8')
    const store = sanitizeCatalogStore(JSON.parse(raw))
    storeCache = { signature, store }
    return store
  } catch {
    // 文件不存在 / JSON 损坏：标准库层缺席，不是错误。
    storeCache = { signature, store: EMPTY_CATALOG_STORE }
    return EMPTY_CATALOG_STORE
  }
}

/**
 * 随应用发布的内置快照路径：打包后走 `process.resourcesPath/catalog/litellm.json`
 * （electron-builder 的 `extraResources`），开发态回落到仓库的 `resources/catalog/`。
 * 两者都不存在时返回 undefined，功能退化为「尚未抓取」，而不是启动失败。
 */
export function builtinCatalogSnapshotPath(): string | undefined {
  const packagedRoot = (process as { resourcesPath?: string }).resourcesPath
  const candidates = [
    ...(packagedRoot ? [join(packagedRoot, 'catalog', 'litellm.json')] : []),
    join(process.cwd(), 'resources', 'catalog', 'litellm.json'),
  ]
  return candidates.find((candidate) => existsSync(candidate))
}

let builtinSnapshot: CatalogSnapshot | null | undefined

/**
 * 内置快照只读一次（约 1 MB）；批量补全会对每个模型查一次快照，重复读盘不可接受。
 * `undefined` 表示尚未读取，`null` 表示文件不存在/损坏。
 */
export function readBuiltinCatalogSnapshot(): CatalogSnapshot | undefined {
  if (builtinSnapshot !== undefined) return builtinSnapshot ?? undefined
  const path = builtinCatalogSnapshotPath()
  if (!path) {
    builtinSnapshot = null
    return undefined
  }
  try {
    const snapshot = sanitizeCatalogSnapshot(JSON.parse(readFileSync(path, 'utf8')))
    builtinSnapshot = snapshot ?? null
    return snapshot
  } catch {
    builtinSnapshot = null
    return undefined
  }
}

/**
 * 有效快照 = 用户快照优先；某个来源用户从未成功刷新过时，回退到内置快照。
 * 返回内置来源集合，界面据此标注「内置快照（日期）」。
 */
export async function readEffectiveCatalogStore(): Promise<{
  store: CatalogStore
  builtinSources: Set<CatalogSourceId>
}> {
  const store = await readCatalogStore()
  const builtin = readBuiltinCatalogSnapshot()
  if (!builtin || store.snapshots[builtin.source]) {
    return { store, builtinSources: new Set() }
  }
  return {
    store: {
      version: 1,
      snapshots: { ...store.snapshots, [builtin.source]: builtin },
    },
    builtinSources: new Set([builtin.source]),
  }
}

/** 有效快照元数据：内置来源带 `builtin: true`，用于界面明确标注。 */
export async function readEffectiveCatalogStatuses(): Promise<CatalogSnapshotStatus[]> {
  const { store, builtinSources } = await readEffectiveCatalogStore()
  return catalogSnapshotStatuses(store).map((status) =>
    builtinSources.has(status.source) ? { ...status, builtin: true } : status,
  )
}

/**
 * 写入一份来源快照，保留其他来源的旧快照。
 * 刷新只覆盖被刷新的那一份：models.dev 抓取失败时，LiteLLM 的旧快照仍在，
 * 匹配不会因一个来源变空而整体失效。
 *
 * 并发刷新（两个来源同时完成）会各自「读当前 → 合并 → 写回」；没有互斥时后写者
 * 读到的还是旧台账，会把先写者的来源覆盖掉。这里用一条进程内 Promise 链串行化
 * 整个读改写过程，写完直接把结果放进缓存。
 */
let writeChain: Promise<unknown> = Promise.resolve()

export function writeCatalogSnapshot(snapshot: CatalogSnapshot): Promise<CatalogStore> {
  const task = writeChain.then(
    () => writeCatalogSnapshotUnlocked(snapshot),
    () => writeCatalogSnapshotUnlocked(snapshot),
  )
  writeChain = task.catch(() => undefined)
  return task
}

async function writeCatalogSnapshotUnlocked(snapshot: CatalogSnapshot): Promise<CatalogStore> {
  const current = await readCatalogStore()
  const next: CatalogStore = {
    version: 1,
    snapshots: { ...current.snapshots, [snapshot.source]: snapshot },
  }
  const path = modelCatalogSidecarPath()
  await mkdir(join(storeManager.getStoragePath(), 'derived'), { recursive: true })
  const payload = JSON.stringify(next, null, 2)
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, payload, 'utf8')
  await rename(temp, path)
  storeGeneration += 1
  storeCache = { signature: storeSignature(), store: next }
  return next
}
