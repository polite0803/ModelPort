/**
 * 「这一家的上游目录里没有这个模型」类失败的短期冷却。
 *
 * 聚合条目（ModelScope / BazaarLink 这类多厂商网关）的静态目录是编译期快照，
 * 上游下架或改名模型后它不会自己跟着变。`mergeAggregateModelIds` 又刻意只增不减
 * （保护用户手工裁剪的清单），于是下架模型会**一直**留在候选池里：每笔 auto
 * 请求都先撞一次 400，再换下一家。
 *
 * 2026-11-06 WSL 日志里的量级：8 小时内 `modelscope` 的
 * `has no provider supported` 命中 11 次（MiniMax-M3 / Step-3.7-Flash / Hy3），
 * `bazaarlink` 的 `Unknown model` 3 次。这些尝试不烧上游额度（请求在生成前被拒），
 * 但每次都要付 0.1–3.5s 的往返，并把候选链拖长。
 *
 * 口径：只认 `failover::isUpstreamCatalogMissError` 那三句窄文案；不记账号故障、
 * 不影响 `/v1/models` 的广告口径（广告仍按 enabled 状态），只在**选路**时剔除。
 * 冷却到期后自动回到池里 —— 上游补回模型或目录同步修正时不需要人工干预。
 */
const DEFAULT_COOLDOWN_MS = 6 * 60 * 60 * 1000

const cooldowns = new Map<string, number>()

function keyOf(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`
}

/** 记一次目录缺失。空 id 不记，避免把「适配器没填模型」写成全域冷却。 */
export function recordCatalogMiss(
  providerId: string,
  modelId: string,
  now: number = Date.now(),
  cooldownMs: number = DEFAULT_COOLDOWN_MS,
): void {
  if (!providerId || !modelId) return
  // 顺手清掉过期项：这张表按 (provider, model) 增长，长时间运行不该只增不减。
  for (const [key, until] of cooldowns) {
    if (until <= now) cooldowns.delete(key)
  }
  cooldowns.set(keyOf(providerId, modelId), now + cooldownMs)
}

/** 选路时判断这个 (provider, model) 是否还在目录缺失冷却里。 */
export function isCatalogMissCoolingDown(
  providerId: string,
  modelId: string,
  now: number = Date.now(),
): boolean {
  const key = keyOf(providerId, modelId)
  const until = cooldowns.get(key)
  if (until === undefined) return false
  if (until <= now) {
    cooldowns.delete(key)
    return false
  }
  return true
}

/** 测试与代理重启用：清空全部冷却。 */
export function clearCatalogMissCooldowns(): void {
  cooldowns.clear()
}
