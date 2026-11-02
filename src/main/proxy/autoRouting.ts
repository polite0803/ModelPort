/**
 * Auto 模型路由 - 纯决策逻辑
 *
 * 本文件不依赖 electron / electron-store，以便在 node:test 中直接验证；
 * 供应商、账号、模型的数据采集与冷却状态见 autoRouter.ts。
 */

import type { ChatCompletionRequest, ChatMessage } from './types'
import type {
  AutoModelTier,
  AutoPreference,
  AutoPoolStrategy,
  AutoPoolStrategyId,
  CapabilitySource,
  CapabilityState,
  ModelCapability,
  ModelCapabilityHint,
  ProviderType,
  RouteModelRef,
} from '../../shared/types'
import type { CostBucket } from '../../shared/channels.ts'
import type { AggregateCostClass } from '../../shared/aggregateCost.ts'
import { providerDefaultCapability, staticCapabilityHint } from './modelCapabilities.ts'
import { banditAdjustment, type BanditStats } from './autoBandit.ts'

export type AutoComplexity = 'simple' | 'standard' | 'complex'
/** 与 loadBalanceStrategy 保持一致，用于选择打分口径 */
export type AutoRoutingStrategy = 'round-robin' | 'fill-first' | 'failover' | 'smart' | 'pace'

/**
 * 请求里会改变响应形状、不能靠提示词补上的要求。
 * 与 `parameterPolicy` 同一口径：内置供应商丢弃 `response_format`、
 * 对 `n > 1` 直接 400，所以这两项要按供应商类型筛选目标。
 */
export interface ContractNeeds {
  multiChoice: boolean
  structuredOutput: boolean
}

export function contractNeeds(request: ChatCompletionRequest): ContractNeeds {
  const raw = request as unknown as Record<string, unknown>
  const format = raw.response_format as { type?: unknown } | undefined
  const type = typeof format?.type === 'string' ? format.type : ''
  return {
    multiChoice: typeof request.n === 'number' && request.n > 1,
    structuredOutput: type === 'json_object' || type === 'json_schema',
  }
}

export function needsContractFilter(needs: ContractNeeds): boolean {
  return needs.multiChoice || needs.structuredOutput
}

/**
 * 该供应商能否完整满足这些契约。只有内置供应商被确认做不到；
 * 聚合与自定义原样透传（`parameterPolicy.findUnsupportedParameter` 只拦内置）。
 */
export function providerMeetsContract(providerType: string | undefined, needs: ContractNeeds): boolean {
  if (providerType !== 'builtin') return true
  return !needs.multiChoice && !needs.structuredOutput
}

export interface ContractOutcome {
  /** 实际参与排序的候选 */
  pool: RankCandidate[]
  /** 为路由成功而放宽的契约，调用方必须写进响应头 */
  degraded: string[]
  /** 没有候选能满足、必须拒绝的契约 */
  missing: string[]
}

/**
 * 契约过滤：
 * - 有候选能完整满足 → 只在它们里面挑；
 * - 一个都没有 → `n > 1` 记为 missing（交给调用方按既有 400 拒绝），
 *   `response_format` 记为 degraded 并照常路由（自由文本比不可用更接近用户想要）。
 */
export function applyContractFilter(candidates: RankCandidate[], needs: ContractNeeds): ContractOutcome {
  if (!needsContractFilter(needs)) {
    return { pool: candidates, degraded: [], missing: [] }
  }

  const capable = candidates.filter(candidate => candidate.contractCapable === true)
  if (capable.length > 0) {
    return { pool: capable, degraded: [], missing: [] }
  }

  if (needs.multiChoice) {
    return { pool: [], degraded: [], missing: ['n'] }
  }

  return { pool: candidates, degraded: ['response_format'], missing: [] }
}

// ── 候选池策略筛选（静态、用户预设）────────────────────────────────────────
//
// 策略筛选落在候选池构建处（getEffectiveModels 之后、粘性处理之前），针对的是
// **模型**而非账号：同一模型的多个账号候选一起过滤。策略是静态的、按用户配置的，
// 请求硬过滤（vision/tools/context，按画像）与契约过滤（n/response_format）之后
// 才跑，三者不冲突也不互相替代。

/**
 * 策略谓词的入参。`RankCandidate` 本身没有供应商类型，而渠道类策略要按类型过滤，
 * 所以这里补一个 `providerType`。谓词是纯函数，直接可单测。
 */
export interface PoolStrategyCandidate extends RankCandidate {
  providerType: ProviderType
}

/** 长上下文策略阈值：上下文窗口 ≥ 128000 才算长上下文 */
const LONG_CONTEXT_STRATEGY_THRESHOLD = 128000
/** 标准上下文策略阈值：上下文窗口 ≥ 32000 才算标准上下文 */
const STANDARD_CONTEXT_STRATEGY_THRESHOLD = 32000
/** 推理模型的名字特征；与 tier=strong 联用，大小写不敏感 */
const REASONING_NAME_PATTERN = /reason|thinking/i

/**
 * 证据来源的强弱（数字越小越强）。只在两个字段**互相冲突**时用来裁决，
 * 例如 vision 来自手工标注、modalities 来自第三方目录。
 */
const SOURCE_PRIORITY: Record<CapabilitySource, number> = {
  manual: 0,
  'provider-record': 1,
  'aggregate-official': 2,
  static: 3,
  'provider-default': 4,
  'third-party': 5,
  heuristic: 6,
  unknown: 7,
}

/**
 * 17 个策略谓词。能力类读 `capabilityOfCandidate` 的合并结果
 * （手工标注 > 供应商记录 > 聚合官方 > 静态表 > 供应商兜底 > 第三方 > 名字启发式），
 * 未知就是 unknown，绝不零填充；成本类读 `costBucket`（打分口径的档位）与
 * `costClass`（未折叠的聚合消耗分类）；渠道类读 `providerType`。
 */
