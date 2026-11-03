/**
 * 聚合条目的**逐模型消耗分类**：这是"这个模型要不要额外花钱"的唯一判据。
 *
 * 聚合目录与账号渠道是两套数据，不能合并（账号渠道的倍率是厂商在展示名里写死的
 * `x4.0`，聚合没有这个字段）。这里用三种互相独立的证据，按可信度排序：
 *
 * 1. **官方免费清单**（`AGGREGATE_OFFICIAL_FREE`，取证回执里带 docUrl 的
 *    `freeModelIds`）—— 厂商页面点名免费，最可信，但只有"是/否"没有数字；
 * 2. **目录免费标记**（registry 的 `freeModelsHint`）—— 转录自上游注册表，
 *    没有单独出处，可信度次之；
 * 3. **第三方标价**（`AGGREGATE_PRICE`，models.dev，USD / 1M tokens）——
 *    只能告诉我们"有没有价、价格是不是 0"，不能当倍率用（见下）。
 *
 * ⚠️ **零价 ≠ 免费。** 订阅制端点（Kimi Code、Z.ai / 智谱的 coding plan、千问与
 * 小米的 Token Plan、商汤 Token Plan、阿里云百炼 Token Plan、火山方舟
 * Coding/Agent Plan、阶跃星辰 Step Plan……）在 models.dev 上的边际价就是 0，因为
 * 额度已经买断在订阅里。把它标成"免费"会让用户以为能不花钱无限跑，而实际上
 * 用完套餐额度就停。这类条目单列成 `included`（套餐内），判定依据是手写清单
 * `AGGREGATE_PLAN_ENTRIES`，每条带理由 —— 不按 id 里有没有 "plan" 去正则匹配，
 * 因为 `sensenova` 的端点叫 `token.sensenova.cn`，压根没有 plan 字样。
 *
 * ⚠️ **美元不折成倍率。** 倍率是"相对基准消耗"，而 USD 是绝对价；两者之间需要
 * 一个基准，本仓任何地方都没有这个基准，造一个出来等于替厂商发明换算率。
 * 所以这里只回答分类，不提供任何"跨条目按价格排序"的能力。价格数字本身照实
 * 显示（那是可核对的绝对值），但不参与任何打分或排序。
 *
 * ⚠️ **不知道就说不知道。** 没有证据的模型是 `unknown`，不是免费、也不是付费。
 */

import { AGGREGATE_PRICE, aggregatePriceOf, isZeroPrice } from './aggregatePricing.ts'
import { officialFreeEvidenceOf } from './aggregatePricing.ts'

/**
 * 一个模型的消耗分类。
 *
 * - `free`：不额外花钱 —— 官方点名免费、目录标了免费、或第三方标价为零的非订阅端点；
 * - `included`：额度已含在订阅里，所以边际价为 0，**但不是免费**（用完套餐就停）；
 * - `priced`：按量计价，有非零标价；
 * - `unknown`：没有任何证据。既不是免费也不是付费。
 */
export type AggregateCostClass = 'free' | 'included' | 'priced' | 'unknown'

/** 证据类型，界面据此决定要不要加"第三方"这种限定词。 */
export type AggregateCostEvidence = 'official' | 'catalogue' | 'third-party' | 'plan' | 'none'

export interface AggregateCostSignal {
  class: AggregateCostClass
  evidence: AggregateCostEvidence
  /** 官方免费清单的出处页；只有 `evidence === 'official'` 时有 */
  docUrl?: string
  /** 标价（USD / 1M tokens）；只有第三方给了价格时才有，**不是倍率** */
  price?: { input: number; output: number }
}

/**
 * 订阅制端点：额度已含在订阅里，models.dev 上的边际价为 0。
 *
 * 这份清单是手写的，每条都对应 registry `notes` 里写明"subscription / Token Plan /
 * coding-plan"的条目，**不放正则**：`sensenova` 的端点叫 `token.sensenova.cn`，
 * 按 "plan" 匹配会漏；反过来，`zai_api` 是同一家的**按量**端点，按 host 匹配会误判。
 */
