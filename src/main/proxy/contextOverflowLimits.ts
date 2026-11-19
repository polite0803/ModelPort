/**
 * 上游亲口给出的上下文输入上界，按 `(provider, 模型)` 记在内存里。
 *
 * 为什么要记：目录里的窗口多数是第三方转述（models.dev / LiteLLM），可能比上游
 * 实际接受的上限**大**（2026-11-19：`modelscope/Qwen3.5-35B-A3B` 目录 262,144，
 * 上游 400 明说 `Range of input length should be [1, 258048]`）。差 1.5% 就足够让
 * 「适配闸看着装得下、上游当场拒」反复发生：估计器本身还是偏低的 4 字符/token。
 *
 * 记下来的数是**上游判决**，不是我们推的：只从明确写出区间的报文里取
 * （`measuredContextLimitFromError`）。它同时喂两处：
 * - 转发器的裁剪预算（同一模型下一轮不必再撞一次 400）；
 * - 路由层的适配闸（隐藏超过它的候选，不再派发）。
 *
 * 只在内存里，随进程生命周期存在（与模型熔断同一档）。进程重启后每个模型最多
 * 再撞一次 400 就重新学到 —— 不为此改 `data.json` 的结构，也不碰共享工作树里的
 * 配置文件。TTL 24h：上游抬高上限时旧读数会自己过期。
 */
import { measuredContextLimitFromError } from './failover.ts'

const TTL_MS = 24 * 60 * 60 * 1000

const limits = new Map<string, { limit: number; at: number }>()

function keyOf(providerId: string, actualModel: string): string {
  return `${providerId}\u0000${actualModel}`
}

export function recordMeasuredContextLimit(
  providerId: string,
  actualModel: string,
  limit: number,
  nowMs: number = Date.now()
): void {
  if (!Number.isFinite(limit) || limit <= 0) return
  limits.set(keyOf(providerId, actualModel), { limit, at: nowMs })
}

/**
 * 从一条上游错误里学上界。返回是否学到了 —— 调用方据此决定要不要做「强制裁后重发」。
 */
export function recordMeasuredContextLimitFromError(
  providerId: string,
  actualModel: string,
  message: string | undefined,
  nowMs: number = Date.now()
): boolean {
  const limit = measuredContextLimitFromError(message)
  if (limit === undefined) return false
  recordMeasuredContextLimit(providerId, actualModel, limit, nowMs)
  return true
}

export function measuredContextLimitOf(
  providerId: string,
  actualModel: string,
  nowMs: number = Date.now()
): number | undefined {
  const key = keyOf(providerId, actualModel)
  const hit = limits.get(key)
  if (hit === undefined) return undefined
  if (nowMs - hit.at > TTL_MS) {
    limits.delete(key)
    return undefined
  }
  return hit.limit
}

/** 测试用：清空读数，避免用例之间互相污染。 */
export function clearMeasuredContextLimits(): void {
  limits.clear()
}