export const STRATEGY_PREDICATES: Record<AutoPoolStrategyId, (candidate: PoolStrategyCandidate) => boolean> = {
  // 能力类
  'vision-capable': c => capabilityOfStrategy(c).vision === 'yes',
  'tools-capable': c => capabilityOfStrategy(c).tools === 'yes',
  /**
   * 多模态：有声明过的输入模态时按模态判断（是否接受图片）；没有模态证据时
   * 退回视觉能力。仍把 vision 当代理 —— 缺声明不等于不支持图片。
   *
   * ⚠️ 模态与 vision 是**两个独立字段**，可能来自不同层：可接受图片的第三方
   * 模态声明 + 用户手工把 vision 改成 no，是最常见的修正场景。这里按证据来源
   * 的优先级取强者（见 `SOURCE_PRIORITY`），否则手工修正会被第三方的模态悄悄
   * 推翻 —— 那正是「手动标注优先级最高」要防的事。
   */
  'multimodal': c => {
    const cap = capabilityOfStrategy(c)
    if (cap.modalities === undefined) return cap.vision === 'yes'
    if (SOURCE_PRIORITY[cap.sources.vision] < SOURCE_PRIORITY[cap.sources.modalities]) {
      return cap.vision === 'yes'
    }
    return cap.modalities.includes('image')
  },
  /**
   * 推理模型：有 `reasoning` 证据时直接采信；没有证据时退回
   * 「tier=strong 且名字含 reason/thinking」的旧近似，所以已标注的推理模型
   * 不再需要靠名字才被选中，而名字像推理的模型行为不变。
   */
  'reasoning': c => {
    const cap = capabilityOfStrategy(c)
    if (cap.reasoning !== 'unknown') return cap.reasoning === 'yes'
    return cap.tier === 'strong' && REASONING_NAME_PATTERN.test(c.displayName)
  },
  /** 仅已标注能力：vision / tools / reasoning / modalities / contextTokens 任一有证据 */
  'annotated-only': c => {
    const cap = capabilityOfStrategy(c)
    return cap.vision !== 'unknown'
      || cap.tools !== 'unknown'
      || cap.reasoning !== 'unknown'
      || cap.modalities !== undefined
      || cap.contextTokens !== undefined
  },
  // 成本类
  'free-only': c => c.costBucket === 'free',
  'low-weight': c => {
    const weight = mergedHintOf(c)?.weight
    return weight !== undefined && weight <= 1
  },
  /** 订阅额度内：聚合条目的原始分类为 included（额度买断在套餐里，用完就停） */
  'included-plan': c => c.costClass === 'included',
  /** 已知成本：costBucket 既不是 undefined 也不是 unknown */
  'cost-known': c => c.costBucket !== undefined && c.costBucket !== 'unknown',
  // 上下文类
  'long-context': c => {
    const tokens = capabilityOfStrategy(c).contextTokens
    return tokens !== undefined && tokens >= LONG_CONTEXT_STRATEGY_THRESHOLD
  },
  'standard-context': c => {
    const tokens = capabilityOfStrategy(c).contextTokens
    return tokens !== undefined && tokens >= STANDARD_CONTEXT_STRATEGY_THRESHOLD
  },
  // 档位类
  'fast-tier': c => capabilityOfStrategy(c).tier === 'fast',
  'strong-tier': c => capabilityOfStrategy(c).tier === 'strong',
  'balanced-tier': c => capabilityOfStrategy(c).tier === 'balanced',
  // 渠道类
  'aggregate-only': c => c.providerType === 'aggregate',
  'channel-only': c => c.providerType === 'account',
  'builtin-only': c => c.providerType === 'builtin',
}

/** 策略谓词统一走 resolveCapability，保持与硬过滤同一能力口径 */
function capabilityOfStrategy(candidate: PoolStrategyCandidate): ModelCapability {
  return capabilityOfCandidate(candidate)
}

/**
 * 按策略序列从左到右组合过滤候选池。
 *
 * - 策略数组为空 → 原样返回（不过滤，向后兼容）；
 * - 第一个策略无条件生效，其 `operator` 忽略；
 * - 其后每个策略按自己的 `operator` 与「已保留集合」组合：
 *   `and` 取交集、`or` 取并集，结果始终按 `candidates` 原序重建（确定性）；
 * - 未知 id 的策略被跳过（fail-open，不静默丢候选）；
 * - 不改动传入的 `candidates` 数组与其中对象，始终返回新数组。
 */
export function applyPoolStrategies(
  candidates: readonly PoolStrategyCandidate[],
  strategies: readonly AutoPoolStrategy[]
): PoolStrategyCandidate[] {
  return applyPoolStrategiesWithTrace(candidates, strategies).kept
}

/** `applyPoolStrategiesWithTrace` 的结果；`droppedBy` 供路由预览解释「被哪条筛掉」 */
export interface PoolStrategyOutcome {
  kept: PoolStrategyCandidate[]
  /**
   * 被剔除的候选 → 它**第一个**不满足的策略 id。用对象身份做键（候选是本次
   * 请求新建的对象），所以只在该次调用内有效。
   */
  droppedBy: Map<PoolStrategyCandidate, AutoPoolStrategyId>
  /** 实际生效的策略序列（未知 id 已剔除） */
  effective: AutoPoolStrategyId[]
  /** 每个策略执行完后的保留数（第一项是只跑第一条策略的结果） */
  steps: { id: AutoPoolStrategyId; kept: number }[]
}

/**
 * 与 {@link applyPoolStrategies} 同一判定，额外返回每个被剔除候选的第一条失败
 * 策略，供路由预览显示「是哪一步筛掉的」。判定逻辑只存在于这一个函数里。
 */