export const AGGREGATE_PLAN_ENTRIES: Readonly<Record<string, string>> = {
  kimi_code: 'Kimi Code 订阅端点（registry notes：Kimi Code subscription）',
  zai: 'Z.ai coding-plan 端点，额度买断在套餐里（与同批模型 id 的按量端点 zai_api 是两回事）',
  'glm-cn': '智谱 coding 端点，订阅制（registry notes：Zhipu open-platform coding endpoint）',
  qwencloud: '千问 Token Plan 端点（registry notes：QwenCloud Token Plan endpoint）',
  qwencloud_coding: '千问 Coding Plan 端点（registry notes：QwenCloud Coding Plan endpoint）',
  bailian_token_plan: '阿里云百炼 Token Plan 端点，额度按订阅 Credits 扣减（sk-sp- 专属 Key）',
  'xiaomi-tokenplan': '小米 Token Plan 订阅（registry notes：keys start with tp-）',
  sensenova: '商汤日日新 Token Plan 公测积分池（registry notes 写明非 token 额度）',
  stepfun_step_plan: '阶跃星辰 Step Plan 订阅端点，按月 Credit 额度扣减',
  'volcengine-ark': '火山方舟 Coding Plan 订阅端点，额度和 Key 与平台按量端点隔离',
  volcengine_ark_agent_plan: '火山方舟 Agent Plan 订阅端点，额度按订阅套餐扣减',
}

export function isPlanEntry(entryId: string): boolean {
  return Object.prototype.hasOwnProperty.call(AGGREGATE_PLAN_ENTRIES, entryId)
}

export function planReasonOf(entryId: string): string | undefined {
  return AGGREGATE_PLAN_ENTRIES[entryId]
}

/**
 * 判定一个模型的消耗分类。按可信度依次尝试，第一个命中的证据即结论。
 *
 * `freeModelsHint` 由调用方传入（它属于 registry 的条目数据，不属于本模块），
 * 这样本模块只依赖旁表，不反向依赖 registry。
 */
export function aggregateCostOf(input: {
  entryId: string
  modelId: string
  /** registry 条目上的免费模型清单 */
  freeModelsHint?: readonly string[]
}): AggregateCostSignal {
  const { entryId, modelId, freeModelsHint } = input
  const price = aggregatePriceOf(entryId, modelId)
  const priceView = price === undefined ? undefined : { input: price.input, output: price.output }

  // 1. 官方点名免费 —— 最可信，也最能解释"为什么这条不要钱"
  const official = officialFreeEvidenceOf(entryId, modelId)
  if (official) {
    return {
      class: 'free',
      evidence: 'official',
      ...(official.docUrl ? { docUrl: official.docUrl } : {}),
      ...(priceView ? { price: priceView } : {}),
    }
  }

  // 2. 目录自带的免费清单。它是转录数据，没有单独出处，所以排在官方证据之后。
  if (freeModelsHint?.includes(modelId) === true) {
    return {
      class: 'free',
      evidence: 'catalogue',
      ...(priceView ? { price: priceView } : {}),
    }
  }

  // 3. 订阅端点：边际价为 0 是"含在套餐里"，不是免费。这里对整家生效，
  //    因为这家的计费口径就是订阅制，与某个模型有没有被 models.dev 收录无关。
  if (isPlanEntry(entryId)) {
    return {
      class: 'included',
      evidence: 'plan',
      ...(priceView ? { price: priceView } : {}),
    }
  }

  // 4. 第三方标价：非零 = 按量计价；零价 = 第三方认为不要钱（可信度最低，
  //    所以只标 `third-party`，界面措辞会带上"第三方"）。
  if (priceView) {
    return {
      class: isZeroPrice(price) ? 'free' : 'priced',
      evidence: 'third-party',
      price: priceView,
    }
  }

  return { class: 'unknown', evidence: 'none' }
}

/**
 * 一条请求的上报用量。只接受上游自己报的数，`chars/4` 估算不在接受范围内。
 */
