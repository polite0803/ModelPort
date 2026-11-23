/**
 * 模型管理页「重点」名单的归一与读取。
 *
 * 这是一张独立的派发意图表，不是能力标注：这里只做外部数据的边界校验，不解释
 * 「这个模型能做什么」。路由选号侧通过 `isKeyModel` 读取，绝不反过来写这张表。
 */
import type { KeyModels } from '../../shared/types.ts'

export const MAX_KEY_MODELS_PER_PROVIDER = 512

/** 读盘/跨进程传参的边界：只保留合法、去重后的 `providerId -> displayName[]`。 */
export function normalizeKeyModels(input: unknown): KeyModels {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return {}
  const result: KeyModels = {}
  for (const [rawProviderId, rawNames] of Object.entries(input)) {
    const providerId = rawProviderId.trim()
    if (providerId.length === 0 || !Array.isArray(rawNames)) continue
    const seen = new Set<string>()
    const names: string[] = []
    for (const rawName of rawNames) {
      if (typeof rawName !== 'string') continue
      const displayName = rawName.trim()
      if (displayName.length === 0 || seen.has(displayName)) continue
      seen.add(displayName)
      names.push(displayName)
      if (names.length >= MAX_KEY_MODELS_PER_PROVIDER) break
    }
    if (names.length > 0) result[providerId] = names
  }
  return result
}

/** 展示名按目录原文精确匹配：这里不是模糊搜索，打错名字就该是「没标」。 */
export function isKeyModel(table: KeyModels, providerId: string, displayName: string): boolean {
  return (table[providerId] ?? []).includes(displayName)
}
