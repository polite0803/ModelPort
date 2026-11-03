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

export async function writeModelProbeRows(rows: readonly ModelProbeRow[]): Promise<void> {
  const path = modelProbeSidecarPath()
  await mkdir(join(storeManager.getStoragePath(), 'derived'), { recursive: true })
  const payload = JSON.stringify({ version: 1, rows }, null, 2)
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, payload, 'utf8')
  await rename(temp, path)
}

/** 写入一行实测读数（同键替换旧行），返回写入后的全量行。 */
export async function recordModelProbe(row: ModelProbeRow): Promise<ModelProbeRow[]> {
  const sidecar = await readModelProbeSidecar()
  const rows = upsertProbeRow(sidecar.rows, row)
  await writeModelProbeRows(rows)
  return rows
}
