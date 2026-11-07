/**
 * Normalisation for the virtual `auto` model's routing configuration.
 *
 * Kept apart from `store.ts` so it can be tested without electron: a
 * hand-edited `data.json` must never push the router into absurd values.
 */
import type { AutoPoolStrategy, AutoPoolStrategyId, AutoRoutingConfig } from '../../shared/types.ts'
import {
  AUTO_PREFERENCES,
  AUTO_POOL_STRATEGY_IDS,
  DEFAULT_AUTO_ROUTING_CONFIG,
} from '../../shared/types.ts'

/**
 * Normalise the strategy sequence:
 * - 非法策略 id 剔除（只保留在元数据表里存在的 id）；
 * - 非法 operator 回落为 `and`；
 * - 第一个策略的 operator 忽略，但保留原值（不静默改写用户输入）；
 * - 未知即未知：剔除后为空数组就是不过滤，不报错。
 */
function normalizePoolStrategies(input: unknown): AutoPoolStrategy[] {
  if (!Array.isArray(input)) return []

  const ids = new Set<string>(AUTO_POOL_STRATEGY_IDS)
  const out: AutoPoolStrategy[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as { id?: unknown; operator?: unknown }
    if (typeof entry.id !== 'string' || !ids.has(entry.id)) continue
    const operator = entry.operator === 'or' ? 'or' : 'and'
    out.push({ id: entry.id as AutoPoolStrategyId, operator })
  }
  return out
}

export function normalizeAutoRoutingConfig(input?: Partial<AutoRoutingConfig>): AutoRoutingConfig {
  const merged = { ...DEFAULT_AUTO_ROUTING_CONFIG, ...(input || {}) }
  const attempts = Number(merged.maxAttempts)
  const sticky = Number(merged.stickyMinutes)
  const affinity = Number(merged.cacheAffinityMinutes)
  return {
    enabled: merged.enabled !== false,
    maxAttempts: Number.isFinite(attempts)
      ? Math.min(5, Math.max(1, Math.round(attempts)))
      : DEFAULT_AUTO_ROUTING_CONFIG.maxAttempts,
    stickyMinutes: Number.isFinite(sticky)
      ? Math.min(1440, Math.max(0, Math.round(sticky)))
      : DEFAULT_AUTO_ROUTING_CONFIG.stickyMinutes,
    cacheAffinityMinutes: Number.isFinite(affinity)
      ? Math.min(1440, Math.max(0, Math.round(affinity)))
      : DEFAULT_AUTO_ROUTING_CONFIG.cacheAffinityMinutes,
    // 非法偏好回落默认值，而不是让一次手写配置把路由打回未知分支
    prefer: AUTO_PREFERENCES.includes(merged.prefer)
      ? merged.prefer
      : DEFAULT_AUTO_ROUTING_CONFIG.prefer,
    poolStrategies: normalizePoolStrategies(merged.poolStrategies),
  }
}
