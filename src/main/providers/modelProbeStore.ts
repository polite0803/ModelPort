/**
 * 探测 sidecar 的读写（衍生数据，可删除重建）。
 *
 * 路径：`<storage>/derived/model-probes.json`。写盘用「唯一临时文件 + rename」，
 * 与日志持久化同一套原子写口径，避免进程中断留下半份 JSON。
 */
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { join } from 'path'
import { storeManager } from '../store/store.ts'
import {
  EMPTY_PROBE_SIDECAR,
  sanitizeProbeSidecar,
  upsertProbeRow,
  type ModelProbeRow,
  type ModelProbeSidecar,
} from '../../shared/modelProbe.ts'

export function modelProbeSidecarPath(): string {
  return join(storeManager.getStoragePath(), 'derived', 'model-probes.json')
}

export async function readModelProbeSidecar(): Promise<ModelProbeSidecar> {
  try {
    const raw = await readFile(modelProbeSidecarPath(), 'utf8')
    return sanitizeProbeSidecar(JSON.parse(raw))
  } catch {
    // 文件不存在 / JSON 损坏一律回到空表：sidecar 只承载 probe 层，缺失不是错误。
    return EMPTY_PROBE_SIDECAR
  }
}

/**
 * 选号热路径用的同步视图。
 *
 * 探测表是异步 JSON，而 `autoRouter::select` 同步执行且每请求一次 —— 在热路径里
 * `await` 读盘或逐候选读表都会重演 1.6.1 那次「一次选号几百次同步 I/O」的卡顿。
 * 因此这里只留一份进程内快照：启动时 prime 一次，之后每次写盘就地刷新，读的一侧
 * 永远是内存。代价是跨进程不共享（本应用单实例锁保证只有一个写者）。
 */
let cachedRows: readonly ModelProbeRow[] = EMPTY_PROBE_SIDECAR.rows

export function getProbeRowsSync(): readonly ModelProbeRow[] {
  return cachedRows
}

/** 启动期灌一次快照；文件缺失按空表处理，不是错误。 */
export async function primeModelProbeCache(): Promise<void> {
  cachedRows = (await readModelProbeSidecar()).rows
}

export async function writeModelProbeRows(rows: readonly ModelProbeRow[]): Promise<void> {
  const path = modelProbeSidecarPath()
  await mkdir(join(storeManager.getStoragePath(), 'derived'), { recursive: true })
  const payload = JSON.stringify({ version: 1, rows }, null, 2)
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, payload, 'utf8')
  await rename(temp, path)
  // 写盘成功后才刷新，失败时同步视图留在上一份已知好的数据上，不会读到半份状态。
  cachedRows = rows
}

/** 写入一行实测读数（同键替换旧行），返回写入后的全量行。 */
export async function recordModelProbe(row: ModelProbeRow): Promise<ModelProbeRow[]> {
  const sidecar = await readModelProbeSidecar()
  const rows = upsertProbeRow(sidecar.rows, row)
  await writeModelProbeRows(rows)
  return rows
}