export function applyPoolStrategiesWithTrace(
  candidates: readonly PoolStrategyCandidate[],
  strategies: readonly AutoPoolStrategy[]
): PoolStrategyOutcome {
  const pairs = strategies
    .map(strategy => ({ strategy, predicate: STRATEGY_PREDICATES[strategy.id] }))
    .filter((pair): pair is { strategy: AutoPoolStrategy; predicate: (c: PoolStrategyCandidate) => boolean } =>
      pair.predicate !== undefined)

  if (pairs.length === 0) {
    return { kept: candidates.slice(), droppedBy: new Map(), effective: [], steps: [] }
  }

  // 第一个策略无条件生效
  const kept = new Set<PoolStrategyCandidate>()
  for (const candidate of candidates) {
    if (pairs[0]!.predicate(candidate)) kept.add(candidate)
  }
  const steps: { id: AutoPoolStrategyId; kept: number }[] = [
    { id: pairs[0]!.strategy.id, kept: kept.size },
  ]

  for (let i = 1; i < pairs.length; i++) {
    const { strategy, predicate } = pairs[i]!
    const next = new Set<PoolStrategyCandidate>()
    for (const candidate of candidates) {
      const passes = predicate(candidate)
      if (strategy.operator === 'and') {
        if (kept.has(candidate) && passes) next.add(candidate)
      } else {
        if (kept.has(candidate) || passes) next.add(candidate)
      }
    }
    kept.clear()
    for (const candidate of next) kept.add(candidate)
    steps.push({ id: strategy.id, kept: kept.size })
  }

  const droppedBy = new Map<PoolStrategyCandidate, AutoPoolStrategyId>()
  for (const candidate of candidates) {
    if (kept.has(candidate)) continue
    const firstFailure = pairs.find(pair => !pair.predicate(candidate))
    if (firstFailure !== undefined) droppedBy.set(candidate, firstFailure.strategy.id)
  }

  return {
    kept: candidates.filter(candidate => kept.has(candidate)),
    droppedBy,
    effective: pairs.map(pair => pair.strategy.id),
    steps,
  }
}

/**
 * 手动把被策略筛掉的模型放回路由池，或把不该出现的模型移出去。
 *
 * - `excludeModels` 永远赢：手改坏的配置也不能把已手动移除的模型重新引入；
 * - `includeModels` 只能从 `allCandidates`（策略筛选**之前**、经过供应商/账号/
 *   额度前置剔除的候选）里取回模型，所以它不会凭空复活一个没在服务的模型，也
 *   不会绕过请求期硬过滤（图片→视觉、上下文长度）与契约过滤 —— 那些在排序阶段
 *   还会再判一次；
 * - 返回结果保持 `pool` 的原序，取回的模型按 `allCandidates` 的原序追加；
 * - 找不到的 include（模型已停用/供应商已关闭）通过 `unresolved` 报出去，让调用
 *   方能解释「为什么加了却没生效」，而不是静默忽略。
 */
/**
 * 名字钉定（`ModelRoute.pinModels`）：把候选**基底**收到被点名的那几个模型上。
 *
 * 空数组 = 不钉，基底就是传进来的全部候选 —— 与 `poolStrategies: []` 的「不过滤」同一语义，
 * 缺省行为逐字不变，所以这条规则对现存的所有路由都是 no-op。
 *
 * 匹配口径与手工增删完全一致（`(providerId, displayName)`、两侧 trim、大小写不敏感），
 * 因为「同一条引用在 include 里认、在 pin 里不认」会让人觉得配置被静默忽略。
 *
 * 顺序是固定的：pin 收基底 → 池策略在里面筛 → `excludeModels` 再剔、`includeModels`
 * **只能从钉定的基底里**取回（取不回池外的模型，否则 pin 会被绕开）。
 */
export function applyModelNamePin<T extends RankCandidate>(
  candidates: readonly T[],
  pinModels: readonly RouteModelRef[] = []
): T[] {
  if (pinModels.length === 0) return [...candidates]

  const keyOf = (providerId: string, displayName: string): string =>
    `${providerId.trim().toLowerCase()}\u0000${displayName.trim().toLowerCase()}`
  const wanted = new Set(pinModels.map(ref => keyOf(ref.providerId, ref.displayName)))

  return candidates.filter(candidate => wanted.has(keyOf(candidate.providerId, candidate.displayName)))
}

export function applyManualModelSelection<T extends RankCandidate>(
  pool: readonly T[],
  allCandidates: readonly T[],
  includeModels: readonly RouteModelRef[] = [],
  excludeModels: readonly RouteModelRef[] = []
): { kept: T[]; excluded: T[]; included: T[]; unresolved: RouteModelRef[] } {
  // 与归一化同一口径：去掉首尾空白、大小写不敏感，否则管理 API 手写的大小写
  // 差异会让 include 条目变成"未解析"，看起来像被静默忽略。
  const keyOf = (providerId: string, displayName: string): string =>
    `${providerId}\u0000${displayName.trim().toLowerCase()}`

  const excludedKeys = new Set(excludeModels.map(ref => keyOf(ref.providerId, ref.displayName)))
  const available = new Map<string, T[]>()
  for (const candidate of allCandidates) {
    const key = keyOf(candidate.providerId, candidate.displayName)
    const bucket = available.get(key)
    if (bucket === undefined) available.set(key, [candidate])
    else bucket.push(candidate)
  }

  const kept: T[] = []
  const excluded: T[] = []
  const alreadyInPool = new Set<string>()
  for (const candidate of pool) {
    const key = keyOf(candidate.providerId, candidate.displayName)
    if (excludedKeys.has(key)) {
      excluded.push(candidate)
      continue
    }
    alreadyInPool.add(key)
    kept.push(candidate)
  }

  const included: T[] = []
  const unresolved: RouteModelRef[] = []
  // 按 allCandidates 原序追加，避免 include 顺序反过来改变候选次序
  const includeWanted = new Set(
    includeModels
      .map(ref => keyOf(ref.providerId, ref.displayName))
      .filter(key => !excludedKeys.has(key))
  )
  const seenIncludes = new Set<string>()
  for (const candidate of allCandidates) {
    const key = keyOf(candidate.providerId, candidate.displayName)
    if (!includeWanted.has(key) || alreadyInPool.has(key)) continue
    if (excludedKeys.has(key)) continue
    seenIncludes.add(key)
    included.push(candidate)
  }
  for (const ref of includeModels) {
    const key = keyOf(ref.providerId, ref.displayName)
    if (excludedKeys.has(key)) continue
    if (seenIncludes.has(key) || alreadyInPool.has(key)) continue
    unresolved.push(ref)
  }

  return { kept: [...kept, ...included], excluded, included, unresolved }
}

