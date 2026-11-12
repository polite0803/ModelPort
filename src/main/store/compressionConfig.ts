/**
 * Normalisation for the context-compression configuration.
 *
 * Kept apart from `store.ts` so it can be tested without electron: a hand-edited
 * `data.json` must never enable compression with an unrecognised strength, and a
 * pre-upgrade install (no `compression` key at all) inherits the shipped
 * default. A user who explicitly turned the feature off keeps it off.
 */
import type { CompressionConfig } from '../../shared/types.ts'
import { isCacheSensitive, promptCacheOf } from '../../shared/promptCache.ts'
import { getAggregateEntry } from '../providers/aggregate/registry.ts'
import {
  COMPRESSION_AGGRESSIVENESS,
  DEFAULT_COMPRESSION_CONFIG,
  OUTPUT_CONTRACT_LEVELS,
} from '../../shared/types.ts'

export function normalizeCompressionConfig(
  input?: Partial<CompressionConfig> | null
): CompressionConfig {
  // An absent or non-object value falls back to the shipped default.
  if (!input || typeof input !== 'object') return { ...DEFAULT_COMPRESSION_CONFIG }

  const overrides: Record<string, boolean> = {}
  for (const [providerId, value] of Object.entries(input.providerOverrides ?? {})) {
    const key = providerId.trim()
    if (key.length > 0 && typeof value === 'boolean') overrides[key] = value
  }

  // 输出契约只在显式给到合法档位时存在。未知档位落回「不注入」，而不是猜一个：
  // 一个拼错的 `minmal` 不该悄悄把模型改成极简模式。
  const requestedLevel = input.outputContract?.level
  const outputContract =
    requestedLevel !== undefined && OUTPUT_CONTRACT_LEVELS.includes(requestedLevel)
      ? { level: requestedLevel }
      : undefined

  return {
    // Only an explicit `true` enables it; an explicit `false` keeps it off even
    // though the shipped default is on. A stray non-boolean also lands on off.
    enabled: input.enabled === true,
    aggressiveness: COMPRESSION_AGGRESSIVENESS.includes(
      input.aggressiveness as CompressionConfig['aggressiveness']
    )
      ? (input.aggressiveness as CompressionConfig['aggressiveness'])
      : DEFAULT_COMPRESSION_CONFIG.aggressiveness,
    // Absent inherits the shipped default; only an explicit `false` turns the
    // cache-first policy off.
    cacheFirst: input.cacheFirst === undefined ? DEFAULT_COMPRESSION_CONFIG.cacheFirst : input.cacheFirst === true,
    ...(outputContract === undefined ? {} : { outputContract }),
    ...(input.foldDuplicates === true ? { foldDuplicates: true } : {}),
    ...(Object.keys(overrides).length > 0 ? { providerOverrides: overrides } : {}),
  }
}

/**
 * Resolve the effective compression switch for one provider.
 *
 * Order matters: an explicit per-provider override wins; otherwise a provider
 * with a documented prefix cache whose cached input is much cheaper than fresh
 * input skips compression. The second rule is the P2-D2 "cache-first" policy —
 * a compressed live block is discarded by the next turn's original bytes, and
 * at a 0.02–0.1 read discount that trade loses more than it saves.
 */
export function resolveCompressionConfig(
  config: CompressionConfig,
  provider: { id: string; type?: string; aggregateId?: string }
): CompressionConfig {
  const override = config.providerOverrides?.[provider.id]
  if (override !== undefined) return { ...config, enabled: override }

  if (config.enabled && config.cacheFirst !== false) {
    const entry = provider.type === 'aggregate' && provider.aggregateId
      ? getAggregateEntry(provider.aggregateId)
      : undefined
    if (isCacheSensitive(promptCacheOf(entry))) return { ...config, enabled: false }
  }

  return config
}
