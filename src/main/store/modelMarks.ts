/**
 * 手工能力标注的归一与合并。
 *
 * 手工标注是 `userModelMarks` 里的一层，路由解析时**叠加在**自动标注之上。
 * 两条规则决定了本文件的所有实现：
 *
 * - **只覆盖写了的字段。** 用户只把 `vision` 改成 `no`，`tools` / `contextTokens`
 *   仍然走自动标注；把整条记录当成完整快照会把没写的字段一起清成未知。
 * - **`unknown` 不是可标注的值。** 三态里的 `unknown` 表示「没有证据」，用户想
 *   表达它只能删掉这条标注（清空后回到自动结果），所以写入时把 `unknown` 当作
 *   未写，而不是存一个 `unknown` 进去再遮住自动证据。
 */
import type { InputModality, ModelCapabilityHint } from '../../shared/types.ts'
import { parseSlotBoundary, type DiscountSlot, type DiscountWindow } from '../../shared/discountWindow.ts'

const TIERS = new Set(['fast', 'balanced', 'strong'])
const STATES = new Set(['yes', 'no'])
const MODALITIES = new Set<InputModality>(['text', 'image', 'audio', 'video', 'pdf'])

/** 上下文窗口的合理上界：防止手滑输入 1e12 让「长上下文」策略永远命中 */
const MAX_CONTEXT_TOKENS = 100_000_000
/**
 * 输出上限的合理上界。比上下文窗口低两个量级：没有任何模型能一次产出百万级
 * token，写成 1e12 会让「请求的 max_tokens 是否超过能力」的硬过滤永远判为够用。
 * UI（`RoutePoolEditor`）用同一个数做前置校验并给出人读提示。
 */
const MAX_OUTPUT_TOKENS = 1_000_000

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0
    ? value
    : undefined
}

/** 倍率一类的读数：非负有限数，其它一律丢弃。`0` 是合法值（免费）。 */
function nonNegativeFinite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/**
 * 手工折扣窗口：{@link normalizeModelMark} 的边界收敛。
 *
 * 手工窗口存在的理由是「渠道没报窗口，但用户知道折扣几点开」—— 所以它可以
 * 单独出现，不必配 `promoWeight`（那种情况窗口只是把 `weight` 变成时变的）。
 * 非法时段一律丢弃而不是猜：一个读不懂的时段按宿主规则会被读成「一直生效」，
 * 于是整天的价格都按折后算。
 */
function normalizeDiscountWindow(value: unknown): DiscountWindow | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const window: DiscountWindow = {}

  if (Array.isArray(raw.daily)) {
    const daily: DiscountSlot[] = []
    for (const entry of raw.daily as unknown[]) {
      if (typeof entry !== 'object' || entry === null) continue
      const slot = entry as Record<string, unknown>
      const start = parseSlotBoundary(slot.start)
      const end = parseSlotBoundary(slot.end)
      if (start === undefined || end === undefined) continue
      daily.push({
        start: String(slot.start).trim(),
        end: String(slot.end).trim(),
      })
    }
    if (daily.length > 0) window.daily = daily
  }
  if (typeof raw.timezone === 'string' && raw.timezone.trim().length > 0) {
    window.timezone = raw.timezone.trim()
  }
  const validFrom = epochMs(raw.validFrom)
  if (validFrom !== undefined) window.validFrom = validFrom
  const validUntil = epochMs(raw.validUntil)
  if (validUntil !== undefined) window.validUntil = validUntil

  // 一个字段都没有的窗口等于没写：存下去只会遮住渠道报的那份。
  return Object.keys(window).length === 0 ? undefined : window
}

function epochMs(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : undefined
}

/**
 * 把来自 IPC 的未知输入收敛成一条可存储的标注；没有有效字段时返回 `undefined`
 * （调用方据此删除该条，而不是存一个空对象遮住自动标注）。
 */
export function normalizeModelMark(input: unknown): ModelCapabilityHint | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const raw = input as Record<string, unknown>

  const mark: ModelCapabilityHint = {}

  if (typeof raw.tier === 'string' && TIERS.has(raw.tier)) {
    mark.tier = raw.tier as ModelCapabilityHint['tier']
  }
  for (const field of ['vision', 'tools', 'reasoning'] as const) {
    const value = raw[field]
    if (typeof value === 'string' && STATES.has(value)) {
      mark[field] = value as 'yes' | 'no'
    }
  }
  if (Array.isArray(raw.modalities)) {
    const modalities: InputModality[] = []
    for (const entry of raw.modalities as unknown[]) {
      if (typeof entry !== 'string' || !MODALITIES.has(entry as InputModality)) continue
      if (!modalities.includes(entry as InputModality)) modalities.push(entry as InputModality)
    }
    if (modalities.length > 0) mark.modalities = modalities
  }
  const contextTokens = positiveInt(raw.contextTokens)
  if (contextTokens !== undefined && contextTokens <= MAX_CONTEXT_TOKENS) {
    mark.contextTokens = contextTokens
  }
  const maxOutputTokens = positiveInt(raw.maxOutputTokens)
  if (maxOutputTokens !== undefined && maxOutputTokens <= MAX_OUTPUT_TOKENS) {
    mark.maxOutputTokens = maxOutputTokens
  }
  if (typeof raw.weight === 'number' && Number.isFinite(raw.weight) && raw.weight >= 0) {
    mark.weight = raw.weight
  }
  const baseWeight = nonNegativeFinite(raw.baseWeight)
  if (baseWeight !== undefined) mark.baseWeight = baseWeight
  const promoWeight = nonNegativeFinite(raw.promoWeight)
  if (promoWeight !== undefined) mark.promoWeight = promoWeight
  const discountWindow = normalizeDiscountWindow(raw.discountWindow)
  if (discountWindow !== undefined) mark.discountWindow = discountWindow
  if (typeof raw.free === 'boolean') {
    mark.free = raw.free
  }

  return Object.keys(mark).length === 0 ? undefined : mark
}