/** 由请求体推导出的路由画像 */
export interface RequestProfile {
  needsVision: boolean
  needsTools: boolean
  estimatedTokens: number
  complexity: AutoComplexity
  stream: boolean
}

/** 排名的输入：一个 (账号, 模型) 组合 */
export interface RankCandidate {
  providerId: string
  providerName: string
  displayName: string
  actualModelId: string
  accountId: string
  todayUsed?: number
  dailyLimit?: number
  lastUsed?: number
  /** 当前在途请求数 */
  inFlight?: number
  /** 当前 (账号, 模型) 的在途数；比账号级更精确，缺省回退到 `inFlight`。 */
  modelInFlight?: number
  /** 该 (账号, 模型) 的 AIMD 并发上限 */
  modelLimit?: number
  /** 最近短窗口的首字延迟 EWMA（毫秒） */
  ewmaFirstTokenMs?: number
  /** 最近短窗口的 429 / 超时 / degraded 比例（0–1） */
  rateLimitedRate?: number
  timeoutRate?: number
  degradedRate?: number
  /** 最近 60 秒内的尝试次数 */
  rpmUsed?: number
  /** 账号自身声明的每分钟请求上限，未声明则按候选集合内的相对负载计算 */
  rpmLimit?: number
  /** 冷却截止时间戳，<= now 表示可用 */
  coolingUntil?: number
  /**
   * 供应商记录里这个模型自己的标注（账号渠道写入，或内置同步写入）。
   * 优先级高于静态表；缺省即未知。
   */
  capabilityHint?: ModelCapabilityHint
  /**
   * 用户在模型管理里手工改的标注。优先级最高，但只覆盖它写了的字段 ——
   * 手工只改 `vision` 时，其它字段仍然走自动标注，不会把整条记录清空。
   */
  manualHint?: ModelCapabilityHint
  /**
   * 聚合官方旁表（`aggregateQuota`）推出的标注，目前只有 contextTokens。
   * 与供应商记录分开，是为了让预览能说清「这个窗口来自官方文档」而不是同步来的值。
   */
  officialHint?: ModelCapabilityHint
  /**
   * 第三方（models.dev）能力旁表。排在官方/静态之后，只填前面都没有的证据；
   * 永远不覆盖已有标注。
   */
  thirdPartyHint?: ModelCapabilityHint
  /** 该供应商能否满足本次请求的契约（`n > 1` / `response_format`），由采集层填入 */
  contractCapable?: boolean
  /** 成本档；缺省按 unknown 参与打分（中性） */
  costBucket?: CostBucket
  /**
   * 聚合条目的原始消耗分类（`AggregateCostClass`）。只对聚合供应商的候选填写：
   * `costBucket` 把套餐内折成免费（请求时刻现金支出都是 0），但策略筛选要能
   * 把「订阅额度内」与「完全免费」分开，所以这里保留未折叠的分类。非聚合候选不携带。
   */
  costClass?: AggregateCostClass
  /**
   * 配额账本余量（PLAN P1-3）：`aggregateHeadroom` 的返回值（1=全空，0=刚好
   * 打满，-1=已超，无帽=0.5 中性）。仅聚合目录的候选携带；剩余 <10% 时降权，
   * 耗尽的候选早在 select 里就被 quotaBlockReason 剔除，到不了打分。
   */
  quotaHeadroom?: number
  /**
   * Bandit 实时战绩（PLAN P2-5 第一步）：该 (provider, model) 滚动 24h 的
   * 成功率与延迟 p50。无数据的候选不携带 —— 冷启动乐观先验，不做调整。
   */
  live?: BanditStats
}

export interface RankOptions {
  now?: number
  /** 最多返回多少个候选（失败切换次数上限），默认 3 */
  limit?: number
  /** 分散度种子，每次请求递增以打散同分候选 */
  seed?: number
  /** 打分口径，默认与服务端的 loadBalanceStrategy 一致 */
  strategy?: AutoRoutingStrategy
  /** 优化目标，默认 balanced */
  prefer?: AutoPreference
  /** 同一会话上次成功的候选，作为加分项而不是硬钉 */
  sticky?: StickyHint
}

export interface StickyHint {
  providerId: string
  displayName: string
  accountId: string
}

const TIER_RANK: Record<AutoModelTier, number> = {
  fast: 0,
  balanced: 1,
  strong: 2,
}

const TIER_TARGET: Record<AutoComplexity, number> = {
  simple: 0,
  standard: 1,
  complex: 2,
}

export type { AutoModelTier, CapabilityState, ModelCapabilityHint } from '../../shared/types'

/**
 * 上下文窗口未知的模型按这个值做硬过滤（D2：维持既有 64000）。
 * 它只是一个保守上界，不是对真实窗口的声明，也不写进任何响应。
 */
export const UNANNOTATED_CONTEXT_FLOOR = 64000

/** 在线同步来的未知模型按名字猜档位，猜错只影响档位匹配，不影响可用性 */
const FAST_NAME_PATTERN = /(flash|turbo|mini|lite|fast|air|small|\d+b|a\d+b)/
const STRONG_NAME_PATTERN = /(max|pro|expert|ultra|opus|thinking|reason)/

const VISION_PART_TYPES = new Set(['image_url', 'input_image', 'image', 'file'])
const IMAGE_TOKEN_ESTIMATE = 1024
const LONG_CONTEXT_TOKEN_THRESHOLD = 24000
const IDLE_WINDOW_MS = 5 * 60 * 1000

/**
 * 成本档 → 打分因子。口径同 `costBucketOf`：未知单独成档，取中性 0.5，
 * 既不奖励也不惩罚（没有倍率不等于免费）。
 */
const COST_SCORE: Record<CostBucket, number> = {
  free: 1,
  'below-base': 0.75,
  base: 0.5,
  unknown: 0.5,
  'above-base': 0.25,
}

function isVisionPart(part: unknown): boolean {
  if (!part || typeof part !== 'object') return false
  const type = (part as { type?: string }).type
  return typeof type === 'string' && VISION_PART_TYPES.has(type)
}

function messageText(message: ChatMessage): string {
  const content = message.content
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return content
      .filter(part => (part as { type?: string }).type === 'text')
      .map(part => (part as { text?: string }).text || '')
      .join(' ')
  }
  return ''
}

