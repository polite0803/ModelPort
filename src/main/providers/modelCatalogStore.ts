/**
 * 标准模型库快照的读写（衍生数据，可删除重建）。
 *
 * 路径：`<storage>/derived/model-catalog.json`。写盘用「唯一临时文件 + rename」，
 * 与探测 sidecar 同一套原子写口径；读取时任何缺失/损坏都降级为空台账，
 * 界面据此显示「尚未抓取」，而不是让页面报错。
 */
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { join } from 'path'
import { storeManager } from '../store/store.ts'
import {
  EMPTY_CATALOG_STORE,
  sanitizeCatalogStore,
  type CatalogSnapshot,
  type CatalogStore,
} from '../../shared/modelCatalog.ts'

export function modelCatalogSidecarPath(): string {
  return join(storeManager.getStoragePath(), 'derived', 'model-catalog.json')
}

export async function readCatalogStore(): Promise<CatalogStore> {
  try {
    const raw = await readFile(modelCatalogSidecarPath(), 'utf8')
    return sanitizeCatalogStore(JSON.parse(raw))
  } catch {
    // 文件不存在 / JSON 损坏：标准库层缺席，不是错误。
    return EMPTY_CATALOG_STORE
  }
}

/**
 * 写入一份来源快照，保留其他来源的旧快照。
 *
 * 刷新只覆盖被刷新的那一份：models.dev 抓取失败时，LiteLLM 的旧快照仍在，
 * 匹配不会因一个来源变空而整体失效。
 */
export async function writeCatalogSnapshot(snapshot: CatalogSnapshot): Promise<CatalogStore> {
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
  return next
}