export interface PricedUsage {
  promptTokens: number
  completionTokens: number
  /** 上游报的缓存命中输入 token，`promptTokens` 的**子集**。 */
  cacheReadTokens?: number
}

function positiveTokens(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * 由上游上报的用量算出这条请求的美元成本；回答不了就返回 `undefined`。
 *
 * 四条口径：
 *
 * - 先过 {@link aggregateCostOf} 的分类。`priced` 才乘价；`free` / `included`
 *   记 0 并**算作已定价**（请求时刻的现金支出确实是 0）；`unknown` 返回
 *   `undefined`，界面显示 "-"。把"没有证据"渲染成"$0"是这个功能唯一真正危险
 *   的错法 —— 用户会以为自己在免费跑一个按量计价的模型。
 * - `promptTokens` 含缓存命中（OpenAI 口径），所以命中部分按 `cacheRead` 单价、
 *   其余按 `input` 单价；上游没报命中时全部按 `input` 计，那是没有证据时的
 *   保守读法而不是猜测。
 * - `cacheWrite` 单价在这里用不上：`UsageReading` 没有写缓存这个字段，凭空补
 *   一个 0 等于假装看见了它。所以带显式缓存写入的渠道在这里是**低估**的。
 * - 估算用量不该传进来。这条守卫在 `tokenAccounting.accumulateDayBucket` 里
 *   又设了一次，两处都设是因为跨过去一次就是账单级的失真。
 */
export function aggregateCostUsdOf(input: {
  entryId: string
  modelId: string
  freeModelsHint?: readonly string[]
  usage: PricedUsage
}): number | undefined {
  const signal = aggregateCostOf({
    entryId: input.entryId,
    modelId: input.modelId,
    ...(input.freeModelsHint ? { freeModelsHint: input.freeModelsHint } : {}),
  })

  if (signal.class === 'unknown') return undefined
  if (signal.class !== 'priced') return 0

  const price = aggregatePriceOf(input.entryId, input.modelId)
  // `priced` 已经保证了有非零标价；这一层是给旁表被手改过的情况的：分类说有价、
  // 查价查不到时，宁可不写数字，也不要按 0 单价算出一笔"免费"。
  if (price === undefined) return undefined

  const prompt = positiveTokens(input.usage.promptTokens)
  const completion = positiveTokens(input.usage.completionTokens)
  const cacheRead = Math.min(positiveTokens(input.usage.cacheReadTokens), prompt)

  return (
    (prompt - cacheRead) * price.input +
    cacheRead * (price.cacheRead ?? price.input) +
    completion * price.output
  ) / 1_000_000
}

/** 五类计数，供界面汇总一行；`total` 由调用方给出以免这里再算一遍。 */
export function aggregateCostCounts(
  signals: readonly AggregateCostSignal[]
): Record<AggregateCostClass, number> {
  const counts: Record<AggregateCostClass, number> = { free: 0, included: 0, priced: 0, unknown: 0 }
  for (const signal of signals) counts[signal.class] += 1
  return counts
}

/**
 * 分类 → `auto` 路由用的成本档。
 *
 * 两条映射是有意为之：
 * - `included` 与 `free` 同档：两者在**请求时刻**的边际现金支出都是 0。
 *   订阅额度是否快用完由额度账本另管（`quotaBlockReason`），不在这里表达。
 * - `priced` 一律取 `above-base`：USD 没有倍率的基准，所以只能回答"要不要额外花钱"，
 *   不能回答"贵多少倍"。`cheap` 偏好要的正是避开付费，而不是给付费模型排序。
 */
export function costBucketOfAggregateClass(
  klass: AggregateCostClass
): 'free' | 'above-base' | 'unknown' {
  if (klass === 'free' || klass === 'included') return 'free'
  if (klass === 'priced') return 'above-base'
  return 'unknown'
}

/** 有标价的条目数（旁表原始行数），供测试与排查断言，不参与展示。 */
export function pricedEntryCount(): number {
  return Object.keys(AGGREGATE_PRICE).length
}
