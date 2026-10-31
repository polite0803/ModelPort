/**
 * 模型清单来源判定
 *
 * 一个供应商的清单有两种来路：HTTP 端点（`modelsFetch` 声明）或没有。
 * 第三种「本机运行时」已于 2026-11-01 随 OpenCode 内置供应商一起退役——它的分发
 * 前提（npm 上有可用客户端）不成立了，判定分支留着也永远走不到。
 */

export type ModelListSource = 'http' | 'unsupported'

export interface ModelListSourceConfig {
  modelsFetch?: unknown
}

export function resolveModelListSource(
  config: ModelListSourceConfig | undefined | null
): ModelListSource {
  if (config?.modelsFetch) return 'http'
  return 'unsupported'
}