function estimateTokens(text: string): number {
  if (!text) return 0
  const cjkMatches = text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g)
  const cjkCount = cjkMatches ? cjkMatches.length : 0
  const otherCount = text.length - cjkCount
  return Math.ceil(cjkCount + otherCount / 4)
}

/**
 * 序列化后估算 token 数。请求体来自 JSON 解析，正常不会循环引用，但仍然吞掉
 * 异常 —— 一次估算失败不能把整个路由决策打挂。
 */
function estimateJsonTokens(value: unknown): number {
  if (value === undefined || value === null) return 0
  try {
    return estimateTokens(JSON.stringify(value))
  } catch {
    return 0
  }
}

/**
 * 工具调用历史与工具声明的 token 量。
 *
 * agent 客户端（Trae / WorkBuddy 这类 IDE）与普通聊天的最大差别就在这里：
 * - 每轮都重发完整的 `tools` schema（几十个工具、每个带 parameters JSON）；
 * - 历史里的 `assistant.tool_calls[].function.arguments` 常是整段文件内容，
 *   而这些**不在 `content` 里**，`messageText()` 看不到。
 *
 * 只按 content 估算会把这些大头全部漏掉，于是 `auto` 把 200k+ 的上下文
 * 当成几万 token，路由到窗口不够的模型 —— 上游截断/400，客户端表现为空回复、
 * 流中断或工具调用失败。普通聊天客户端不重发工具历史，所以同一个路由下它们
 * 稳定、agent 客户端不稳定。
 */
function toolPayloadTokens(request: ChatCompletionRequest, messages: ChatMessage[]): number {
  let tokens = estimateJsonTokens(request.tools)
  for (const message of messages) {
    const calls = (message as { tool_calls?: unknown }).tool_calls
    if (calls === undefined) continue
    tokens += estimateJsonTokens(calls)
  }
  return tokens
}

/**
 * 从请求推导路由画像。全部是本地规则：不额外发起模型调用，也不会递归回落到 auto。
 */
