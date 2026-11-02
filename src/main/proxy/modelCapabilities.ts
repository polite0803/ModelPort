/**
 * 模型能力参考数据，供 `auto` 路由做硬过滤与档位打分。
 *
 * 三条来源，优先级由 `resolveCapability` 决定：
 * - 供应商记录里的 `modelCapabilities`（账号渠道同步写入，动态、最权威）；
 * - 本文件的静态表（按供应商记录 id / 模型名）；
 * - 名字启发式与"未知"兜底（见 autoRouting.ts）。
 *
 * ⚠️ 表里的 providerId 是**供应商记录 id**，不是品牌名：内置供应商用
 * `opencode`，聚合供应商用 registry 的条目 id（`glm` / `kimi` / …），账号渠道
 * 用渠道 id。聚合供应商的展示名带 `<entryId>/` 前缀，所以查询会先拆掉前缀再
 * 命中一次——这正是这张表此前失效的原因（只按整名查，`glm-5.3` 永远查不到
 * `glm/glm-5.3`）。
 *
 * ⚠️ 缺失一律保持未知，不落任何默认值。`vision` 只有在确认能收图片时才是
 * `yes`；`no` 表示已确认不能。
 */
import type { ModelCapabilityHint } from '../../shared/types'
import { AGGREGATE_QUOTA } from '../../shared/aggregateQuota.ts'

/**
 * 供应商级兜底，只在模型没有自己的标注时使用。
 *
 * `glm` / `kimi` / `minimax` 的 `vision: yes` 继承自已退役的网页适配器（它们
 * 当时能把图片放进上游请求）；对走 OpenAI 兼容线路的聚合条目而言这是**未复核
 * 的假设**，但收紧会让图片请求失去今天能用的目标，所以保持原值，单列取证再改。
 */
const PROVIDER_DEFAULT_CAPABILITY: Record<string, ModelCapabilityHint> = {
  deepseek: { vision: 'no' },
  glm: { vision: 'yes' },
  kimi: { vision: 'yes' },
  zai: { vision: 'no' },
  // 账号渠道的 12 个适配器都原生支持工具调用（2026-10-30 盘点；vendor 里唯一
  // `delete body.tools` 是 `tool_choice:'none'` 归一化）。这里给渠道默认
  // `tools:'yes'`，否则 Codex 这类工具请求会对每个账户渠道模型扣 0.15 的
  // 「工具未知」分，聚合免费池（有 tools/reasoning 标注）会长期压过账户渠道。
  // 供应商记录里的 `tools:'no'` 仍然优先于本默认层。
  opencode: { tools: 'yes' },
  lobsterai: { tools: 'yes' },
  qoder: { tools: 'yes' },
  qodercn: { tools: 'yes' },
  trae: { tools: 'yes' },
  cline: { tools: 'yes' },
  loomy: { tools: 'yes' },
  raccoon: { tools: 'yes' },
  zcode: { tools: 'yes' },
  buddy: { tools: 'yes' },
  workbuddy: { tools: 'yes' },
  gemini: { tools: 'yes' },
  minimax: { vision: 'yes', tools: 'yes' },
}

/** 已确认能力的模型行，键为小写模型名（不含 `<provider>/` 前缀） */
const MODEL_CAPABILITIES: Record<string, Record<string, ModelCapabilityHint>> = {
  // 本机 OpenCode 运行时暴露的免费池：全部零计费，运行时支持工具调用。
  // 只有 `nemotron-3.5-super-vl-free` 名字里带 VL，其余不猜多模态。
  opencode: {
    'glm-5.3-flash-free': { tier: 'balanced', tools: 'yes', free: true },
    'deepseek-v4.1-flash-free': { tier: 'fast', tools: 'yes', free: true },
    'big-pickle': { tier: 'balanced', tools: 'yes', free: true },
    'mimo-v2.6-flash-free': { tier: 'fast', tools: 'yes', free: true },
    'nemotron-3-ultra-free': { tier: 'strong', tools: 'yes', free: true },
    'nemotron-3.5-lightning-free': { tier: 'fast', tools: 'yes', free: true },
    'nemotron-3.5-super-vl-free': { tier: 'balanced', vision: 'yes', tools: 'yes', free: true },
    'beam-free': { tier: 'balanced', tools: 'yes', free: true },
    'flint-40b-free': { tier: 'balanced', tools: 'yes', free: true },
  },
  deepseek: {
    'deepseek-default': { tier: 'balanced' },
    'deepseek-expert': { tier: 'strong' },
    // 识图模式虽有独立入口，但 adapter 目前不上传图片，因此不参与多模态路由
    'deepseek-vision': { tier: 'balanced', vision: 'no' },
  },
  glm: {
    'glm-5.3': { tier: 'strong', vision: 'yes', contextTokens: 128000 },
    'glm-5.3-flash': { tier: 'fast', vision: 'yes' },
  },
  kimi: {
    k3: { tier: 'strong', vision: 'yes', contextTokens: 128000 },
    'k2.8': { tier: 'strong', vision: 'yes', contextTokens: 128000 },
    // chat-only model: the site exposes no file handling for it
    instant: { tier: 'fast', vision: 'no' },
    // legacy display name, same capability the old entry described
    'kimi-k2.6': { tier: 'strong', vision: 'yes', contextTokens: 128000 },
  },
  minimax: {
    'm3.1-flash': { tier: 'balanced', vision: 'yes', contextTokens: 128000 },
    m3: { tier: 'strong', vision: 'yes', contextTokens: 128000 },
    // legacy display name, kept so old client configs route the same way
    'minimax-m2.7': { tier: 'balanced', vision: 'yes', contextTokens: 128000 },
  },
  zai: {
    'glm-5.1': { tier: 'strong' },
    'glm-5': { tier: 'strong' },
    'glm-5-turbo': { tier: 'fast' },
    'glm-5v-turbo': { tier: 'balanced' },
    'glm-4.7': { tier: 'balanced' },
  },
}

/** 聚合条目的上下文上限：先看该模型自己的行，再退回条目级值。 */
export function aggregateContextWindow(providerId: string, modelId: string): number | undefined {
  const entry = AGGREGATE_QUOTA[providerId]
  if (!entry) return undefined
  const perModel = entry.perModel?.find(row => row.modelId === modelId)?.contextWindow
  return typeof perModel === 'number' ? perModel : entry.contextWindow
}

/**
 * 查静态表。展示名先按整名查（账号渠道写的是完整展示名），未命中再去掉
 * 最后一个 `/` 之前的部分重查一次（聚合是 `<entryId>/<modelId>`，账号渠道是
 * `<渠道名> / <模型名>`）。
 */
export function staticCapabilityHint(providerId: string, displayName: string): ModelCapabilityHint | undefined {
  const table = MODEL_CAPABILITIES[providerId.toLowerCase()]
  if (!table) return undefined

  const full = displayName.trim().toLowerCase()
  const exact = table[full]
  if (exact) return exact

  const slash = full.lastIndexOf('/')
  if (slash < 0) return undefined
  return table[full.slice(slash + 1).trim()]
}

export function providerDefaultCapability(providerId: string): ModelCapabilityHint | undefined {
  return PROVIDER_DEFAULT_CAPABILITY[providerId.toLowerCase()]
}

/** 仅测试与诊断用：暴露表内容，避免测试复制一份数据 */
export function listModelCapabilities(providerId: string): Record<string, ModelCapabilityHint> {
  return MODEL_CAPABILITIES[providerId.toLowerCase()] ?? {}
}