export function profileRequest(request: ChatCompletionRequest): RequestProfile {
  const messages = Array.isArray(request.messages) ? request.messages : []

  let needsVision = false
  let imageCount = 0
  let textTokens = 0
  let systemTokens = 0

  for (const message of messages) {
    const tokens = estimateTokens(messageText(message))
    textTokens += tokens
    // Agent 客户端的系统提示通常有几千 token（工具规范、仓库约定、记忆）。
    // 它不在最后一条 user 消息里，只按 user 长度打分会把这类请求误判成 simple。
    if (message.role === 'system') systemTokens += tokens
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (isVisionPart(part)) {
          needsVision = true
          imageCount += 1
        }
      }
    }
  }

  const estimatedTokens = textTokens + imageCount * IMAGE_TOKEN_ESTIMATE + toolPayloadTokens(request, messages)
  const needsTools = Boolean(request.tools && request.tools.length > 0)

  const lastUserMessage = [...messages].reverse().find(message => message.role === 'user')
  const lastUserText = lastUserMessage ? messageText(lastUserMessage) : ''
  const lastUserLength = lastUserText.length

  let score = 0
  if (lastUserLength > 1200) {
    score += 2
  } else if (lastUserLength > 300) {
    score += 1
  }
  if (messages.length > 8) {
    score += 1
  }
  if (needsTools) {
    score += 1
  }
  if (systemTokens > 3000) {
    score += 1
  }
  // 两种写法都认：OpenAI 的 snake_case 与 AI SDK 的 camelCase。
  const reasoningEffort = request.reasoning_effort ?? request.reasoningEffort
  if (reasoningEffort === 'high') {
    score += 2
  } else if (reasoningEffort) {
    score += 1
  }
  if (request.web_search) {
    score += 1
  }
  if (request.deep_research) {
    score += 2
  }
  if (/```|\$\$|\\\(|\\\[/.test(lastUserText)) {
    score += 1
  }
  if (estimatedTokens > LONG_CONTEXT_TOKEN_THRESHOLD) {
    score += 1
  }

  const complexity: AutoComplexity = score >= 5 ? 'complex' : score >= 2 ? 'standard' : 'simple'

  return {
    needsVision,
    needsTools,
    estimatedTokens,
    complexity,
    stream: Boolean(request.stream),
  }
}

/**
 * 会话指纹：system 提示 + 首条 user 消息的哈希。
 *
 * 用途是让同一段对话在多轮里命中同一个模型（会话粘性），所以键必须
 * 在多轮之间保持稳定，又不能把不同对话混在一起。没有 user 消息
 * （或首条 user 为空）时返回 undefined，调用方据此跳过粘性。
 */
export function conversationKey(request: ChatCompletionRequest): string | undefined {
  const messages = Array.isArray(request.messages) ? request.messages : []

  const systemText = messages
    .filter(message => message.role === 'system')
    .map(messageText)
    .join('\n')
    .trim()

  const firstUser = messages.find(message => message.role === 'user')
  if (!firstUser) return undefined

  const userText = messageText(firstUser).trim()
  if (!userText) return undefined

  return `${hashString(systemText)}-${hashString(userText)}`
}

/**
 * 一个模型的标注层。字段名直接对应 {@link CapabilitySource}，顺序就是优先级：
 * `manual > record > aggregate-official > static > provider-default > third-party`，
 * 名字启发式排在最后（只对 `tier` 生效），再没有就是 `unknown`。
 *
 * 分层的意义不只是取最权威的值：`ModelCapability.sources` 会把每个字段的来源
 * 带出去，路由预览据此区分「官方文档写的」和「按名字猜的」。
 */
export interface CapabilityLayers {
  manual?: ModelCapabilityHint
  record?: ModelCapabilityHint
  aggregateOfficial?: ModelCapabilityHint
  thirdParty?: ModelCapabilityHint
}

/**
 * 查询模型能力（分层版）。
 *
 * 未知是一等状态：vision 未知就不能接图片，tools 未知可以接但要扣分，
 * 上下文未知按 `UNANNOTATED_CONTEXT_FLOOR` 过滤。任何一层都不写默认值。
 */
export function resolveCapabilityDetail(
  providerId: string,
  displayName: string,
  layers: CapabilityLayers = {}
): ModelCapability {
  const key = displayName.trim().toLowerCase()
  const staticHint = staticCapabilityHint(providerId, displayName)
  const providerDefaults = providerDefaultCapability(providerId)

  const ordered: { source: CapabilitySource; hint: ModelCapabilityHint }[] = []
  if (layers.manual !== undefined) ordered.push({ source: 'manual', hint: layers.manual })
  if (layers.record !== undefined) ordered.push({ source: 'provider-record', hint: layers.record })
  if (layers.aggregateOfficial !== undefined) {
    ordered.push({ source: 'aggregate-official', hint: layers.aggregateOfficial })
  }
  if (staticHint !== undefined) ordered.push({ source: 'static', hint: staticHint })
  if (providerDefaults !== undefined) ordered.push({ source: 'provider-default', hint: providerDefaults })
  if (layers.thirdParty !== undefined) ordered.push({ source: 'third-party', hint: layers.thirdParty })

  const pick = <K extends keyof ModelCapabilityHint>(
    field: K
  ): { value: ModelCapabilityHint[K] | undefined; source: CapabilitySource } => {
    for (const layer of ordered) {
      const value = layer.hint[field]
      if (value !== undefined) return { value, source: layer.source }
    }
    return { value: undefined, source: 'unknown' }
  }

  const tierPick = pick('tier')
  const tier = tierPick.value
    ?? (FAST_NAME_PATTERN.test(key) ? 'fast'
      : STRONG_NAME_PATTERN.test(key) ? 'strong'
        : 'balanced')
  const tierSource: CapabilitySource = tierPick.value === undefined ? 'heuristic' : tierPick.source

  const vision = pick('vision')
  const tools = pick('tools')
  const reasoning = pick('reasoning')
  const modalities = pick('modalities')
  const context = pick('contextTokens')

  return {
    tier,
    tierEvidenced: tierSource !== 'heuristic',
    vision: vision.value ?? 'unknown',
    tools: tools.value ?? 'unknown',
    reasoning: reasoning.value ?? 'unknown',
    ...(modalities.value === undefined ? {} : { modalities: modalities.value }),
    ...(context.value === undefined ? {} : { contextTokens: context.value }),
    sources: {
      tier: tierSource,
      vision: vision.source,
      tools: tools.source,
      reasoning: reasoning.source,
      modalities: modalities.source,
      contextTokens: context.source,
    },
  }
}

/**
 * 兼容入口：第三参数是「供应商记录」这一层。新代码需要手工/第三方/官方层时
 * 直接调 {@link resolveCapabilityDetail}。
 */
export function resolveCapability(
  providerId: string,
  displayName: string,
  hint?: ModelCapabilityHint
): ModelCapability {
  return resolveCapabilityDetail(providerId, displayName, hint === undefined ? {} : { record: hint })
}

/** 把一个候选的标注层拆出来，所有判定都经过同一个函数，口径不会分叉 */
export function capabilityLayersOf(
  candidate: Pick<RankCandidate, 'manualHint' | 'capabilityHint' | 'officialHint' | 'thirdPartyHint'>
): CapabilityLayers {
  return {
    ...(candidate.manualHint === undefined ? {} : { manual: candidate.manualHint }),
    ...(candidate.capabilityHint === undefined ? {} : { record: candidate.capabilityHint }),
    ...(candidate.officialHint === undefined ? {} : { aggregateOfficial: candidate.officialHint }),
    ...(candidate.thirdPartyHint === undefined ? {} : { thirdParty: candidate.thirdPartyHint }),
  }
}

/** 候选的合并能力描述：硬过滤、策略筛选、档位打分共用 */
export function capabilityOfCandidate(
  candidate: Pick<RankCandidate, 'providerId' | 'displayName' | 'manualHint' | 'capabilityHint' | 'officialHint' | 'thirdPartyHint'>
): ModelCapability {
  return resolveCapabilityDetail(candidate.providerId, candidate.displayName, capabilityLayersOf(candidate))
}

/**
 * 合并后的原始标注，只用于没进 `ModelCapability` 的字段（`weight` / `free`）。
 * 顺序同能力解析：手工 > 供应商记录 > 第三方。
 */
export function mergedHintOf(
  candidate: Pick<RankCandidate, 'manualHint' | 'capabilityHint' | 'thirdPartyHint'>
): ModelCapabilityHint | undefined {
  const layers = [candidate.thirdPartyHint, candidate.capabilityHint, candidate.manualHint]
    .filter((hint): hint is ModelCapabilityHint => hint !== undefined)
  if (layers.length === 0) return undefined
  return Object.assign({}, ...layers)
}

function effectiveContextLimit(capability: ModelCapability): number {
  return capability.contextTokens ?? UNANNOTATED_CONTEXT_FLOOR
}

/**
 * `auto` 在 `/v1/models` 上能承诺的窗口：候选里**最小**的那个。
 *
 * 客户端拿这个数决定发多少字节，所以它只能是下界：`auto` 会落到任意候选上，
 * 广告一个比某个候选更大的窗口，等于让它把请求发给那个装不下的候选。
 * 未标注的候选按 {@link UNANNOTATED_CONTEXT_FLOOR} 参与 —— 那正是
 * {@link effectiveContextLimit} 在放行判据里给它们的数，广告口径与放行口径同源。
 * 空池返回 `undefined`：没有候选就没有可说的，键必须省略而不是写个默认值。
 */
export function advertisedContextFloorOf(
  windows: readonly (number | undefined)[]
): number | undefined {
  if (windows.length === 0) return undefined
  return Math.min(...windows.map(window =>
    typeof window === 'number' && window > 0 ? window : UNANNOTATED_CONTEXT_FLOOR
  ))
}

/** 硬过滤的失败原因；`undefined` 表示通过 */
export type HardFilterFailure = 'vision' | 'tools' | 'context'

/**
 * 请求画像对模型能力的硬过滤。`enforceContext=false` 只放宽上下文 —— 那是
 * 最容易被估算误差误伤的一项；视觉/工具永远不放宽（图片被静默丢掉就是错答案）。
 *
 * 路由预览与 `rankCandidates` 共用本函数，预览说「会被筛掉」与实际行为同源。
 */
export function hardFilterFailure(
  profile: RequestProfile,
  capability: ModelCapability,
  enforceContext = true
): HardFilterFailure | undefined {
  if (profile.needsVision && capability.vision !== 'yes') return 'vision'
  if (profile.needsTools && capability.tools === 'no') return 'tools'
  if (enforceContext && profile.estimatedTokens > effectiveContextLimit(capability)) return 'context'
  return undefined
}

function satisfiesCapability(
  profile: RequestProfile,
  capability: ModelCapability,
  enforceContext: boolean
): boolean {
  return hardFilterFailure(profile, capability, enforceContext) === undefined
}

/**
 * 候选池为空的原因。前三个是请求画像缺能力；后两个是**配置**造成的空池
 * （池策略筛光、手动排除光），必须分开报 —— 把它们归成「没有可用模型」会让
 * 用户去查供应商，而真正要改的是路由配置。
 */
export type MissingRequirement =
  | 'vision'
  | 'tools'
  | 'context'
  | 'pool_strategy'
  | 'manual_filter'

/**
 * 排序结果为空时，说明到底缺哪种能力——直接说"没有可用模型"对排障没有帮助。
 * 只报描述性原因，不改变判定。
 */
export function explainMissing(
  profile: RequestProfile,
  candidates: RankCandidate[]
): MissingRequirement[] {
  const capabilityOf = (candidate: RankCandidate): ModelCapability =>
    capabilityOfCandidate(candidate)

  const missing: MissingRequirement[] = []
  if (profile.needsVision && !candidates.some(c => capabilityOf(c).vision === 'yes')) {
    missing.push('vision')
  }
  if (profile.needsTools && candidates.length > 0 && candidates.every(c => capabilityOf(c).tools === 'no')) {
    missing.push('tools')
  }
  if (candidates.length > 0
    && candidates.every(c => profile.estimatedTokens > effectiveContextLimit(capabilityOf(c)))) {
    missing.push('context')
  }
  return missing
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function scoreCandidate(
  profile: RequestProfile,
  candidate: RankCandidate,
  capability: ModelCapability,
  now: number,
  seed: number,
  strategy: AutoRoutingStrategy,
  maxRpmInPool: number,
  prefer: AutoPreference,
  sticky?: StickyHint
): number {
  // 优化目标改的是"想要多强的模型"，以及成本在打分里占多大份量
  const requestedRank = prefer === 'fast'
    ? TIER_RANK.fast
    : prefer === 'strong'
      ? TIER_RANK.strong
      : TIER_TARGET[profile.complexity]
  // 工具型请求（Qoder / IDE agent）的核心风险是「模型思考跑飞、工具调用自相
  // 矛盾」，稳定性比省成本重要。短 user 提示 + 大工具定义很容易被判成
  // simple/standard，这里至少上浮一档，避免直接落到免费快模型上。
  // `X-Auto-Prefer: fast` 是客户端的显式意图，仍然尊重。
  const targetRank = profile.needsTools && prefer !== 'fast'
    ? Math.min(TIER_RANK.strong, requestedRank + 1)
    : requestedRank
  const tierFit = 1 - Math.abs(TIER_RANK[capability.tier] - targetRank) / 2

  const quota = candidate.dailyLimit && candidate.dailyLimit > 0
    ? clamp01((candidate.dailyLimit - (candidate.todayUsed ?? 0)) / candidate.dailyLimit)
    : 0.6

  // fill-first 追求“先把已用账号填满”，因此看使用率而不是剩余量
  const usageRatio = candidate.dailyLimit && candidate.dailyLimit > 0
    ? clamp01((candidate.todayUsed ?? 0) / candidate.dailyLimit)
    : 0

  const rpmUsed = candidate.rpmUsed ?? 0
  const rpmLoad = candidate.rpmLimit && candidate.rpmLimit > 0
    ? clamp01(rpmUsed / candidate.rpmLimit)
    : maxRpmInPool > 0
      ? clamp01(rpmUsed / maxRpmInPool)
      : 0
  const headroom = 1 - rpmLoad

  // 在途越多越不优先；优先看 (账号, 模型) 的精确在途数，缺省回退账号级
  const inFlight = candidate.modelInFlight ?? candidate.inFlight ?? 0
  const concurrency = 1 / (1 + inFlight)

  // 短窗口运行态：首字变慢、429/超时、degraded、并发已满都要降权。
  // 这是“限流延时随模型访问量变化”的实时信号，不等 24h Bandit 也不等 429。
  const saturationPenalty =
    candidate.modelLimit !== undefined
    && candidate.modelLimit > 0
    && inFlight >= candidate.modelLimit
      ? 0.15
      : 0
  const latencyPenalty = candidate.ewmaFirstTokenMs === undefined
    ? 0
    : Math.min(0.2, (candidate.ewmaFirstTokenMs / 60_000) * 0.2)
  const healthPenalty = Math.min(
    0.3,
    0.2 * (candidate.rateLimitedRate ?? 0)
    + 0.2 * (candidate.timeoutRate ?? 0)
    + 0.1 * (candidate.degradedRate ?? 0),
  )
  const operationalPenalty = saturationPenalty + latencyPenalty + healthPenalty

  const idleness = candidate.lastUsed ? clamp01((now - candidate.lastUsed) / IDLE_WINDOW_MS) : 1

  // 同分时轮转，避免所有请求都压在同一个账号上；其余策略保持稳定排序
  const dispersion = strategy === 'round-robin'
    ? ((hashString(candidate.accountId) + seed) % 7) / 7000
    : 0

  // 未知能力不是错误，但需要让位于已确认能用的候选：tools 未知扣 0.05，
  // 工具型请求扣 0.15（猜错一次就是整轮 agent 的 tool call 序列崩掉），
  // 上下文未知且请求已接近上界的再扣 0.05。
  const uncertainTools = profile.needsTools && capability.tools === 'unknown' ? 0.15 : 0
  const uncertainContext = capability.contextTokens === undefined
    && profile.estimatedTokens > UNANNOTATED_CONTEXT_FLOOR / 2
    ? 0.05
    : 0
  const penalty = uncertainTools + uncertainContext

  // 成本以"相对中性 0.5"的加减分进入总分：未知成本正好为 0，
  // 免费模型在 balanced 下得到 +0.1，在 cheap 下得到 +0.3。
  // 工具型请求为稳定性封顶 0.15：成本再低，也不能让免费快模型压过能稳定
  // 跑完长工具链的强模型。
  const requestedCostWeight = prefer === 'cheap' ? 0.6 : prefer === 'strong' ? 0.1 : 0.2
  const costWeight = profile.needsTools ? Math.min(requestedCostWeight, 0.15) : requestedCostWeight
  const costBonus = costWeight * (COST_SCORE[candidate.costBucket ?? 'unknown'] - 0.5)

  // 配额余量降权（PLAN P1-3）：账本显示剩余 <10% 的候选靠后排。线性递增的
  // 小扣分 —— 0 剩余扣 0.1，9% 剩余扣 0.01。无帽（0.5）与余量充足的不调整。
  const quotaPenalty = candidate.quotaHeadroom !== undefined && candidate.quotaHeadroom < 0.1
    ? 0.1 * (1 - candidate.quotaHeadroom / 0.1)
    : 0

  // Bandit 实时加减分（PLAN P2-5 第一步）：24h 战绩说话，冷启动不调整。
  const liveBonus = banditAdjustment(candidate.live)

  // 会话粘性是加分而非硬钉：首选不可用时它会自然让位给其它候选
  const stickyBonus = sticky === undefined
    ? 0
    : sticky.providerId !== candidate.providerId || sticky.displayName !== candidate.displayName
      ? 0
      : sticky.accountId === candidate.accountId ? 0.12 : 0.06

  if (strategy === 'fill-first') {
    return 0.35 * usageRatio + 0.4 * tierFit + 0.15 * headroom + 0.1 * concurrency
      - penalty - quotaPenalty - operationalPenalty + costBonus + stickyBonus + liveBonus
  }

  if (strategy === 'failover') {
    return 0.45 * quota + 0.35 * tierFit + 0.1 * headroom + 0.1 * concurrency
      - penalty - quotaPenalty - operationalPenalty + costBonus + stickyBonus + liveBonus
  }

  // smart / pace 在这个分数里表达的是同一件事：**余量比已经用掉的重要**。
  // 两者真正的差别（谁先重置、每小时还剩多少）需要重置时刻，而打分函数拿不到它，
  // 所以这里不假装区分：选号阶段由 loadbalancer 的重置推算做最后一步，
  // auto 只负责把"余量多、配额健康"的候选排到前面。
  if (strategy === 'smart' || strategy === 'pace') {
    return 0.4 * headroom + 0.3 * quota + 0.2 * tierFit + 0.1 * concurrency
      - penalty - quotaPenalty - operationalPenalty + costBonus + stickyBonus + liveBonus
  }

  return 0.3 * quota + 0.3 * tierFit + 0.15 * headroom + 0.15 * concurrency + 0.1 * idleness
    + dispersion - penalty - quotaPenalty - operationalPenalty + costBonus + stickyBonus + liveBonus
}

/**
 * 排序候选项，返回最多 `limit` 个、按分数从高到低的候选。
 *
 * 规则：
 * 1. 冷却中的账号直接排除；
 * 2. 先按视觉/工具/上下文做硬过滤；
 * 3. 硬过滤后为空时只放宽上下文长度（最容易被估算误差误伤）；
 * 4. 视觉/工具仍然不满足则返回空数组，由调用方报 503，绝不把图片发给不支持的模型；
 * 5. 每个账号只保留一个候选，避免 429 后在同一账号上换模型重试。
 *
 * 打分（Phase 2）：
 * - 配额、RPM 余量、在途并发共同构成“限流健康度”；
 * - 档位匹配决定能力取向；
 * - `round-robin` 打散、`fill-first` 优先填满已用账号、`failover` 只看配额与健康度。
 */
export function rankCandidates(
  profile: RequestProfile,
  candidates: RankCandidate[],
  options: RankOptions = {}
): RankCandidate[] {
  const now = options.now ?? Date.now()
  const limit = options.limit ?? 3
  const seed = options.seed ?? 0
  const strategy = options.strategy ?? 'round-robin'
  const prefer = options.prefer ?? 'balanced'
  const sticky = options.sticky

  const usable = candidates.filter(candidate =>
    candidate.coolingUntil === undefined || candidate.coolingUntil <= now
  )

  const capabilityOf = (candidate: RankCandidate): ModelCapability =>
    capabilityOfCandidate(candidate)

  let pool = usable.filter(candidate =>
    satisfiesCapability(profile, capabilityOf(candidate), true)
  )

  if (pool.length === 0) {
    pool = usable.filter(candidate =>
      satisfiesCapability(profile, capabilityOf(candidate), false)
    )
  }

  if (pool.length === 0) {
    return []
  }

  const maxRpmInPool = pool.reduce((max, candidate) => Math.max(max, candidate.rpmUsed ?? 0), 0)

  const scored = pool.map(candidate => ({
    candidate,
    score: scoreCandidate(
      profile,
      candidate,
      capabilityOf(candidate),
      now,
      seed,
      strategy,
      maxRpmInPool,
      prefer,
      sticky
    ),
  }))

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const keyA = `${a.candidate.providerId}:${a.candidate.displayName}:${a.candidate.accountId}`
    const keyB = `${b.candidate.providerId}:${b.candidate.displayName}:${b.candidate.accountId}`
    return keyA.localeCompare(keyB)
  })

  const ranked: RankCandidate[] = []
  const usedAccounts = new Set<string>()
  for (const item of scored) {
    if (usedAccounts.has(item.candidate.accountId)) continue
    usedAccounts.add(item.candidate.accountId)
    ranked.push(item.candidate)
    if (ranked.length >= limit) break
  }

  return ranked
}
