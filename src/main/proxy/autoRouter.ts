/**
 * 路由执行器（多路由时代的 `auto` 路由器）
 *
 * 把**一条路由**解析成一串真实候选 (账号, 供应商, 模型)：路由表在
 * `AppConfig.routes`，名字就是客户端请求里 `model` 填的那个数（legacy 的单
 * `auto` 虚拟模型已降级成表里一条名为 `auto` 的普通路由）。
 * 决策逻辑在 autoRouting.ts 中（纯函数、不认识路由概念），本文件只负责数据
 * 采集、路由配置的读取与冷却/粘性状态。
 *
 * 一次 `select` 的全部可调参数都来自传入的那条 `route`；调用方不传时才回退
 * legacy `config.autoRouting`（保证迁移期在途调用与既有单测不炸）。粘性表按
 * 路由名分键，所以两条路由不会互相抢占同一个会话。
 */

import { storeManager } from '../store/store'
import type { CacheAffinityMap } from '../store/cacheAffinity'
import { accountChannelManager } from '../providers/accountChannels/manager'
import { resolvePoolRoute } from '../store/modelRoutes'
import type { Account, Provider, UserModelMarks } from '../store/types'
import type {
  AutoPoolStrategy,
  AutoPoolStrategyId,
  AutoPreference,
  ModelCapability,
  ModelCapabilityHint,
  ModelHardRequirement,
  ModelPinScope,
  ModelPinSource,
  ModelRoute,
  ModelScope,
  RouteMenuCurrent,
  RouteMenuEntry,
  RouteMenuModel,
  RouteMenuResult,
  RouteModelRef,
  RoutePreviewModel,
  RoutePreviewResult,
  RoutePreviewSample,
  RoutePreviewStatus,
  RouteSwitchRequest,
  RouteSwitchResult,
} from '../../shared/types'
import { DEFAULT_FAIRNESS_LEAD } from '../../shared/types'
import type { ChatCompletionRequest } from './types'
import type { CatalogAdoption } from '../../shared/modelCatalog.ts'
import { adoptionsForModel, catalogAdoptionHint } from '../../shared/modelCatalog.ts'
import type { ModelProbeRow } from '../../shared/modelProbe.ts'
import { indexProbeRows, probeRowKey, probeRowToLayer } from '../../shared/modelProbe.ts'
import { getProbeRowsSync } from '../providers/modelProbeStore.ts'
import { accountRuntime } from './accountRuntime'
import { capClientRetryAfterSeconds, permanentRefusalCooldownMs, quotaWindowResetMs } from './failover.ts'
import { clearCatalogMissCooldowns, isCatalogMissCoolingDown } from './modelCatalogCooldown'
import { applyRequestTierFloor, requestWriteToolFloor } from './writeToolFloor.ts'
import { getChannelDefinition } from '../providers/accountChannels/catalogue'
import { getAggregateEntry } from '../providers/aggregate/registry.ts'
import { promptCacheOf, effectiveAffinityMinutes, type PromptCacheCapability } from '../../shared/promptCache.ts'
import {
  advertisedContextFloorOf,
  advertisedContextTokens,
  UNANNOTATED_CONTEXT_FALLBACK,
  applyContractFilter,
  applyManualModelSelection,
  applyMinTier,
  applyModelNamePin,
  applyPoolStrategiesWithTrace,
  capabilityOfCandidate,
  contractNeeds,
  explainMissing,
  conversationKey,
  hashString,
  hardFilterFailure,
  mergedHintOf,
  poolLatencyGateMs,
  profileRequest,
  providerMeetsContract,
  rankCandidates,
  type AutoRoutingStrategy,
  type MissingRequirement,
  type PoolStrategyCandidate,
  type RequestProfile,
  type StickyHint,
} from './autoRouting'
import {
  createQuotaGateContext,
  aggregateHeadroom,
  quotaBlockDetail,
  quotaSummaryOf,
} from './quota/gate.ts'
import { preferBlock, type RouteModelBlock } from '../../shared/routeQuotaView.ts'
import type { QuotaBlockReason } from './quota/limits.ts'
import { dailyUsageOf } from '../../shared/dailyUsage.ts'
import {
  exhaustionExpiresAt,
  findExhaustion,
  type AggregateQuotaExhaustionRecord,
} from '../../shared/aggregateQuotaExhaustion.ts'
import { aggregateBanditStats, banditKeyOf, type BanditStats } from './autoBandit.ts'
import { dispatchLedger, dispatchKeyOf } from './dispatchLedger.ts'
import { aggregateContextWindow } from './modelCapabilities.ts'
import { aggregateThirdPartyHint } from '../../shared/aggregateCapabilities.ts'
import { costBucketOf, type CostBucket } from '../../shared/channels.ts'
import { costScoreOfWeight, effectiveCostOf } from '../../shared/discountWindow.ts'
import type { ClientSessionKey } from '../../shared/clientSessionKey.ts'
import { aggregateCostOf, costBucketOfAggregateClass, type AggregateCostClass } from '../../shared/aggregateCost.ts'
import { aggregateDiscountWindowOf, type AggregateModelDiscount } from '../../shared/aggregate.ts'
import { recommendModelStars } from './autoRouting'

/**
 * 对外暴露的虚拟模型 id，保留字：不能作为真实模型或映射名。
 *
 * 这里曾经还有一份 `AUTO_RESERVED_NAMES`，配合请求解析层的 `missing` 分支给
 * 「路由不存在」的 404。那条分支已按拍板删除：删除 `auto` 之后 `model="auto"`
 * 退回普通模型名解析，请求路径不再区分「保留虚拟名」（详见
 * `store/modelRoutes.ts::resolveRouteRequest` 的注释）。
 */
export const AUTO_MODEL_ID = 'auto'

/** 配置缺失时最多失败切换几次 */
const AUTO_MAX_ATTEMPTS = 3

/** 会话粘性表容量上限，超出后按插入顺序淘汰最旧的条目 */
const STICKY_CAPACITY = 500
/** 缓存亲和落盘的合并窗：同一段会话连发时只写一次盘。 */
const AFFINITY_PERSIST_DEBOUNCE_MS = 5_000

/**
 * 单模型作用域（`modelScope: 'single'`）的换家墙钟预算。
 *
 * 90s 的池预算在单模型下没有意义：链只剩同一模型的几个账号，一旦它们都失败，
 * 继续等只会让客户端多挂几十秒才发现「这家现在不行」。40s 够覆盖两次首轮切片
 * （每次 20s），把「这个模型现在接不了」尽快交回给客户端 —— 下一轮由熔断/钉
 * 换模型，而不是在这一轮里把墙钟耗完。
 */
export const AUTO_SINGLE_SCOPE_BUDGET_MS = 40_000

/** 菜单里最多列几个候选模型：托盘子菜单再长就滚不动了。 */
export const ROUTE_MENU_MODELS_DEFAULT = 8

/**
 * 一页最多带几个模型：控制台路由页要「全部」，但不是无上限 —— 这个快照是逐请求
 * 现算的 IPC 载荷，真正的大池也就几百个，超过这个数说明调用方传错了。
 */
export const ROUTE_MENU_MODELS_MAX = 2_000

/**
 * 账号渠道的池内计数（`accountChannelManager.accountCounts()` 的形状）。
 *
 * 宿主侧每家渠道只有一条空凭据占位账号（`manager.ensureLocalAccount`），照本机表
 * 数永远是 1；真实池在渠道 Worker 里。菜单的「账号：N」对渠道行改用这里的 `enabled`。
 */
export type ChannelAccountCounts = Readonly<Record<string, { total: number; enabled: number }>>

/**
 * Whether this candidate's upstream has a documented cache behaviour.
 *
 * Aggregate entries carry the capability table; account channels carry theirs
 * on the channel definition (`shared/channels.ts::promptCache`, adapter-level
 * facts only). builtin/custom endpoints stay out, because "unknown" must not
 * silently become "cache-friendly".
 */
function promptCacheCapabilityOf(provider: Provider): PromptCacheCapability | undefined {
  if (provider.type === 'aggregate') {
    return promptCacheOf(getAggregateEntry(provider.aggregateId ?? provider.id))
  }
  if (provider.type === 'account') {
    return getChannelDefinition(provider.id)?.promptCache
  }
  return undefined
}

export interface AutoCandidate {
  account: Account
  provider: Provider
  displayName: string
  actualModel: string
}

/**
 * 被**瞬时**状态挡在候选池外的 (账号, 模型)。
 *
 * 与 `skipped` 的分工：`skipped` 是给人和日志看的字符串，这里是可以据此算
 * 「什么时候会有候选回来」的结构化记录。两类瞬时原因——额度窗口/上游亲口拒
 * 与账号当日上限——都会自己复位，复位前这一轮确实无人可派，但**不是**「这条
 * 路由没有模型」。
 */
export interface TransientSkip {
  providerId: string
  accountId: string
  /** 上游真实模型名：额度耗尽标记按这个键记（不是 displayName）。 */
  model: string
  /** 池内显示名：钉失配时按它归因「是哪颗钉被瞬时状态挡下」（pinTransient）。 */
  displayName: string
  /**
   * `rate_limited` = 渠道 worker 亲口说这个模型限流到某个时刻（读数镜像在
   * `accountChannelManager` 里）；它与额度窗口同属「会自己复位」，但复位时刻是
   * worker 给的，见 `until`。
   */
  reason: QuotaBlockReason | 'daily_limit' | 'rate_limited'
  /** 原因自带解禁时刻时给出（渠道 worker 的限流读数）。缺省按上游标记/默认间隔推。 */
  until?: number
}

/**
 * 跨供应商同名模型的分组键：去掉 `<供应商前缀> / `，大小写与空白无关。
 *
 * 用于换家链尾的排序（同名排在异名之前），不参与池筛选、也不改「谁先被派发」——
 * 同名的两家仍按分数排队。日期/版本后缀（`-1017`）刻意不归一：把两个版本当成
 * 同一个模型，是替上游宣布兼容。
 */
export function modelFamilyKey(displayName: string): string {
  const slash = displayName.lastIndexOf('/')
  const body = slash >= 0 ? displayName.slice(slash + 1) : displayName
  return body.trim().toLowerCase().replace(/\s+/g, '')
}

/**
 * 池内一行的键：`providerId` + 归一的显示名。
 *
 * 与 `preview` 的 `modelKeyOf`、评分的写入键同一个口径（同名模型可能被多家服务，
 * 各评各的）。放在这里是为了让「采集阶段记下的阻塞原因」和「预览行」对得上 ——
 * 两边各拼一次大小写/空白归一，迟早有一边查不到。
 */
export function modelRowKey(providerId: string, displayName: string): string {
  return `${providerId}\u0000${displayName.trim().toLowerCase()}`
}

export interface AutoRouteDecision {
  profile: RequestProfile
  candidates: AutoCandidate[]
  /**
   * 本次将服务的第一候选**已公布**的上下文窗口（token）。没公布就是 `undefined` ——
   * 不兜底成猜测值，日志与 `/v1/models` 用同一个口径（`shared/requestContextFit.ts`）。
   */
  contextWindow?: number
  /**
   * 可以**承诺给客户端**的那个数 —— 过了 `advertisedContextTokens` 的来源闸门。
   * 与上面 `contextWindow` 的差别只在来源：家族规则、标准库快照这类推定读数进日志
   * 有用，写进响应头会让客户端按一个可能偏大的上界安排压缩时机。
   */
  advertisedContextWindow?: number
  /**
   * 这条**路由**此刻对客户端承诺的窗口 —— 与 `/v1/models` 和客户端模型目录同一个数
   * （`floorOfPool`：钉住 > 当前模型 > 池内可广告最小值）。
   *
   * 转发层用它判断「这一跳真正服务的模型窗口是否低于承诺」：低了就必须就地裁剪到
   * 该模型的窗口，而不是把客户端按大窗攒的历史原样打上去等 400。2026-11-19
   * `daily` 实测：上一轮 1M 模型承诺、本轮被限流跳过、派给 262K 成员。
   */
  routeAdvertisedWindow?: number
  /**
   * 本轮决策之前这条会话的锚点（上一轮成功的模型/账号）。
   *
   * 只用于**事后对照**：服务者若与它不同，这一轮就是一次中途换家 —— 响应头
   * `X-ModelPort-Switch` 与请求日志 `auto.switchedFrom` 都从这一格派生。没有它，
   * 「客户端为什么崩」只能靠人工比对相邻两行的 `actualModel`。
   */
  previousHint?: StickyHint
  /** 会话指纹，成功后可交给 rememberRoute 固化本次选择 */
  conversationKey?: string
  /**
   * 上面这个键是客户端给的会话标识（`client-session`）还是内容指纹（`content-hash`）。
   * 请求日志要能区分：摘要改历史导致的中途换家，只有在这一格是 `content-hash` 时
   * 才解释得通。
   */
  stickyKeySource: 'client-session' | 'content-hash'
  /**
   * 本次决策依据的路由。调用方没传 route 时为 undefined —— 那走的是 legacy
   * `config.autoRouting`，响应头与日志里的路由名仍然是 `auto`。
   */
  route?: ModelRoute
  /**
   * 路由名（大小写不敏感的规范形）。请求头 `X-ModelPort-Route-Name` 与
   * 请求日志 `auto.route` 用它；粘性表也以它为前缀，两条路由互不抢占会话。
   */
  routeName: string
  /**
   * 账号故障类换家的**基础上限**：随 decision 交给 forwarder，转发层不再自己
   * 读全局 `autoRouting.maxAttempts`（那已经是 legacy 字段，逐路由值在 route 里）。
   */
  baseCap: number
  /**
   * 本次为了路由成功而放宽的契约（`response_format`）。空数组表示候选
   * 完整满足；非空时路由层必须在响应头里写明，不能假装满足。
   */
  degraded: string[]
  /**
   * 前置剔除的候选及其原因（如 `cline:tools_limit`、`loomy/spark-x2.6:rpd_exhausted`）。
   * 写进 `X-ModelPort-Auto-Skipped` 透出 —— 渠道没参与路由不能静默消失，
   * 客户端 harness 要能解释「为什么没走某渠道」（PLAN P0-2）。
   */
  skipped: string[]
  /** 空候选时说明缺的到底是什么，供 503/400 的 details 使用 */
  missing: string[]
  /** 本次生效的优化目标（配置值或请求头覆盖） */
  prefer: AutoPreference
  /** 胜负原因：显式选择 / 裁剪前只有一个模型 / 命中会话粘性 / 综合分 */
  reason: 'only' | 'pin' | 'sticky' | 'cache-affinity' | 'score'
  /**
   * 本轮「首字太慢」的池内门槛（毫秒，候选 EWMA 的 p75）；读数不足 4 个时不出现。
   * 两个消费点同源：选路时它决定硬粘性还提不提前（`stickyGated`），流结束时
   * `shouldRevokeStickyAfterStream` 用它判「这一轮慢到该撤锚点」。
   */
  latencyGateMs?: number
  /**
   * 硬粘性这一轮因为上面的门槛被跳过：上一轮的模型慢于池内 p75，没有提到队首。
   * 与 `reason` 分开写 —— `reason: 'score'` 说明不了「本来是粘性命中」。
   */
  stickyGated?: true
  /**
   * 本轮生效的换家范围。`single` 下 `candidates` 只剩同一模型的账号 —— 日志里
   * `chainLength` 从「池子大小」变成「同模型账号数」，没有这一格会被误读成池子塌了。
   */
  modelScope?: ModelScope
  /** 本轮实际选定的模型（队首候选），与 `candidates[0].displayName` 同值，便于检索。 */
  model?: string
  /** 生效中的钉：谁、按什么作用域。`until` 恒 0 = 持久。 */
  pin?: {
    displayName: string
    scope: ModelPinScope
    source: ModelPinSource
    until: number
  }
  /** 钉子没命中（模型没有可派账号/被筛掉）：不静默回退，写明差的是哪个。 */
  pinMiss?: string
  /**
   * 钉子指向的模型**不在池里**（不是冷却）：拒答保钉（`action:'held'`），本轮快速
   * 失败，不回落、不自动退役 —— 只有用户手动替换/解除能改。见 `shared/types.ts`。
   */
  pinStale?: {
    displayName: string
    scope: ModelPinScope
    source: ModelPinSource
    action: 'held'
  }
  /**
   * 钉子指向的模型**仍在池里，只是它名下的账号此刻全部在冷却**（15s–10min 的
   * 账号/限流退避）。这不是失效：钉子在，等冷却过去自己回来。调用方投影成
   * 429 + `Retry-After` 且**不清钉** —— 一次上游抖动的首字超时不该让用户的选择
   * 消失（现网：03:14:07 一次 504，25 秒后同一颗钉报 `pin_stale`）。
   */
  pinCooling?: {
    displayName: string
    scope: ModelPinScope
    source: ModelPinSource
    retryAfterSeconds: number
  }
  /**
   * 钉指向的模型**仍在路由里，只是名下账号全被瞬时状态挡下**（限流窗口/额度
   * 耗尽/当日上限）：与 `pinStale` 互斥 —— 名字还在池里，窗口复位就自己回来。
   * 这三种剔除发生在 `rankInputs` 之前，钉名必然失配；不单独处置就会把一颗好钉
   * 报成「不再属于这条路由」，诱使用户撤掉它。调用方投影成 429 + `Retry-After`
   * 且**不清钉**。
   */
  pinTransient?: {
    displayName: string
    scope: ModelPinScope
    source: ModelPinSource
    cause: 'quota' | 'daily_limit' | 'mixed' | 'rate_limit'
    retryAfterSeconds: number
  }
  /**
   * 钉指向的模型**这一轮用不了**：请求要的能力它没有（`missing` 给出能力名），
   * 或被契约过滤挡下（`missing` 为空）。钉保留、本轮拒答（503），不回落；
   * 由调用方把「是这颗钉挡的」写进 details。
   */
  pinBlocked?: {
    displayName: string
    scope: ModelPinScope
    source: ModelPinSource
    missing: ModelHardRequirement[]
  }
  /** 本轮被模型级熔断排到队尾的模型。 */
  circuited?: string[]
  /**
   * 空池不是配置筛空的，而是候选全被**瞬时状态**挡掉（额度窗口/上游亲口拒、
   * 账号当日上限）。调用方把它投影成 429 + `Retry-After` —— 可重试，而不是
   * 503「这条路由没有模型」：后者会让用户去查供应商，而真正要等的是一个窗口复位。
   */
  transientUnavailable?: {
    cause: 'quota' | 'daily_limit' | 'mixed' | 'rate_limit'
    /** 被瞬时状态挡掉的 (账号, 模型) 条数。 */
    skipped: number
    retryAfterSeconds: number
  }
  /** 本条路由的换家墙钟预算；缺省用 `AUTO_WALL_CLOCK_BUDGET_MS`。 */
  wallClockBudgetMs?: number
}

// 预览的 DTO 定义在 shared/types.ts：渲染进程要用同一份形状，而 renderer 不能
// 从 main/proxy 取类型。这里只做再导出，保持既有的 import 路径可用。
export type {
  RoutePreviewModel,
  RoutePreviewResult,
  RoutePreviewSample,
  RoutePreviewStatus,
} from '../../shared/types'

interface StickyRoute {
  hint: StickyHint
  expiresAt: number
}

/**
 * 一个模型的成本档：渠道目录报的倍率最权威，其次是聚合条目的免费标记；
 * 内置与自定义没有任何成本信息，返回 unknown（打分里取中性值）。
 *
 * 聚合条目走 `shared/aggregateCost.ts` 的分类，而不是直接看 `freeModelsHint`：
 * 那条老路径只认"免费池类别或免费清单"，于是 91 条有第三方标价的模型
 * （以及所有订阅端点）全部落进 unknown，`cheap` 偏好实际上挑不到免费模型。
 * 分类器把"官方免费 / 目录免费 / 套餐内 / 按量 / 未知"分开，这里只做档位映射：
 * 套餐内与免费同档（请求时刻的现金支出都是 0），按量一律 above-base
 * （USD 没有倍率基准，只能回答"要不要额外花钱"）。
 */
function costBucketFor(
  provider: Provider,
  actualModelId: string,
  hint: ModelCapabilityHint | undefined
): CostBucket {
  return costSignalFor(provider, actualModelId, hint).bucket
}

/**
 * 一次算出成本档与（聚合的）原始消耗分类。`costBucket` 把套餐内折成免费
 * （请求时刻现金支出都是 0，保持打分口径不变），而 `costClass` 保留未折叠
 * 的 `included`，供策略筛选区分「订阅额度内」与「完全免费」。非聚合候选没有
 * 分类（undefined）。
 */
function costSignalFor(
  provider: Provider,
  actualModelId: string,
  hint: ModelCapabilityHint | undefined,
  now: number = Date.now()
): { bucket: CostBucket; costClass?: AggregateCostClass; weight?: number } {
  // 静态 `free` 标记是**采集那一刻**的结论（`weight === 0`）。有折扣窗口时它已
  // 不是常量：夜里 0 白天 0.29 的模型两边都是它，按常量读就会把 24 小时都判成
  // 免费。故有窗口时让位给按本地时钟算出的生效价，没窗口时保持原来的短路 ——
  // `effectiveCostOf` 就是这一条规则本身，渠道页与模型管理页读的是同一个函数，
  // 所以同一个瞬间它们不会给出两个价。
  const { free, weight } = hint === undefined
    ? { free: false, weight: undefined as number | undefined }
    : effectiveCostOf(hint, now)
  if (free) return { bucket: 'free', ...(weight === undefined ? {} : { weight }) }
  if (weight !== undefined) return { bucket: costBucketOf(weight, free), weight }

  if (provider.type === 'aggregate') {
    const entry = getAggregateEntry(provider.aggregateId ?? provider.id)
    if (entry !== undefined) {
      const signal = aggregateCostOf({
        entryId: entry.id,
        modelId: actualModelId,
        ...(entry.freeModelsHint ? { freeModelsHint: entry.freeModelsHint } : {}),
      })
      return { bucket: costBucketOfAggregateClass(signal.class), costClass: signal.class }
    }
  }

  return { bucket: 'unknown' }
}

function candidateKey(providerId: string, accountId: string, displayName: string): string {
  return `${providerId}:${accountId}:${displayName}`
}

/**
 * 粘性表的分键：`${路由名}|${会话指纹}`。
 *
 * 会话指纹只由消息内容算出，与「用哪条路由跑」无关，所以不加前缀的话，同一句
 * 对话先走 `fast` 再走 `cheap` 时后一条会把前一条钉住的目标抢走（两条路由互相
 * 覆盖），路由配置里的 `stickyMinutes` 也就成了全局的。分开键以后各自独立，
 * 过期清理与容量淘汰照旧（淘汰的是最旧插入的一条，不区分路由）。
 */
function stickyMapKey(routeName: string, conversationKey: string): string {
  return `${routeName}|${conversationKey}`
}

/**
 * 把上一轮成功的模型提到候选队首（精确账号优先），其余顺序不变。
 *
 * 纯函数、不修改入参；`sticky` 对应模型不在候选里（停服/冷却/被策略筛掉）
 * 时原样返回，调用方仍按正常打分让位。
 */
function promoteSticky<
  T extends { providerId: string; accountId: string; displayName: string },
>(ranked: readonly T[], sticky: StickyHint | undefined): T[] {
  if (sticky === undefined) return [...ranked]
  const matches = ranked.filter(candidate =>
    candidate.providerId === sticky.providerId && candidate.displayName === sticky.displayName
  )
  if (matches.length === 0) return [...ranked]
  const exact = matches.filter(candidate => candidate.accountId === sticky.accountId)
  const sameModel = matches.filter(candidate => candidate.accountId !== sticky.accountId)
  const others = ranked.filter(candidate => !matches.includes(candidate))
  return [...exact, ...sameModel, ...others]
}

/**
 * 钉提升：把被钉住的模型提到队首（同模型不限账号，具体账号仍由打分决定）。
 *
 * 与 `promoteSticky` 的差别只在意图来源：粘性是「上一轮成功过」，钉是
 * 「用户/客户端点名要它」。后者优先于前者 —— 用户意图高于历史惯性。
 */
function promotePinned<
  T extends { providerId: string; displayName: string },
>(ranked: readonly T[], target: { providerId?: string; displayName: string }): { list: T[]; hit: boolean } {
  const matches = ranked.filter(candidate =>
    candidate.displayName === target.displayName
    && (target.providerId === undefined || candidate.providerId === target.providerId)
  )
  if (matches.length === 0) return { list: [...ranked], hit: false }
  return { list: [...matches, ...ranked.filter(candidate => !matches.includes(candidate))], hit: true }
}

/** 预览缓存的存活时长（毫秒）：够覆盖「打开菜单 → 点一下」这个过程，又比配置编辑的手速短。 */
const PREVIEW_CACHE_MS = 15_000

/** 预览缓存的条数上限：键里带整条池配置，每改一次多一个键。 */
const PREVIEW_CACHE_ENTRIES = 64

/** 模型级熔断默认 5 分钟：够跨过一阵额度/上游抖动，又不至于把还能用的模型锁太久。 */
export const MODEL_CIRCUIT_MINUTES = 5

/**
 * 内存里的一颗钉：现在只承载请求头写入的会话/路由级钉（裁定 2026-11-15 后，
 * 控制台与托盘的路由级钉统一落盘成路由配置 `preferredModel`，不走这里）。
 * `until` 恒 0 = 持久，没有倒计时；重启即清。
 */
export interface ModelPin {
  route: string
  displayName: string
  providerId?: string
  scope: ModelPinScope
  sessionKey?: string
  until: number
  source: ModelPinSource
}

/** 一次模型级熔断：某个 (路由, 模型) 在这一轮之前反复退化或被上游拒绝。 */
export interface ModelCircuitEntry {
  route: string
  displayName: string
  until: number
  reason: string
}

function pinMapKey(routeName: string, scope: ModelPinScope, sessionKey?: string): string {
  return `${routeName}|${scope}|${scope === 'session' ? sessionKey ?? '' : '*'}`
}

function circuitMapKey(routeName: string, displayName: string): string {
  return `${routeName}|${displayName.trim().toLowerCase()}`
}

/**
 * 硬粘性这一轮要不要让位（第 2 条「延迟从罚分升为门」，2026-11-12）。
 *
 * 现状是硬粘性无条件把上一轮的模型提到队首，而首字延迟在打分里只是封顶 0.2 的
 * 罚分（`autoRouting.ts::scoreCandidate`）—— 实测一个首字 9.7–35.1s 的模型被
 * 锁了半小时，每一轮都先把整个等待付完。这里把「慢于池内 p75」升为门：达到就
 * 不提前，退回打分顺序（粘性的 +0.12 仍在，它够便宜/够合适时照样能赢）。
 *
 * 只看**会被提前的那个候选**（精确账号优先，其次同模型其他账号）的读数：
 * 拿同模型另一个快账号的读数替它开脱，等于让慢账号继续吃派发。
 */
function stickyLatencyExceeded<
  T extends { providerId: string; accountId: string; displayName: string; ewmaFirstTokenMs?: number },
>(ranked: readonly T[], sticky: StickyHint | undefined, gateMs: number | undefined): boolean {
  if (sticky === undefined || gateMs === undefined) return false
  const matches = ranked.filter(candidate =>
    candidate.providerId === sticky.providerId && candidate.displayName === sticky.displayName
  )
  const promoted = matches.find(candidate => candidate.accountId === sticky.accountId) ?? matches[0]
  const ewma = promoted?.ewmaFirstTokenMs
  return ewma !== undefined && ewma > gateMs
}

/** 没传路由时（legacy 路径）在粘性表与响应头里使用的名字：就是那个虚拟模型名。 */
const LEGACY_ROUTE_NAME = AUTO_MODEL_ID

/**
 * 注册表行的时段折扣 → `record` 层标注。
 *
 * 字段对位（与账号渠道 `modelCatalog.ts::capabilityHintOf` 同一张表）：
 * `promoWeight` = 窗口内的价，`baseWeight` = 窗口外的原价，`weight` 也取原价 ——
 * `effectiveWeightOf` 在两侧都齐时不会读它，缺 `promoWeight` 的残缺折扣（只报
 * 原价）靠它兜底，行为与「窗口外按原价」一致。`discountWindow` 经
 * `aggregateDiscountWindowOf` 收窄，读不懂的字段不进标注。
 */
function registryDiscountToHint(discount: AggregateModelDiscount): ModelCapabilityHint {
  const window = aggregateDiscountWindowOf(discount)
  return {
    ...(discount.baseWeight === undefined ? {} : { weight: discount.baseWeight }),
    ...(discount.weight === undefined ? {} : { promoWeight: discount.weight }),
    ...(discount.baseWeight === undefined ? {} : { baseWeight: discount.baseWeight }),
    ...(window === undefined ? {} : { discountWindow: window }),
  }
}

/**
 * 一个模型的四层标注。分层只为**取值的优先级**与**来源展示**：手工 > 供应商记录
 * > 聚合官方 > 第三方，缺席的层不参与。
 *
 * 供应商记录来自账号渠道/内置同步（最接近真相的动态数据）；聚合官方是额度旁表里
 * 的上下文窗口；第三方是 models.dev 旁表。三层都不填默认值。
 */
interface CandidateHints {
  record?: ModelCapabilityHint
  official?: ModelCapabilityHint
  catalog?: ModelCapabilityHint
  probe?: ModelCapabilityHint
  thirdParty?: ModelCapabilityHint
  manual?: ModelCapabilityHint
}

/**
 * 收集一个模型全部标注层。`marks` / `adoptions` / `probeIndex` 是本次决策一次性
 * 读出的三张表 —— 逐候选读 store 会让一次 `select` 读几十次盘上对象。
 *
 * 顺序与 metadata 链一致：manual > record > official > catalog > probe >（静态/第三方在
 * `resolveCapabilityDetail` 内按固定顺序补位）。catalog 只来自 adoption ledger，
 * 未采用的候选不参与；价格字段永远不会出现在这里。probe 只取新鲜且 `measured`
 * 的行（`probeRowToLayer` 自带这条判据，这里不重写第二份）。
 */
function capabilityHintsFor(
  provider: Provider,
  displayName: string,
  actualModelId: string,
  marks: UserModelMarks,
  adoptions: readonly CatalogAdoption[],
  probeIndex: ReadonlyMap<string, ModelProbeRow>,
  nowMs: number
): CandidateHints {
  const aggregateId = provider.type === 'aggregate' ? (provider.aggregateId ?? provider.id) : undefined
  // 聚合条目的「供应商记录」= 注册表行本身：账号渠道的折扣由同步写进
  // `modelCapabilities`，聚合没有同步那一步，目录行里的 `discount` 就是供应商
  // 自己声明的时段折扣（与 `aggregateContextWindow` 同一条「目录事实」链）。
  // 写进 `record` 层而不是新开一层：`mergedHintOf` 已合并 record，`costSignalFor`
  // 已对合并结果跑 `effectiveCostOf` —— 路由、渠道页与模型管理页因此同一时刻
  // 给出同一个价，不再需要任何一处的第二份推算。
  const registryDiscount = aggregateId === undefined
    ? undefined
    : (getAggregateEntry(aggregateId)?.models ?? [])
      .find(model => model.id === actualModelId || `${aggregateId}/${model.id}` === actualModelId)
      ?.discount
  const record = provider.modelCapabilities?.[displayName]
    ?? (registryDiscount === undefined ? undefined : registryDiscountToHint(registryDiscount))
  const contextWindow = aggregateId === undefined
    ? undefined
    : aggregateContextWindow(aggregateId, actualModelId)
  const thirdParty = aggregateId === undefined
    ? undefined
    : aggregateThirdPartyHint(aggregateId, actualModelId)
  const manual = marks[provider.id]?.[displayName]
  const catalog = catalogAdoptionHint(adoptionsForModel(adoptions, provider.id, displayName))
  const probeRow = probeIndex.get(probeRowKey({ providerId: provider.id, displayName }))
  const probe = probeRow === undefined ? undefined : probeRowToLayer(probeRow, nowMs)?.hint

  return {
    ...(record === undefined ? {} : { record }),
    ...(contextWindow === undefined ? {} : { official: { contextTokens: contextWindow } }),
    ...(catalog === undefined ? {} : { catalog }),
    ...(probe === undefined ? {} : { probe }),
    ...(thirdParty === undefined ? {} : { thirdParty }),
    ...(manual === undefined ? {} : { manual }),
  }
}

/**
 * 瞬时剔除里**能等回来**的那几类原因。字符串形态由 `collectCandidates` 写入
 * `skipped`（`<供应商>/<模型>:<原因>`），这里按最后一个冒号后的原因判定 ——
 * 模型名里带冒号也不会误判。
 */
const TRANSIENT_SKIP_REASONS = new Set<string>([
  'daily_limit',
  'no-credit',
  'quota-exhausted',
  'rpm_exhausted',
  'rpd_exhausted',
  'tpm_exhausted',
  'tpd_exhausted',
  'monthly_exhausted',
  // 渠道 worker 的模型级限流（`modelRateLimits` 读数的镜像）。
  'rate_limited',
])

/** 算不出解禁时刻时的重试间隔（秒）：窗口类原因最短的复位粒度就是分钟级。 */
const DEFAULT_TRANSIENT_RETRY_AFTER_SECONDS = 60

/**
 * 一条「被谁筛掉」的清单一次最多报几条。
 *
 * 候选链不再裁短之后，「渠道整条限流」这类跳过一次能攒几十条，而这条清单要走两个地方：
 * `X-ModelPort-Auto-Skipped` 响应头（超长头会让客户端或中间代理把整条响应判坏）与空池
 * 错误体的 `details.skipped`。两处共用这一个上限，免得头与体的说法不一致。
 */
export const AUTO_SKIPPED_REPORT_LIMIT = 8

function skippedAreAllTransient(skipped: ReadonlySet<string>): boolean {
  if (skipped.size === 0) return false
  for (const marker of skipped) {
    if (!TRANSIENT_SKIP_REASONS.has(marker.slice(marker.lastIndexOf(':') + 1))) return false
  }
  return true
}

/**
 * 瞬时空池的人话成因：客户端读得到、用户也读得懂，且与 `details.cause` 同源。
 */
export function describeTransientCause(cause: 'quota' | 'daily_limit' | 'mixed' | 'rate_limit'): string {
  if (cause === 'daily_limit') return 'daily request limit reached'
  if (cause === 'mixed') return 'quota and daily limits reached'
  if (cause === 'rate_limit') return 'upstream rate limit in effect'
  return 'quota or credit exhausted'
}

function nextLocalMidnight(now: number): number {
  const day = new Date(now)
  day.setHours(24, 0, 0, 0)
  return day.getTime()
}

/**
 * 把一串瞬时剔除折成「等多久会有候选回来」。
 *
 * 能算准的只有两种：上游给了 `until` 的额度耗尽标记（没给时按
 * `QUOTA_EXHAUSTION_TTL_MS` 过期），以及账号当日上限（下一个本地午夜）。窗口类
 * 原因（rpm/tpm/…）本地账本没有复位时刻，退回一分钟 —— 给一个短的重试间隔，
 * 比编一个精确到毫秒的假时刻好。一次取最早解禁的那一个：那一刻起池子里就重新
 * 有人了。
 *
 * 两个消费点共用这一份：auto 路由的空池投影，与具名模型的空池诊断
 * （`loadBalancer.transientEmptyPoolSkips` → chat/completions 的 429）。
 */
export function summarizeTransientSkips(
  skips: readonly TransientSkip[],
  now: number
): NonNullable<AutoRouteDecision['transientUnavailable']> | undefined {
  if (skips.length === 0) return undefined
  let quota = false
  let daily = false
  let rateLimit = false
  let unlockAt = Number.POSITIVE_INFINITY
  const exhaustions = new Map<string, AggregateQuotaExhaustionRecord[] | undefined>()
  for (const skip of skips) {
    if (skip.reason === 'daily_limit') {
      daily = true
      unlockAt = Math.min(unlockAt, nextLocalMidnight(now))
      continue
    }
    // 渠道 worker 的限流读数自带解禁时刻：不用再翻额度标记表。
    if (skip.reason === 'rate_limited') {
      rateLimit = true
      if (skip.until !== undefined) unlockAt = Math.min(unlockAt, skip.until)
      continue
    }
    quota = true
    if (skip.reason !== 'quota-exhausted') continue
    if (!exhaustions.has(skip.providerId)) {
      try {
        exhaustions.set(skip.providerId, storeManager.getAggregateQuotaExhaustionsOf(skip.providerId))
      } catch (error) {
        // 读不出标记只说明算不了精确时刻，不能让空池报告整个失败
        console.error('[AutoRouter] quota exhaustion records unavailable:', error)
        exhaustions.set(skip.providerId, undefined)
      }
    }
    const record = findExhaustion(exhaustions.get(skip.providerId), skip.accountId, skip.model, now)
    if (record !== undefined) unlockAt = Math.min(unlockAt, exhaustionExpiresAt(record))
  }
  return {
    cause: (quota || rateLimit) && daily
      ? 'mixed'
      : daily
        ? 'daily_limit'
        : quota
          ? 'quota'
          : 'rate_limit',
    skipped: skips.length,
    retryAfterSeconds: unlockAt === Number.POSITIVE_INFINITY
      ? DEFAULT_TRANSIENT_RETRY_AFTER_SECONDS
      : capClientRetryAfterSeconds((unlockAt - now) / 1000),
  }
}

class AutoRouter {
  private seed = 0
  /**
   * `${路由名}|${会话指纹}` -> 上次成功的候选，用于多轮粘性。
   *
   * ⚠️ 陈旧态边界一：`expiresAt` 在**写入时**按当时那条路由的 `stickyMinutes`
   * 烘焙成绝对时间戳，所以改路由的粘性时长只影响**之后**写入的记录，已经在期的
   * 那条会按旧时长走完 —— 配置本身是每次请求现读的（`getConfig()`），唯独这个
   * 进程内 Map 不是。把 stickyMinutes 改成 0 也不会立刻清空旧记录（下次命中时
   * 判定过期才删）。代理重启（`reset()`）才彻底归零。
   */
  private sticky = new Map<string, StickyRoute>()
  /**
   * Cache-affinity hints, kept apart from `sticky` because their lifetime and
   * their reason are different: a conversation stays on the same account/model
   * for as long as the upstream cache plausibly lives, even when the user set
   * `stickyMinutes` to 0. Only providers with a known cache capability enter
   * this map.
   */
  private cacheAffinity = new Map<string, StickyRoute>()

  /**
   * 磁盘上的亲和读数只载入一次（第一次真正用它时）。进程重启会清掉这个 Map，
   * 而「重启后仍回同一缓存域」正是它落盘的全部理由；一次载入失败不能让选路变红，
   * 所以只记一行警告然后按空表继续。
   */
  private cacheAffinityHydrated = false

  /** 落盘节流：成功请求可能每秒好几笔，`data.json` 是整档重写。 */
  private affinityPersistTimer: ReturnType<typeof setTimeout> | null = null
  private affinityPersistDirty = false

  /**
   * 内存钉：请求头（`X-ModelPort-Model`）点名要的模型，按 (路由, 作用域) 存。
   * 控制台/托盘的路由级钉不走这里 —— 统一落盘成路由配置 `preferredModel`
   * （裁定 2026-11-15）。
   *
   * 三条边界都在这一格里：
   * - **只影响回合之间**。一轮请求选定模型后，换家只在同模型内换账号；钉改变的
   *   是「下一轮从谁开始」，不是「这一轮途中换谁」。
   * - **优先于粘性**。用户意图高于历史惯性；粘性子句仍然负责「同一模型内选哪个账号」。
   * - **失配不静默、不回落**。钉住的模型这一轮用不了时拒答保钉（`pinMiss` /
   *   `pinCooling` / `pinBlocked` / `pinStale` 落进日志与响应头），绝不换别的模型。
   *
   * `until` 恒 0 = 持久；`sweepPins` 只清历史遗留的正值到期记录。
   */
  private modelPins = new Map<string, ModelPin>()
  /**
   * 预览结果的短缓存：键 = 路由名 + **解引用后**的池配置 + 采样开关。
   *
   * 为什么值得缓存：`routes:menu` 逐路由调 `preview`，而 `preview` 每次都对全池
   * 跑一遍采集/策略/手动管线（2026-11-13 实测 p50 4.7s、p90 10.2s、max 11.0s）。
   * 预览刻意不读冷却（它回答的是配置问题），所以同一个配置在几秒内答案不变。
   * 读到的值一律 `structuredClone` 后交出，调用方改自己的副本不会污染这里。
   */
  private previewCache = new Map<string, { at: number; value: RoutePreviewResult }>()

  /**
   * 模型级熔断：`(路由, 模型)` -> 解禁时间。
   *
   * 这是「回合之间换模型」的**唯一通路** —— 泳道栅栏退役后，跨模型换家只能发生在
   * 回合边界，而退化读数（重复/空转/只说不做/被上游拒绝）必须先落成一张模型级的票，
   * 下一轮才会从别的模型开始。账号级 AIMD 管的是「这个账号此刻能不能接」，两者不合并：
   * 同一个模型的三家账号全被限流，不代表这个模型本身该被换掉。
   *
   * 全部候选都在熔断里时不熔断（`select` 里判）：没有落脚点的「跳过」等于把这一轮
   * 变成空池，比多试一次更糟。
   */
  private modelCircuit = new Map<string, ModelCircuitEntry>()

  /**
   * 每条路由上一轮实际服务的模型/账号。
   *
   * 只用于菜单的「上轮服务」一格与托盘提示：粘性表以会话为键，回答不了「这条路由
   * 上一轮跑的是谁」；而托盘的整个价值就是让用户一眼看到这一点。
   */
  private lastServed = new Map<string, RouteMenuCurrent>()

  /**
   * `/v1/models` 的 `context_window`：**这条路由自己的候选池**里最小的那个窗口。
   *
   * 采集与 `select` 同源（同一个 `collectCandidates`，同一套池策略与手动增删折叠），
   * 差别只有两处，都是广告语义要求的：
   * - 不扣冷却、额度与当日用量（`ignoreTransientAvailability`）—— 那三样每个请求都
   *   在变，广告一个随后会变小的数，等于让客户端按它拿不到的上界安排字节；
   * - 不扣请求画像与契约过滤 —— vision/tools/context/`n` 是请求属性而不是路由配置。
   *
   * 未标注窗口的候选**不往这个数里贡献值**（原先按 64K 那个猜测参与，全池常常就报出
   * 假数：Codex 按 `×0.95` 把压缩点定在 60800，长会话被客户端提前摘要，之后模型
   * 看不见任务）。广告的是**已公布窗口里最小的那个**，一家都没公布就省略这个键；
   * 未标注的候选也不因上下文被淘汰 —— 广告与放行都不拿猜测当读数
   * （`autoRouting.ts::hardFilterFailure`）。被池策略或 `excludeModels` 剔掉的候选
   * 不再参与，所以一条只钉了几家大窗模型的路由会广告那些模型自己的窗口；
   * 候选收敛到一个模型时（同一模型的多个账号算一个），最小值就是那个模型的窗口。
   * 空池同样返回 `undefined`：没有候选就没有可说的，键必须省略而不是写个默认值。
   */
  advertisedContextFloor(route?: ModelRoute): number | undefined {
    return this.floorOfPool(this.advertisedPool(), route)
  }

  /**
   * 批量版：`/v1/models` 一次广告多条路由。
   *
   * 候选池只走一遍 —— 逐路由各走一遍会把 `quotaBlockReason` 与日志聚合重复 N 次；
   * 每条路由只做自己的池策略与手动增删折叠。键是路由名。
   */
  advertisedContextFloors(routes: readonly ModelRoute[]): Map<string, number | undefined> {
    const pool = this.advertisedPool()
    const floors = new Map<string, number | undefined>()
    for (const route of routes) {
      if (!floors.has(route.name)) floors.set(route.name, this.floorOfPool(pool, route))
    }
    return floors
  }

  /**
   * 每条路由**池内共同支持**的输入模态（2026-11-18）。
   *
   * 取交集而不是并集：广告「支持图片」就得每个候选都支持，否则客户端的附图请求会落到
   * 一个纯文本模型上、被能力过滤判成 `missing:['vision']` —— 客户端只看到一句失败，
   * 不知道是路由换家换掉了这个能力。`unknown` 按不支持算（没有证据就不承诺）。
   *
   * 空池返回 `undefined`：没有候选就没有可说的能力。
   */
  advertisedVision(routes: readonly ModelRoute[]): Map<string, boolean | undefined> {
    const pool = this.advertisedPool()
    const out = new Map<string, boolean | undefined>()
    for (const route of routes) {
      if (out.has(route.name)) continue
      const kept = this.keptOfPool(pool, route)
      // 判据是**存在性**，与选路一致：附图请求会被 `hardFilterFailure` 过滤到能收图的候选，
      // 所以只要还有一个候选没被排除，这条路由就能收图。写 `every` 会让池里一个明确
      // `vision:'no'` 的模型把整条路由降成 text-only，而实际派发完全正常（现网实测）。
      out.set(
        route.name,
        kept.length === 0
          ? undefined
          : kept.some(candidate => capabilityOfCandidate(candidate).vision !== 'no'),
      )
    }
    return out
  }

  /** 广告下界用的候选池：与请求无关（空 messages，故渠道工具门与工具负载都不参与），且不扣瞬时可用性 */
  private advertisedPool(): PoolStrategyCandidate[] {
    const probe = { messages: [] } as unknown as ChatCompletionRequest
    return this.collectCandidates(probe, Date.now(), { ignoreTransientAvailability: true }).rankInputs
  }

  /**
   * 读图两段式（visionRelay）的候选采集：与选路同一个 `collectCandidates`，
   * 不另造一套池判据。扣瞬时可用性（默认口径）——一个正在限流/额度打满的模型
   * 不该被选去读图；`ignoreTransientAvailability` 留给「链上还有谁」的诊断展示。
   */
  relayCandidatePool(): PoolStrategyCandidate[] {
    const probe = { messages: [] } as unknown as ChatCompletionRequest
    return this.collectCandidates(probe, Date.now()).rankInputs
  }

  /**
   * 具名路径目标的视觉能力：标注层与 `collectCandidates` 同一套
   * （手工 > 供应商记录 > 聚合官方 > 采用 > probe > 静态/家族 > 兜底 > 第三方）。
   * 读图两段式用它回答「这一轮要被服务的模型收不收图」，不另造第二份判据。
   */
  visionOf(providerId: string, displayName: string, actualModelId: string): 'yes' | 'no' | 'unknown' {
    const provider = storeManager.getProviderById(providerId)
    if (provider === undefined) return 'unknown'
    const hints = capabilityHintsFor(
      provider,
      displayName,
      actualModelId,
      storeManager.getUserModelMarks(),
      storeManager.getCatalogAdoptions(),
      indexProbeRows(getProbeRowsSync()),
      Date.now(),
    )
    return capabilityOfCandidate({
      providerId,
      displayName,
      ...(hints.record === undefined ? {} : { capabilityHint: hints.record }),
      ...(hints.manual === undefined ? {} : { manualHint: hints.manual }),
      ...(hints.official === undefined ? {} : { officialHint: hints.official }),
      ...(hints.catalog === undefined ? {} : { catalogHint: hints.catalog }),
      ...(hints.probe === undefined ? {} : { probeHint: hints.probe }),
      ...(hints.thirdParty === undefined ? {} : { thirdPartyHint: hints.thirdParty }),
    }).vision
  }

  /**
   * 一条路由在给定池上折叠出的候选：池策略之后、手动增删之后。不传 `route` 时回退
   * legacy 全局池策略（与 `select` 同口径）。广告下界与候选数都从这里折，两处不许
   * 各写一遍折叠（写两遍就会有一遍忘了 `excludeModels`）。
   */
  private keptOfPool(pool: readonly PoolStrategyCandidate[], route?: ModelRoute): PoolStrategyCandidate[] {
    // 名字钉定先收基底：广告下界与选路折的是同一个基底，两处不许分叉。
    // 能力下限与选路同一个位置（名字钉定之后、池策略之前）：广告出去的窗口必须
    // 是这条路由**真的会用**的那几个模型的窗口。
    const base = applyMinTier(applyModelNamePin(pool, route?.pinModels), route?.minTier)
    const strategies: readonly AutoPoolStrategy[] = route?.poolStrategies
      ?? storeManager.getConfig().autoRouting?.poolStrategies
      ?? []
    const afterStrategies = applyPoolStrategiesWithTrace(base, strategies).kept
    return applyManualModelSelection(
      afterStrategies,
      base,
      route?.includeModels ?? [],
      route?.excludeModels ?? []
    ).kept
  }

  /**
   * 一条路由在给定池上对外公布的窗口。
   *
   * 顺序是**钉住 → 当前模型 → 池内最小**：
   *
   * 1. **钉住**用它钉的那个模型：一旦钉住，这条路由只会派那一个模型，池里别的模型
   *    与它无关（那才是「1M 模型被 128K 标准砍断」的坑）。
   * 2. **当前模型**指上一轮真正服务的那个（`lastServed`）—— 路由换家之后，客户端要
   *    按新模型的窗口压缩历史，而不是按池里某个跟它无关的候选。没有这条，128K 的
   *    模型接手后客户端仍按旧的大窗口发送，请求会被 context 硬过滤掉（换家或 503）。
   * 3. 两者都没有（首次请求 / 记录里的模型已不在池里）→ 池内**最小**：这条路由会落到
   *    任意候选上，报小则请求永远发得出去。
   *
   * 拿不到任何可广告读数时用 200K 兜底（与客户端压缩、网关裁剪同一个常量）；
   * 空池返回 `undefined` —— 没有候选就没有可说的窗口。
   */
  private floorOfPool(pool: readonly PoolStrategyCandidate[], route?: ModelRoute): number | undefined {
    const kept = this.keptOfPool(pool, route)
    // 钉住优先；否则用「当前模型」——上一轮真正服务的那个（`lastServed`）。
    const current = route === undefined ? undefined : this.lastServed.get(route.name)
    const target = route?.preferredModel
      ?? (current === undefined
        ? undefined
        : { providerId: current.providerId, displayName: current.displayName })
    if (target !== undefined) {
      const matches = kept.filter(candidate =>
        candidate.displayName === target.displayName
        && candidate.providerId === target.providerId
      )
      if (matches.length > 0) {
        const windows = matches.map(candidate => advertisedContextTokens(capabilityOfCandidate(candidate)))
        // 这个模型没有可广告读数：给兜底值，不拿池里别人的数糊上去。
        return advertisedContextFloorOf(windows) ?? UNANNOTATED_CONTEXT_FALLBACK
      }
    }
    const floor = advertisedContextFloorOf(
      kept.map(candidate => advertisedContextTokens(capabilityOfCandidate(candidate)))
    )
    // 没有钉、也没有「当前模型」（首次请求 / 记录里的模型已离池）→ 池内最小。
    return floor ?? (kept.length > 0 ? UNANNOTATED_CONTEXT_FALLBACK : undefined)
  }

  /**
   * 每条路由当前池里有几个**模型**（按供应商分组后再数名字，不是账号数）。
   *
   * 与广告下界共用同一次采集与同一条折叠，差别是这里不扣瞬时可用性：它回答的是
   * 「这份配置把池定成多大」，而这一刻有几家能派是请求期才知道的事。`0` 是可信
   * 读数（池确实被策略或手动移除筛光，后续请求必 503）；「算不出来」不走这里，
   * 由 IPC 层报 `{ok:false}`，界面保持「没有数」而不是渲染成一个假的 0。
   */
  routePoolSizes(routes: readonly ModelRoute[]): Record<string, number> {
    const pool = this.advertisedPool()
    const table = storeManager.getConfig().routes
    const sizes: Record<string, number> = {}
    for (const route of routes) {
      if (sizes[route.name] !== undefined) continue
      // 池来源断掉的路由**不给数字**（不是给 0，也不是给它自己那份没人执行的策略）：
      // 界面那一栏读的是「这条路由能跑多大池」，答不了就该留空。
      const resolution = resolvePoolRoute(table, route)
      if (!resolution.ok) continue
      const namesByProvider = new Map<string, Set<string>>()
      for (const candidate of this.keptOfPool(pool, resolution.route)) {
        const names = namesByProvider.get(candidate.providerId) ?? new Set<string>()
        namesByProvider.set(candidate.providerId, names)
        names.add(candidate.displayName.trim().toLowerCase())
      }
      let total = 0
      for (const names of namesByProvider.values()) total += names.size
      sizes[route.name] = total
    }
    return sizes
  }

  /**
   * 采集本次请求的全部 (账号, 模型) 候选，并完成与请求无关的前置剔除
   * （渠道工具上限、账号当日上限、额度账本打满、通配符名）。
   *
   * `select` 与 `preview` 必须共用这一份，否则预览会显示一批实际路由拿不到的
   * 模型，用户照着修配置反而越修越错。
   */
  private collectCandidates(request: ChatCompletionRequest, now: number, options: {
    /**
     * 广告口径用：`true` 时不扣「当日用量打满」与「额度已耗尽」这两类**瞬时**剔除。
     *
     * `/v1/models` 的 `context_window` 是客户端安排压缩时机的依据，一个会随每次请求
     * 缩小的数比一个保守的数更糟；请求决策仍然照扣（默认 `false`）。
     */
    ignoreTransientAvailability?: boolean
    /**
     * 展示口径（`preview` 用）：把「因瞬时状态被剔除」的候选**另册**记下来
     * （`blockedCandidates` + `blockedByKey`），而不是直接丢掉。
     *
     * 这是推荐队列的唯一入口：被额度/限流挡下的模型必须**留在列表里**（带原因与
     * 解禁时刻），而不是消失 —— 消失正是「池子里还有 51 个模型，头部打满后一次都
     * 没被派过，界面却看不出原因」的来源。
     *
     * ⚠️ 它们**不进 `rankInputs`**，任何策略/排序都碰不到：进了排序就等于拿一次
     * 上游 429 去撞墙。`select` 永远走默认（`false`）。
     */
    collectBlocked?: boolean
  } = {}): {
    rankInputs: PoolStrategyCandidate[]
    candidatesByKey: Map<string, AutoCandidate>
    skipped: Set<string>
    /** 因瞬时状态被剔除的候选（`skipped` 的字符串形态里分不出「等一会儿会回来」）。 */
    transientSkips: TransientSkip[]
    /** `collectBlocked` 时：被挡下的候选（一个账号一条），展示层据此数账号数与读数。 */
    blockedCandidates: PoolStrategyCandidate[]
    /** `collectBlocked` 时：模型键（见 `modelRowKey`）→ 这一轮挡它的原因。 */
    blockedByKey: Map<string, RouteModelBlock>
  } {
    const providers = storeManager.getProviders().filter(provider => provider.enabled)
    const needs = contractNeeds(request)
    const marks = storeManager.getUserModelMarks()
    const adoptions = storeManager.getCatalogAdoptions()
    // 探测读数与上面两张表同一个口径：每决策从内存快照建一次索引，逐候选只查表。
    // sidecar 本身是异步 JSON，热路径里 await 读盘会重演 1.6.1 那次选号卡顿。
    const probeIndex = indexProbeRows(getProbeRowsSync())
    const rankInputs: PoolStrategyCandidate[] = []
    const candidatesByKey = new Map<string, AutoCandidate>()
    // 前置剔除的候选及原因（Set 去重：同一模型多账号命中同一原因只记一条）
    const skipped = new Set<string>()
    // 同一批剔除里「等一会儿会回来」的那些：空池时据此把 503 翻成可重试的 429
    const transientSkips: TransientSkip[] = []
    // 展示口径的阻塞记录：只有 `collectBlocked` 才会写，`select` 路径恒为空表。
    const blockedCandidates: PoolStrategyCandidate[] = []
    const blockedByKey = new Map<string, RouteModelBlock>()
    // Bandit 实时战绩（PLAN P2-5 第一步）：从请求日志内存副本滚动 24h 聚合。
    // 每请求一次、单遍 O(n)，n 受 requestLogs.maxEntries 上限约束。
    const bandit = aggregateBanditStats(storeManager.getRequestLogs(), now)
    // 份额轮转的读数（`dispatchLedger`）：每请求一次全表快照，逐候选只是查表。
    const dispatches = dispatchLedger.snapshot(now)
    // 闸门读取只做一次：加密 store 每次 `get` 都要整份解密，逐候选问会把
    // 一次选号放大成几百次同步 I/O（见 `quota/gate.ts` 的上下文注释）。
    const gateContext = createQuotaGateContext()

    for (const provider of providers) {
      const accounts = storeManager
        .getAccountsByProviderId(provider.id, true)
        .filter(account => account.status === 'active')

      if (accounts.length === 0) {
        continue
      }

      // 渠道能力前置过滤（PLAN P1-4，与 maxTools 同一循环）：请求带工具而渠道
      // 声明不支持原生工具调用时整个渠道不进候选。fail-open：缺省（undefined）
      // = 不限；盘点结论（2026-10-30）：12 个渠道适配器都原生支持工具调用
      // （vendor 里唯一的 delete body.tools 是 tool_choice:'none' 归一化），
      // 所以目录里暂时没有渠道需要标 false。
      const toolCount = Array.isArray(request.tools) ? request.tools.length : 0
      const channelDefinition = provider.type === 'account'
        ? getChannelDefinition(provider.id)
        : undefined
      const channelMaxTools = channelDefinition?.maxTools
      if (channelMaxTools !== undefined && toolCount > channelMaxTools) {
        skipped.add(`${provider.id}:tools_limit`)
        continue
      }
      if (channelDefinition?.capabilities?.tools === false && toolCount > 0) {
        skipped.add(`${provider.id}:tools_unsupported`)
        continue
      }

      const contractCapable = providerMeetsContract(provider.type, needs)

      for (const model of storeManager.getEffectiveModels(provider.id)) {
        // 通配符模型名不能作为上游真实模型使用
        if (model.displayName.endsWith('*')) {
          continue
        }

        // 渠道 pack 明确不服务的模型不进候选池（2026-11-13 `codex-deepseek` 实测）。
        //
        // 宿主的可路由名单来自 `listAllModels()`（静态兜底表，不套身份档），而 worker
        // 的请求前闸门读的是**分档后**的 `listModels(provider)`。越过这道闸门的模型
        // 以前只在 `chat.ts` 的异步预检里被剔 —— 那道预检跑在**单模型裁剪之后**，
        // 头部模型被剔光就是整轮零候选：40 秒内 11 笔 `no_available_model`，而池子里
        // 其实还有别家能跑。预检必须在裁剪之前生效，头部才有可能落到下一个模型。
        //
        // 判据只读缓存且 fail-open（`null` = 清单未知 ⇒ 放行）；预热发生时它可能还
        // 是未知的，此时行为与旧版完全一致，`chat.ts` 的异步预检继续兜住那一笔。
        if (provider.type === 'account'
          && accountChannelManager.packServesModelNow(provider.id, model.actualModelId) === false) {
          skipped.add(`${provider.id}/${model.displayName}:pack_not_serving`)
          continue
        }

        // 渠道 worker 亲口报的模型级限流（读数镜像在 `accountChannelManager`）。
        //
        // 这条状态原本只有 `chat.ts` 的请求前预检能看到，而预检跑在**作用域裁剪之后**：
        // `single` 已把整轮收成一个模型，剔掉它就是零候选。2026-11-14 `daily` 实测
        // 27 笔 `503 no_available_model` —— 头部 `OpenCode / Big Pickle` 的免费日额度
        // 在 00:00 UTC 前打满，池子里另外 51 个模型一次都没被派过。选路阶段读这条状态，
        // 头部才能落到下一个模型；`until` 让空池投影能算准 `Retry-After`。
        // 这是**模型级**读数：它一个模型一个原因，逐账号重复只是为了让空池投影能
        // 按（账号, 模型）统计条数。展示口径下不整模型出局，而是把它当下面每个账号
        // 的初始原因 —— 「这个模型到 X 点前别碰」正是队列要说的那句话。
        let modelBlock: RouteModelBlock | undefined
        if (!options.ignoreTransientAvailability) {
          const rateLimitedUntil = accountChannelManager.modelRateLimitResetAt(
            provider.id,
            model.actualModelId,
            now
          )
          if (rateLimitedUntil !== undefined) {
            skipped.add(`${provider.id}/${model.displayName}:rate_limited`)
            modelBlock = { reason: 'rate_limited', until: rateLimitedUntil, untilSource: 'upstream' }
            for (const account of accounts) {
              transientSkips.push({
                providerId: provider.id,
                accountId: account.id,
                model: model.actualModelId,
                displayName: model.displayName,
                reason: 'rate_limited',
                until: rateLimitedUntil,
              })
            }
            if (!options.collectBlocked) continue
          }
        }

        // 上游目录已经明确「没有这个模型」：冷却期内不再送进候选池，省掉
        // 每笔请求 0.1–3.5s 的必败往返。广告口径不扣（`ignoreTransientAvailability`），
        // 与配额门控同一层语义。
        if (!options.ignoreTransientAvailability
          && isCatalogMissCoolingDown(provider.id, model.actualModelId, now)) {
          skipped.add(`${provider.id}/${model.displayName}:catalog_miss`)
          continue
        }

        for (const account of accounts) {
          // 这一轮挡下这个 (账号, 模型) 的原因；`undefined` = 可以派。
          let block = modelBlock
          if (!options.ignoreTransientAvailability) {
            if (account.dailyLimit && dailyUsageOf(account, now) >= account.dailyLimit) {
              skipped.add(`${provider.id}/${model.displayName}:daily_limit`)
              transientSkips.push({
                providerId: provider.id,
                accountId: account.id,
                model: model.actualModelId,
                displayName: model.displayName,
                reason: 'daily_limit',
              })
              // 当日上限按**本地**午夜复位：这是我们自己的记账规则，不是上游说的时刻。
              block = preferBlock(block, {
                reason: 'daily_limit',
                until: nextLocalMidnight(now),
                untilSource: 'local',
              })
              if (!options.collectBlocked) continue
            } else {
              // 额度已打满的候选根本不进排序，失败切换才不会浪费一次上游请求
              const quotaBlocked = quotaBlockDetail(provider, account.id, model.actualModelId, gateContext, now)
              if (quotaBlocked !== undefined) {
                skipped.add(`${provider.id}/${model.displayName}:${quotaBlocked.reason}`)
                transientSkips.push({
                  providerId: provider.id,
                  accountId: account.id,
                  model: model.actualModelId,
                  displayName: model.displayName,
                  reason: quotaBlocked.reason,
                })
                block = preferBlock(block, quotaBlocked)
                if (!options.collectBlocked) continue
              }
            }
          }

          // 带上这个候选的真实模型名：429 限流档按 (账号, 模型) 记，只查账号会漏掉
          // 「账号健康、但这个模型正在限流里」的那一档
          const runtime = accountRuntime.snapshot(account.id, now, model.actualModelId)
          const key = candidateKey(provider.id, account.id, model.displayName)
          const hints = capabilityHintsFor(
            provider,
            model.displayName,
            model.actualModelId,
            marks,
            adoptions,
            probeIndex,
            now
          )
          // 配额余量（PLAN P1-3）：只对聚合目录候选计算 —— 账号渠道的帽在渠道
          // worker 内部，本地账本没有官方帽可对照，硬算只是噪声。函数自带
          // fail-open（读不到给 0.5 中性）。
          const quotaHeadroom = provider.type === 'aggregate'
            ? aggregateHeadroom(provider.id, model.actualModelId, gateContext)
            : undefined
          // Bandit 战绩（PLAN P2-5）：查不到 = 冷启动，不携带（乐观先验）。
          const live = bandit.get(banditKeyOf(provider.id, model.actualModelId))
          // 成本档与聚合原始分类一次算出：bucket 进打分，costClass 留给策略筛选
          // 区分「套餐内」与「完全免费」。成本读手工/记录/第三方合并后的标注，
          // 手工把某模型改成免费后，打分与 `free-only` 策略同时跟上。
          const costSignal = costSignalFor(
            provider,
            model.actualModelId,
            mergedHintOf({ manualHint: hints.manual, capabilityHint: hints.record, thirdPartyHint: hints.thirdParty }),
            now
          )
          const candidate: PoolStrategyCandidate = {
            providerId: provider.id,
            providerName: provider.name,
            displayName: model.displayName,
            actualModelId: model.actualModelId,
            accountId: account.id,
            providerType: provider.type,
            todayUsed: dailyUsageOf(account, now),
            dailyLimit: account.dailyLimit,
            lastUsed: account.lastUsed,
            inFlight: runtime.inFlight,
            ...(runtime.modelInFlight === undefined ? {} : { modelInFlight: runtime.modelInFlight }),
            ...(runtime.modelLimit === undefined ? {} : { modelLimit: runtime.modelLimit }),
            ...(runtime.ewmaFirstTokenMs === undefined ? {} : { ewmaFirstTokenMs: runtime.ewmaFirstTokenMs }),
            ...(runtime.rateLimitedRate === undefined ? {} : { rateLimitedRate: runtime.rateLimitedRate }),
            ...(runtime.timeoutRate === undefined ? {} : { timeoutRate: runtime.timeoutRate }),
            ...(runtime.degradedRate === undefined ? {} : { degradedRate: runtime.degradedRate }),
            rpmUsed: runtime.rpmUsed,
            coolingUntil: runtime.coolingUntil,
            ...(hints.record === undefined ? {} : { capabilityHint: hints.record }),
            ...(hints.manual === undefined ? {} : { manualHint: hints.manual }),
            ...(hints.official === undefined ? {} : { officialHint: hints.official }),
            ...(hints.catalog === undefined ? {} : { catalogHint: hints.catalog }),
            ...(hints.probe === undefined ? {} : { probeHint: hints.probe }),
            ...(hints.thirdParty === undefined ? {} : { thirdPartyHint: hints.thirdParty }),
            contractCapable,
            costBucket: costSignal.bucket,
            ...(costSignal.costClass === undefined ? {} : { costClass: costSignal.costClass }),
            ...(costSignal.weight === undefined ? {} : { weight: costSignal.weight }),
            ...(quotaHeadroom === undefined ? {} : { quotaHeadroom }),
            ...(live === undefined ? {} : { live }),
            dispatchCount: dispatches.counts.get(dispatchKeyOf(provider.id, model.actualModelId)) ?? 0,
          }
          if (block === undefined) {
            rankInputs.push(candidate)
          } else {
            // 展示口径：这个候选留在另册，绝不进排序（见 `collectBlocked` 的注释）。
            blockedCandidates.push(candidate)
            const rowKey = modelRowKey(provider.id, model.displayName)
            blockedByKey.set(rowKey, preferBlock(blockedByKey.get(rowKey), block))
          }
          candidatesByKey.set(key, {
            account,
            provider,
            displayName: model.displayName,
            actualModel: model.actualModelId,
          })
        }
      }
    }

    return { rankInputs, candidatesByKey, skipped, transientSkips, blockedCandidates, blockedByKey }
  }

  /**
   * 一条请求的会话键，与 `select()` 内部同一个口径。
   *
   * 具名模型（不走路由）的请求没有 `AutoRouteDecision`，但缓存缺口分类仍要按会话
   * 串起上一轮 —— 口径分叉会让同一段对话在读数里变成两段。
   */
  conversationKeyFor(request: ChatCompletionRequest, sessionKey?: ClientSessionKey): string | undefined {
    return sessionKey !== undefined
      ? `session:${hashString(sessionKey.value)}`
      : conversationKey(request)
  }

  /**
   * 为本次请求选出有序候选列表；空数组表示没有可用目标
   *
   * `route` 是这次生效的路由（`AppConfig.routes` 里的一条）。可路由的每一项
   * —— 打分口径 `strategy`、优化目标 `prefer`、基础上限 `maxAttempts`、
   * 粘性时长 `stickyMinutes`、池策略 `poolStrategies` —— 都优先取它的值，
   * 没传时才回退 legacy 全局 `config.autoRouting`（在途调用与既有单测的口径）。
   * `preferOverride` 仍然高于两者：请求头 `X-Auto-Prefer` 是客户端的显式意图。
   */
  select(
    request: ChatCompletionRequest,
    strategy: AutoRoutingStrategy = 'round-robin',
    preferOverride?: AutoPreference,
    route?: ModelRoute,
    /**
     * 入向协议读到的客户端会话标识（`shared/clientSessionKey.ts`）。给了它就用它当
     * 粘性键 —— agent 客户端自动摘要会改写首条用户消息，内容指纹随之改变，于是同一段
     * 会话中途被派到别家（`conversationKey` 的口径见 `autoRouting.ts`）。
     */
    sessionKey?: ClientSessionKey,
    /**
     * 客户端本轮点名的模型（`X-ModelPort-Model`）。给定时写成**会话级**持久钉再照常
     * 选路 —— 会话键只有这一处算得出来，调用方各自拼一份就会两个键对不上。
     */
    headerModel?: { displayName: string },
    /**
     * 请求前预检（渠道 worker 限流 / pack 服务清单）刚剔掉的模型：剔空之后要
     * **带排除集重选**，否则 `single` 已经裁到的那一个模型就是整轮天花板。
     * 只在这一次调用里生效，不写任何冷却、也不改变配置。
     */
    excludeModels?: readonly { providerId: string; displayName: string }[],
  ): AutoRouteDecision {
    const profile = profileRequest(request)
    const now = Date.now()

    const routeName = route?.name ?? LEGACY_ROUTE_NAME
    // 路由名优先于位置参数：`select(request, config.loadBalanceStrategy, …, route)`
    // 里的第二个参数是「没配路由时的全局口径」，一条明确配了 strategy 的路由
    // 不该被它盖掉。两个联合是同五个字面量，所以这里不需要转换。
    const effectiveStrategy = route?.strategy ?? strategy
    const autoConfig = storeManager.getConfig().autoRouting
    const maxAttempts = route?.maxAttempts ?? autoConfig?.maxAttempts ?? AUTO_MAX_ATTEMPTS
    const stickyMinutes = route?.stickyMinutes ?? autoConfig?.stickyMinutes ?? 0
    const prefer = preferOverride ?? route?.prefer ?? autoConfig?.prefer ?? 'balanced'
    // 钉是最高优先级：本轮点名的模型先落成会话级持久钉（同一段会话的后续轮次沿用）。
    // 会话键缺失时退回路由级：没有会话标识就无法收窄作用域，而「按本轮这一下」没有
    // 第三种表达。这里提前到排序之前算好键，好让候选池在排序前就收窄到被钉的模型。
    const stickyKeySource: 'client-session' | 'content-hash' =
      sessionKey === undefined ? 'content-hash' : 'client-session'
    const key = this.conversationKeyFor(request, sessionKey)
    if (headerModel !== undefined && headerModel.displayName.trim().length > 0) {
      this.setPin({
        route: routeName,
        displayName: headerModel.displayName,
        scope: key === undefined ? 'route' : 'session',
        ...(key === undefined ? {} : { sessionKey: key }),
        source: 'header',
      }, now)
    }
    const earlyMemoryPin = this.pinFor(routeName, key)
    const earlyPinRef: { providerId?: string; displayName: string } | undefined =
      earlyMemoryPin !== undefined
        ? {
            ...(earlyMemoryPin.providerId === undefined ? {} : { providerId: earlyMemoryPin.providerId }),
            displayName: earlyMemoryPin.displayName,
          }
        : route?.preferredModel
    // 排序前把候选池收窄到被钉的模型：钉是独占（裁定 2026-11-15），这一轮只可能服务
    // 它。收窄之后 `rankCandidates` 的「全空放宽 context」兜底才会落到它头上 ——
    // 长会话的裁剪前估算超过它的窗口时，池里只剩它，于是放宽 context 保留它，再由
    // 转发器的裁剪收敛到窗口内。不收窄时池里还有别的模型，兜底不触发，被钉的模型被
    // context 硬过滤摘掉，最终静默服务了别的模型。名字不在池里时这里收出空池，下方
    // 的 pinStale/pinBlocked/pinTransient 仍按整池归因，行为不变。
    const pinScopeFilter = <T extends { displayName: string; providerId?: string }>(inputs: T[]): T[] =>
      earlyPinRef === undefined
        ? inputs
        : inputs.filter(input =>
            input.displayName === earlyPinRef.displayName
            && (earlyPinRef.providerId === undefined || input.providerId === earlyPinRef.providerId))

    const { rankInputs: collectedInputs, candidatesByKey, skipped, transientSkips } = this.collectCandidates(request, now)
    // 预检排除集：只摘这一轮的候选，不进 `skipped`（预检已经把原因写进调用方那份
    // 决策的 skipped 并会并回来，这里再写一次就成了两条同义记录）。
    const excludedKeys = new Set(
      (excludeModels ?? []).map(entry => `${entry.providerId}::${entry.displayName}`)
    )
    const rankInputs = excludedKeys.size === 0
      ? collectedInputs
      : collectedInputs.filter(input => !excludedKeys.has(`${input.providerId}::${input.displayName}`))
    const rankPool = pinScopeFilter(rankInputs)
    const needs = contractNeeds(request)

    // 策略筛选（静态、用户预设）：在候选池构建处、契约过滤之前生效。
    // 策略针对模型而非账号——同一模型的多账号候选一起过滤。空数组 = 不过滤，
    // 候选池与未配置策略时完全一致。过滤后为空则走下方契约/排序兜底（空池
    // 时 explainMissing 自然返回空，不误报缺能力）。
    const poolStrategies = route?.poolStrategies ?? autoConfig?.poolStrategies ?? []
    // 名字钉定：基底先收到被点名的模型，`includeModels` 也只能在这个基底里取回 ——
    // 否则一条钉死的路由会被一次手动增删绕开。能力下限紧跟着收一遍（见 `applyMinTier`）：
    // 它是路线级的声明，手动增删也拿不回低于下限的模型。
    const pinnedRankInputs = applyModelNamePin(rankPool, route?.pinModels)
    const tierInputs = applyMinTier(pinnedRankInputs, route?.minTier)
    // 写入型请求的档位托底：紧接 `minTier`，所以 `includeModels` 也拿不回被托底
    // 筛掉的低档模型。抬空了就回落并记降级（`write_tool_tier`），不因为「这轮是
    // 写入」把路由打成 503。广告窗口（`keptOfPool`）**有意**不跟着抬：那是这条路由
    // 通常能用什么，不是这一轮用了什么。
    const writeTier = applyRequestTierFloor(
      tierInputs,
      requestWriteToolFloor(route?.writeToolTier, request)
    )
    const strategyInputs = writeTier.inputs
    const strategyOutcome = applyPoolStrategiesWithTrace(strategyInputs, poolStrategies)

    // 手动增删：策略之后、契约过滤之前。exclude 赢过 include，include 只能从
    // 策略前就有资格的候选里取回模型 —— 不会复活停用的模型，也不会绕过下面
    // 的契约过滤与排序阶段的硬过滤。
    const manual = applyManualModelSelection(
      strategyOutcome.kept,
      strategyInputs,
      route?.includeModels ?? [],
      route?.excludeModels ?? []
    )
    const pool = manual.kept

    // 契约过滤：有能满足的候选就只在它们里面挑；全都不满足时
    // `n > 1` 直接交给调用方报 400（内置供应商本来就这样拒绝），
    // `response_format` 则照常路由并标记降级——返回自由文本比拒绝可用。
    const contract = applyContractFilter(pool, needs)
    const contractPool = contract.pool
    // 写入型托底没能兑现（池里没有够档的模型）同样是一条降级，与 `response_format`
    // 并列透出 —— 客户端至少能从响应头看到「这轮写入没拿到 balanced」。
    const degraded = writeTier.relaxed
      ? [...contract.degraded, 'write_tool_tier']
      : contract.degraded
    const missing: string[] = contract.missing

    // 空池要能区分「供应商没候选」和「配置把候选筛光了」：后两者指向用户
    // 自己刚改的设置，归成前者会让人白查供应商。钉收窄（earlyPinRef 命中）造成的
    // 空池不归这里 —— 它由下方的 pinStale 说明，写成 manual_filter 会盖掉那颗钉。
    if (pool.length === 0 && missing.length === 0 && rankInputs.length > 0 && earlyPinRef === undefined) {
      missing.push(
        // 能力下限把整个基底筛空：这是这条路由自己的设置（`minTier`），不是用户的
        // 池策略写错了 —— 报成 `pool_strategy` 会让人去翻那 17 个策略找一个不存在的错。
        tierInputs.length === 0 && pinnedRankInputs.length > 0 && route?.minTier !== undefined
          ? 'min_tier'
          : strategyOutcome.kept.length === 0 ? 'pool_strategy' : 'manual_filter'
      )
    }

    const seed = this.seed++
    // 粘性键优先用客户端给的会话标识（键已在排序前算好）：agent 客户端自动摘要会改写
    // 首条用户消息，内容指纹随之改变，同一段会话就会被派到别家。没有标识时逐字沿用
    // 内容指纹（老行为）。
    const stickyKey = key ? stickyMapKey(routeName, key) : ''
    let sticky: StickyHint | undefined
    if (stickyKey && stickyMinutes > 0) {
      const previous = this.sticky.get(stickyKey)
      if (previous && previous.expiresAt > now) {
        sticky = previous.hint
      } else if (previous) {
        this.sticky.delete(stickyKey)
      }
    }

    // Cache affinity is a second, longer-lived hint. It only exists for
    // providers whose cache capability is known, and it is written only after a
    // successful request, so it cannot pin a conversation to a guess.
    const cacheAffinityMinutes = autoConfig?.cacheAffinityMinutes ?? 0
    let cacheHint: StickyHint | undefined
    if (stickyKey && cacheAffinityMinutes > 0) {
      this.ensureCacheAffinityLoaded()
      const previous = this.cacheAffinity.get(stickyKey)
      if (previous && previous.expiresAt > now) {
        cacheHint = previous.hint
      } else if (previous) {
        this.cacheAffinity.delete(stickyKey)
      }
    }
    // Cache affinity wins over the shorter routing stickiness: it exists only
    // for providers whose cache we can actually read, and it is written only on
    // success, so it cannot invent a hint the sticky map did not have.
    if (cacheHint !== undefined) sticky = cacheHint

    // 候选链不再预裁：整条排序结果交给换家循环，真正的上限在它那一侧
    // （账号故障类撞满 `baseCap`、墙钟 `AUTO_WALL_CLOCK_BUDGET_MS`）。以前这里是
    // `maxAttempts + AUTO_RECOVERABLE_EXTRA_ATTEMPTS` 家，等于在选号阶段就把池子
    // 砍到 6 家 —— 与「供应商只做配额/积分筛选，打分基于全池展开」直接冲突。
    const ranked = rankCandidates(profile, contractPool, {
      now,
      limit: contractPool.length,
      seed,
      strategy: effectiveStrategy,
      prefer,
      sticky,
      // 份额轮转：分数决定的是轮转次序，不再是「谁能一直代表这家被派出」。
      // `fairnessLead` 缺省 1（每个模型连发 2 次再换），0 = 严格轮流，取大 = 接近纯分数。
      fairness: { lead: route?.fairnessLead ?? DEFAULT_FAIRNESS_LEAD },
    })

    // 候选池非空却排不出结果时，说明缺的是某种能力，而不是没有供应商。钉收窄后
    // 排空时不按整池报缺能力 —— 那是钉自己的事，由 pinBlocked/pinStale 说明。
    if (ranked.length === 0 && missing.length === 0 && earlyPinRef === undefined) {
      missing.push(...explainMissing(profile, contractPool))
    }

    // 会话粘性在路由层是**硬优先**（`stickyHardPin`，缺省即开）：打分里的 0.12 只是
    // 「同分时的倾向」，盖不过免费/档位/成本差；实测 Codex 同一段对话 21 次请求在 7 个
    // 模型之间跳，最后被 Spark-X2.6 接成「继续上一轮」。agent 会话换模型比慢一点更
    // 伤：上下文理解、工具协议、缓存全部重来。这里把上一轮成功的模型提到队首；它若
    // 停服/冷却，候选池里自然没有它，仍然自动让位。
    // 关掉这一格就退回路由 v2 计划 §1.4 的纯加分语义：首位由打分决定，粘性只提供
    // +0.12 / +0.06，差距过大时会让位给更合适的候选。
    //
    // 第 2 条（2026-11-12）：硬粘性也不是无条件的 —— 被提前的那个候选慢于池内
    // 首字延迟 p75 时不让位，退回同一套加分语义。判据与流结束撤销锚点共用
    // `latencyGateMs` 这一格，避免「选路觉得它慢、收尾觉得它不慢」两头不一致。
    const modelScope: ModelScope = route?.modelScope ?? 'single'
    // 钉已在排序前落定并收窄了候选池（见 earlyPinRef / pinScopeFilter），这里直接沿用。
    const memoryPin = earlyMemoryPin
    const pinRef = earlyPinRef
    // 日志/菜单读的「生效中的选择」：请求头钉优先，否则是路由配置里的持久钉
    // （`preferredModel`）。两者都是持久硬钉（`until: 0`，裁定 2026-11-15）。
    const effectivePin: ModelPin | undefined = memoryPin ?? (pinRef === undefined
      ? undefined
      : {
          route: routeName,
          displayName: pinRef.displayName,
          ...(pinRef.providerId === undefined ? {} : { providerId: pinRef.providerId }),
          scope: 'route' as const,
          until: 0,
          source: 'console' as const,
        })

    // 延迟门在**作用域内**算：单模型路由里「池内 p75」就是它自己几个账号的 p75。
    // 拿全池（几十个模型）的分布判它慢不慢，等于用一个它不参与的竞赛决定它该不该上台。
    const gatePool = pinRef === undefined
      ? modelScope === 'single' && ranked.length > 0
        ? ranked.filter(input => input.displayName === ranked[0]!.displayName)
        : ranked
      : ranked.filter(input =>
          input.displayName === pinRef.displayName
          && (pinRef.providerId === undefined || input.providerId === pinRef.providerId)
        )
    const latencyGateMs = poolLatencyGateMs(gatePool.length > 0 ? gatePool : ranked)
    const stickyGated = route?.stickyHardPin !== false
      && stickyLatencyExceeded(ranked, sticky, latencyGateMs)
    const stickyOrdered = route?.stickyHardPin === false || stickyGated
      ? ranked
      : promoteSticky(ranked, sticky)

    // 钉优先于粘性（用户意图高于历史惯性），失配不静默：钉住的模型不在池里时
    // `pinMiss` 要进日志与响应头 —— 否则托盘显示的选择与实际行为会长期不一致而无处可查。
    const pinnedOrder = pinRef === undefined
      ? { list: stickyOrdered, hit: false }
      : promotePinned(stickyOrdered, pinRef)
    const pinMiss = pinRef !== undefined && !pinnedOrder.hit ? pinRef.displayName : undefined
    // 钉的处置按「排序前的池」归因（裁定 2026-11-15），不是「这一轮排不排得出来」：
    // 收窄后池里只剩被钉的模型，它若全在冷却，`rankCandidates` 的全空兜底仍会把它
    // 排出来（hit=true），但那是「冷却中」而不是「可派」。所以 `pinMatches` 不依赖
    // `pinMiss`，直接取收窄池里被钉的候选 —— 冷却/瞬时/能力缺口都从它身上读。
    const pinMatches = pinRef === undefined
      ? []
      : rankPool.filter(input =>
          input.displayName === pinRef.displayName
          && (pinRef.providerId === undefined || input.providerId === pinRef.providerId))
    // 裁定 2026-11-15：钉是硬闸，不分软/持久 —— 会话级钉与路由级 `preferredModel`
    // 同一套处置。「这一轮用不了」分四种，全部**拒答保钉**，绝不回落普通顺序：
    // 全在退避 → 429 可重试（`pinCooling`）；全被瞬时状态挡下 → 429 可重试
    // （`pinTransient`）；请求级不满足 → 503（`pinBlocked`）；名字不在排序前池里
    // 且不是瞬时剔除 → 503 `pin_stale`（`pinStale.action:'held'`）。都不清钉，
    // 只有用户手动替换 / 手动解除能改。
    const pinScope: ModelPinScope = effectivePin?.scope ?? 'route'
    const pinSource: ModelPinSource = effectivePin?.source ?? 'console'
    const pinCooling: AutoRouteDecision['pinCooling'] = (() => {
      if (pinRef === undefined || pinMatches.length === 0) return undefined
      const cooling = pinMatches.filter(input =>
        input.coolingUntil !== undefined && input.coolingUntil > now)
      if (cooling.length !== pinMatches.length) return undefined
      const until = Math.min(...cooling.map(input => input.coolingUntil as number))
      return {
        displayName: pinRef.displayName,
        scope: pinScope,
        source: pinSource,
        retryAfterSeconds: capClientRetryAfterSeconds((until - now) / 1000),
      }
    })()
    const pinTransient: AutoRouteDecision['pinTransient'] = (() => {
      if (pinMiss === undefined || pinMatches.length > 0) return undefined
      // 限流窗口/额度耗尽/当日上限这三种剔除在 `rankInputs.push` 之前就 continue，
      // 钉名必然失配 —— 但模型仍在路由里，窗口复位就回来。按钉名归因到它自己的
      // 剔除记录（不是整池的），算它自己的最早解禁时刻。
      const summary = summarizeTransientSkips(
        transientSkips.filter(skip =>
          skip.displayName === pinMiss
          && (pinRef?.providerId === undefined || skip.providerId === pinRef.providerId)),
        now,
      )
      if (summary === undefined) return undefined
      return {
        displayName: pinMiss,
        scope: pinScope,
        source: pinSource,
        cause: summary.cause,
        retryAfterSeconds: summary.retryAfterSeconds,
      }
    })()
    const pinBlocked: AutoRouteDecision['pinBlocked'] = (() => {
      if (pinRef === undefined || pinMatches.length === 0) return undefined
      if (pinCooling !== undefined) return undefined
      const reasons: ModelHardRequirement[] = []
      for (const input of pinMatches) {
        const failure = hardFilterFailure(profile, capabilityOfCandidate(input))
        if (failure !== undefined && !reasons.includes(failure)) reasons.push(failure)
      }
      // 上下文超限不拦钉：选路的硬过滤用**裁剪前**的请求估算，长会话（历史超过钉的
      // 窗口）会在这里被永久判死；而网关本来就会把历史裁到该模型的窗口再发。与
      // `rankCandidates` 的「全空放宽 context」同一条兜底纪律：只剩 context 时放行，
      // 让转发器的裁剪去收敛。vision/tools/reasoning 仍拦 —— 裁历史救不了它们。
      const blocking = reasons.filter(reason => reason !== 'context')
      // 没有真实缺口就不拦（context 已被上面豁免）：返回一个空 missing 的 pinBlocked
      // 也会让作用域裁剪清空整池，等于换个写法继续判死。
      if (blocking.length === 0) return undefined
      // 契约过滤（`n` / `response_format`）不是能力名，`reasons` 为空也照样拦：
      // 客户端至少要知道「是这颗钉挡住了这一轮」。
      return { displayName: pinRef.displayName, scope: pinScope, source: pinSource, missing: blocking }
    })()
    // 收窄后「全空兜底」会把冷却/超窗的钉也排出来（hit=true），但那不是「可派」。
    // 只要冷却/瞬时/能力任一处置成立，这一轮就是失配：如实写 pinMiss，界面与日志
    // 据此知道为什么拒绝，而不是看着 hit=true 以为派了。
    const pinUnavailable = pinCooling !== undefined || pinTransient !== undefined || pinBlocked !== undefined
    const effectivePinMiss = pinMiss ?? (pinUnavailable ? pinRef?.displayName : undefined)
    const pinStale: AutoRouteDecision['pinStale'] = effectivePinMiss === undefined
      || pinMatches.length > 0
      || pinTransient !== undefined
      ? undefined
      : { displayName: effectivePinMiss, scope: pinScope, source: pinSource, action: 'held' }
    // 裁剪前的模型数（同一模型的多个账号算一个）：`reason: 'only'` 的判据。
    const poolModelCount = new Set(pinnedOrder.list.map(input => input.displayName)).size

    // 模型级熔断：退化过的模型排到队尾（不是删掉）。全池都在熔断时这张票不生效
    // —— 没有落脚点的跳过等于把这一轮变成空池。
    //
    // 显式选择（持久 `preferredModel` / 请求头钉）优先于熔断：用户钉了某个模型，就按
    // 那个模型跑 —— 熔断是「没人选时自动让位」，不是对用户选择的否决权。熔断中的
    // 模型在菜单里带「熔断中」标记，用户看得见。
    this.sweepCircuits(now)
    const modelOrder: string[] = []
    for (const input of pinnedOrder.list) {
      if (!modelOrder.includes(input.displayName)) modelOrder.push(input.displayName)
    }
    const circuitHit = pinRef === undefined
      ? modelOrder.filter(name => this.modelCircuitUntil(routeName, name, now) !== undefined)
      : []
    const circuited = circuitHit.length >= modelOrder.length ? [] : circuitHit
    const circuitOrdered = circuited.length === 0
      ? pinnedOrder.list
      : [
          ...pinnedOrder.list.filter(input => !circuited.includes(input.displayName)),
          ...pinnedOrder.list.filter(input => circuited.includes(input.displayName)),
        ]

    // 作用域裁剪：没有钉时才按路由算法走（`single` 一个模型 / `family` 同名家族 /
    // `pool` 全池换家）。有钉时钉就是独占（裁定 2026-11-15）：这一轮只派被钉的
    // 那个模型，`pool` 的跨模型换家也关掉 —— 路由算法只在没有固定模型时生效。
    const scoped = (() => {
      // 钉是硬闸：钉住的模型这一轮用不了（不在池/全冷却/全被瞬时状态挡下/能力缺）
      // 就直接收在选号阶段，不派任何候选 = 不产生上游调用，客户端毫秒级拿到
      // 429/503 与原因，而不是先跑满预算再换一个模型答上来。四种都不清钉。
      if (pinStale !== undefined || pinCooling !== undefined
        || pinBlocked !== undefined || pinTransient !== undefined) {
        return []
      }
      if (pinRef !== undefined && effectivePinMiss === undefined) {
        return circuitOrdered.filter(input =>
          input.displayName === pinRef.displayName
          && (pinRef.providerId === undefined || input.providerId === pinRef.providerId))
      }
      if (modelScope === 'pool' || circuitOrdered.length === 0) return circuitOrdered
      const head = circuitOrdered[0]!.displayName
      if (modelScope === 'single') return circuitOrdered.filter(input => input.displayName === head)
      const family = modelFamilyKey(head)
      return circuitOrdered.filter(input => modelFamilyKey(input.displayName) === family)
    })()

    // 池内顺序（2026-11-12 策略改：池，不是泳道）。
    //
    // 同模型必须聚在一起：同模型的多个账号是同一份实现，换账号不改变客户端的上下文
    // 与工具协议；顺序若按分数交错（甲家账号A、乙模型、甲家账号B），第一个账号失败就会
    // 先撞到一个完全不同的模型。这里是**稳定分区**，两侧各自保持原打分顺序。
    //
    // 分区只是**顺序**，不是栅栏：队首模型的账号全部失败后，链继续走到尾部 ——
    // 跨供应商同名优先（同一份实现，行为漂移最小），异名其次 —— 直到有候选答上来
    // 或墙钟预算耗尽。原先「默认停在队首模型」的开关与对应的日志字段已随那道栅栏
    // 一起退役（用户实测：客户端一上来就中断）。
    const headModel = scoped[0]?.displayName
    const headTail = scoped.filter(input => input.displayName !== headModel)
    const familyKey = headModel === undefined ? undefined : modelFamilyKey(headModel)
    const sequenced = headModel === undefined
      ? scoped
      : [
          ...scoped.filter(input => input.displayName === headModel),
          ...headTail.filter(input => modelFamilyKey(input.displayName) === familyKey),
          ...headTail.filter(input => modelFamilyKey(input.displayName) !== familyKey),
        ]

    const candidates: AutoCandidate[] = []
    for (const input of sequenced) {
      const candidate = candidatesByKey.get(
        candidateKey(input.providerId, input.accountId, input.displayName)
      )
      if (candidate) {
        candidates.push(candidate)
      }
    }

    // 空池的三种成因必须分开报：配置筛空（`missing` 已经写上 `pool_strategy` /
    // `manual_filter`）、能力不满足（`explainMissing`）、以及**候选全被瞬时状态挡掉**。
    // 只认最后一种、且剔除记录里一个非瞬时原因都没有（掺了 `tools_limit` /
    // `catalog_miss` 就不叫「等一会儿会回来」）。
    // 注意判据是 `skipped` 而不是 `rankInputs`：全被瞬时剔除时 `rankInputs` 恰好是空的，
    // 拿它当门槛会让这条分支永远不成立。
    //
    // 钉拒答时这一格的空池是**钉**造成的，不是整池瞬时状态：拿无关模型的额度窗口
    // 去算 Retry-After，会把「钉挡下这一轮」谎报成「全池额度耗尽、N 秒后重试」
    // （现网 2026-11-15：agnes 钉被 context 挡下，客户端却读到 bailian 的 22.9 天
    // 月窗复位时刻）。钉的四种处置自带各自的形状，这一格不许替它们说话。
    const transientUnavailable = candidates.length === 0
      && missing.length === 0
      && effectivePinMiss === undefined
      && skippedAreAllTransient(skipped)
      ? summarizeTransientSkips(transientSkips, now)
      : undefined

    // 命中粘性的原因如实报出去，供响应头/日志使用。
    const stickyHit = sticky !== undefined
      && candidates[0] !== undefined
      && candidates[0].provider.id === sticky.providerId
      && candidates[0].displayName === sticky.displayName
    const cacheAffinityHit = cacheHint !== undefined && stickyHit

    // 服务候选自己的能力描述只算一次：下面两个读数同源，不许各折一遍。
    const servedCapability = scoped.length === 0 ? undefined : capabilityOfCandidate(scoped[0]!)
    // 对外承诺的窗口要过 `/v1/models` 那道闸门（只收误差只会朝安全方向的来源）。
    // 不复用 `contextWindow`：日志与界面看推定值是有用的，客户端拿它安排压缩时机不是。
    const servedAdvertisedWindow = servedCapability === undefined
      ? undefined
      : advertisedContextTokens(servedCapability)
    // 路由级承诺与 `/v1/models` 同一套折叠（`floorOfPool`），池用本次请求的候选采集：
    // 瞬时不可用不改变窗口，差别只在「上一轮那个模型此刻还能不能派」，不影响这里要
    // 回答的问题 —— 客户端此刻按多大的窗口攒历史。路由缺省（legacy 全局口径）时没有
    // 承诺可谈，不写这一格。
    const routeAdvertisedWindow = route === undefined
      ? undefined
      : this.floorOfPool(collectedInputs, route)

    return {
      profile,
      route,
      routeName,
      // 服务候选已公布的窗口；没公布就不写（`undefined`），日志/头都用同一个数
      ...(servedCapability?.contextTokens === undefined
        ? {}
        : { contextWindow: servedCapability.contextTokens }),
      ...(servedAdvertisedWindow === undefined ? {} : { advertisedContextWindow: servedAdvertisedWindow }),
      ...(routeAdvertisedWindow === undefined ? {} : { routeAdvertisedWindow }),
      // 换家的基础上限随 decision 交给 forwarder：转发层不许再自己去读
      // legacy 全局 `autoRouting.maxAttempts`，那样逐路由的设置只对账号故障类的
      // 收口生效、对失败换家不生效。
      baseCap: maxAttempts,
      // 整条排序结果都交给换家循环：尾部候选在可恢复类失败（排队/额度/限流/目录不认）
      // 时继续顶上，账号故障类（5xx/网络）撞满 `baseCap` 就收手，另有墙钟预算兜底。
      // 这里不再裁剪家数 —— 裁到 `maxAttempts + 3` 就等于在选号阶段替供应商做了
      // 「这条路由只准用这几个模型」的决定，而池子里其余模型连被派一次的机会都没有。
      candidates,
      ...(sticky === undefined ? {} : { previousHint: sticky }),
      ...(latencyGateMs === undefined ? {} : { latencyGateMs }),
      ...(stickyGated ? { stickyGated: true as const } : {}),
      modelScope,
      ...(candidates[0] === undefined ? {} : { model: candidates[0].displayName }),
      ...(effectivePin === undefined
        ? {}
        : {
            pin: {
              displayName: effectivePin.displayName,
              scope: effectivePin.scope,
              source: effectivePin.source,
              until: effectivePin.until,
            },
          }),
      ...(effectivePinMiss === undefined ? {} : { pinMiss: effectivePinMiss }),
      ...(pinStale === undefined ? {} : { pinStale }),
      ...(pinCooling === undefined ? {} : { pinCooling }),
      ...(pinTransient === undefined ? {} : { pinTransient }),
      ...(pinBlocked === undefined ? {} : { pinBlocked }),
      ...(transientUnavailable === undefined ? {} : { transientUnavailable }),
      ...(circuited.length === 0 ? {} : { circuited: [...circuited] }),
      // 单模型作用域的换家墙钟预算更短：链只剩同一模型的几个账号，继续等不会
      // 等到新模型上台（换模型只能发生在回合之间），只会让客户端多挂几十秒。
      ...(modelScope === 'single' ? { wallClockBudgetMs: AUTO_SINGLE_SCOPE_BUDGET_MS } : {}),
      conversationKey: key,
      stickyKeySource,
      degraded,
      skipped: [...skipped],
      missing,
      prefer,
      // 胜负原因在**作用域裁剪之前**算：`single` 会把链裁到同一模型，用裁剪后的
      // 条数判 `only` 等于永远报 `only`（29/29 行的实测），把「钉子提上来的」与
      // 「打分选出来的」这两件事抹平。
      reason: pinRef !== undefined && pinnedOrder.hit && effectivePinMiss === undefined
        ? 'pin'
        : poolModelCount <= 1
          ? 'only'
          : cacheAffinityHit
            ? 'cache-affinity'
            : stickyHit ? 'sticky' : 'score',
    }
  }

  /**
   * 路由池预览：按和生产请求同一条采集/策略/手动增删管线，回答「保存这条路由后，
   * 哪些模型会真的被路由到、哪些被哪一步筛掉了」。
   *
   * 与 `select` 的差别只有两处：不扣冷却（进程内瞬时状态，与配置无关），也不做
   * 契约过滤（`n` / `response_format` 是请求属性而不是路由配置）。因此预览结果
   * 是「配置层面的候选」，不是某一次请求的最终候选。
   */
  preview(
    route: ModelRoute,
    sample: RoutePreviewSample = {},
    /** `fresh` 跳过**读**缓存（仍然写）：编辑器在保存标注/刷新后要的是当下真值。 */
    options: { fresh?: boolean } = {},
  ): RoutePreviewResult {
    // 池引用先解开再折：预览显示的必须是实际会用的那个池。断掉的引用按本路由自己的字段折
    // —— 请求路径会在 chat/completions 点名报错，这里只是编辑器辅助，不重复那套判定。
    const resolution = resolvePoolRoute(storeManager.getConfig().routes, route)
    const pool = resolution.ok ? resolution.route : route
    // 短缓存（第 5 条，2026-11-13）：托盘打开一次要按路由取快照，每次都是全池扫描，
    // 实测 p50 4.7s / p90 10.2s。预览不扣冷却（它问的是配置），所以同一个池配置在
    // 几秒内答案不变 —— 缓存键必须含**解引用之后**的池，`basedOnRoute` 的字段改了
    // 而调用方传进来的 route 一个字没变时，这个键才会跟着变。
    //
    // 结构修订号（2026-11-15）：池配置不变、但供应商/模型启停变了时，旧键一个字没变，
    // 缓存会把「已停的供应商仍在池里」的快照再端 ≤15s（菜单/切换也读这份）。把
    // store 的结构写修订号折进键：启停一落盘号即 +1，下一次预览立刻重算。每请求的
    // 日志/统计/额度写不 bump，缓存对高频读仍然有效。
    const cacheKey = [
      route.name,
      JSON.stringify(pool),
      storeManager.getStructuralRevision(),
      sample.needsVision === true ? 1 : 0,
      sample.needsTools === true ? 1 : 0,
      sample.needsReasoning === true ? 1 : 0,
      Math.max(0, Math.round(sample.estimatedTokens ?? 0)),
    ].join('\u0000')
    const cached = this.previewCache.get(cacheKey)
    if (options.fresh !== true && cached !== undefined && Date.now() - cached.at < PREVIEW_CACHE_MS) {
      return structuredClone(cached.value)
    }

    const profile: RequestProfile = {
      needsVision: sample.needsVision === true,
      needsTools: sample.needsTools === true,
      needsReasoning: sample.needsReasoning === true,
      estimatedTokens: Math.max(0, Math.round(sample.estimatedTokens ?? 0)),
      complexity: 'standard',
      stream: false,
    }
    // 只需要 `tools` 的长度来触发渠道能力前置过滤，内容不参与任何判定
    const probe = {
      messages: [],
      ...(profile.needsTools ? { tools: [{ type: 'function', function: { name: 'probe' } }] } : {}),
    } as unknown as ChatCompletionRequest

    // 展示口径：被瞬时状态挡下的候选也采一份（另册），否则「池里还有几十个模型、
    // 为什么一个都没派」在界面上没有任何痕迹 —— 它们会直接从列表里消失。
    const { rankInputs, blockedCandidates, blockedByKey, skipped } = this.collectCandidates(
      probe,
      Date.now(),
      { collectBlocked: true },
    )
    // 名字钉定与选路、广告下界同一份规则：预览折的必须是实际会用的那个基底。
    const pinned = applyModelNamePin(rankInputs, pool.pinModels)
    // 能力下限与选路同一位置：低于下限的模型在这里就出局，后面的策略/手动增删
    // 都看不到它们（预览也要说清「是哪一步让它出局的」）。
    const tierKept = applyMinTier(pinned, pool.minTier)
    const strategyOutcome = applyPoolStrategiesWithTrace(tierKept, pool.poolStrategies)
    const manual = applyManualModelSelection(
      strategyOutcome.kept,
      tierKept,
      pool.includeModels,
      pool.excludeModels
    )

    const modelKeyOf = (candidate: PoolStrategyCandidate): string =>
      modelRowKey(candidate.providerId, candidate.displayName)
    // 配置层结论的基底必须是 `rankInputs ∪ blockedCandidates`。只用 `rankInputs` 的话，
    // **整家账号都被额度挡住**时那份基底是空的，档位/策略/手动增删一条都算不出来 ——
    // 这家的模型于是从列表里整体消失，正是「池里还有几十个模型一次都没被派过、
    // 而界面看不出原因」的那件事。四个纯函数都是逐候选判定，基底多出来的行不会改变
    // 原有行的结论（`droppedBy` 也按候选对象查，不按集合）。
    const configBase = [...rankInputs, ...blockedCandidates]
    const configPinned = applyModelNamePin(configBase, pool.pinModels)
    const configTier = applyMinTier(configPinned, pool.minTier)
    const configStrategy = applyPoolStrategiesWithTrace(configTier, pool.poolStrategies)
    const configManual = applyManualModelSelection(
      configStrategy.kept,
      configTier,
      pool.includeModels,
      pool.excludeModels
    )
    const pinnedKeys = new Set(configPinned.map(modelKeyOf))
    const tierKeys = new Set(configTier.map(modelKeyOf))
    const keptKeys = new Set(configManual.kept.map(modelKeyOf))
    const includedKeys = new Set(configManual.included.map(modelKeyOf))
    const excludedKeys = new Set(configManual.excluded.map(modelKeyOf))
    // 此刻**派得出去**的模型键：同一模型有一把账号能派就算。`blocked` 只说「这一轮
    // 派不出去」，所以只要这里命中，那颗模型就不该被标成被跳过。
    const dispatchableKeys = new Set(rankInputs.map(modelKeyOf))

    /**
     * 一个候选在**配置层**的身份（与 `blocked` 正交）。
     *
     * 判据顺序就是选路管线的顺序：名字钉 → 能力下限 → 手动移除 → 能力/契约 →
     * 手动加回 → 策略。顺带把「能派但不合适」与「配置不要它」分开。
     */
    const configStatusOf = (candidate: PoolStrategyCandidate): {
      status: RoutePreviewStatus
      filteredBy?: AutoPoolStrategyId
      failure?: ModelHardRequirement
    } => {
      const key = modelKeyOf(candidate)
      const failure = hardFilterFailure(profile, capabilityOfCandidate(candidate))
      if (!pinnedKeys.has(key)) {
        // 钉了名字又不在名单里：这条与「被池策略筛掉」是两种缺席，分开说才不会让人
        // 去动池策略找原因。
        return { status: 'not-pinned' }
      }
      if (!tierKeys.has(key)) {
        // 低于路由的能力下限：这是路由自己的设置，不是策略也不是画像问题。
        return { status: 'below-tier' }
      }
      if (excludedKeys.has(key)) return { status: 'excluded' }
      // 与派发同口径：**真正钉住**的模型豁免 context（裁剪会收敛）；手动加回不豁免。
      const isPinnedModel = pool.preferredModel !== undefined
        && candidate.providerId === pool.preferredModel.providerId
        && candidate.displayName === pool.preferredModel.displayName
      const effectiveFailure = failure === 'context' && isPinnedModel ? undefined : failure
      if (effectiveFailure !== undefined) return { status: 'unavailable', failure: effectiveFailure }
      if (includedKeys.has(key)) return { status: 'included' }
      if (keptKeys.has(key)) return { status: 'kept' }
      return { status: 'filtered', filteredBy: configStrategy.droppedBy.get(candidate) }
    }

    const index = new Map<string, RoutePreviewModel>()
    const models: RoutePreviewModel[] = []
    // 一次遍历行表：能派的在前（`rankInputs` 就是真实选路次序），被挡下的接在后面。
    // 被挡下的行**仍然出现**，因为「为什么派不出去」正是列表要说清的事；但它们的
    // `status` 恒按配置层判 —— 一条配置结论（策略筛掉、手动移除、低于下限）不许
    // 因为「额度满了」被说成一次临时状态，否则用户会去等额度而永远等不到。
    for (const candidate of [...rankInputs, ...blockedCandidates]) {
      const key = modelKeyOf(candidate)
      const blocked = blockedByKey.get(key)
      const existing = index.get(key)
      if (existing !== undefined) {
        existing.accountCount += 1
        // 同模型的展示读数取各账号里**最快**的那个：菜单问的是「换到它会多快」，
        // 一个正在限流的账号不该把这个模型的读数拖成「这家很慢」。
        if (candidate.ewmaFirstTokenMs !== undefined
          && (existing.ewmaFirstTokenMs === undefined
            || candidate.ewmaFirstTokenMs < existing.ewmaFirstTokenMs)) {
          existing.ewmaFirstTokenMs = candidate.ewmaFirstTokenMs
        }
        // 有一把账号能派 → 这一轮它就是能派的：`blocked` 说的是「这个模型派不出去」，
        // 不是「其中有把 Key 此刻不行」。多账号里的一把打满不该给整行挂上跳过标记。
        if (existing.blocked === undefined
          && blocked !== undefined
          && !dispatchableKeys.has(key)) {
          existing.blocked = blocked
        }
        continue
      }

      const { status, filteredBy, failure } = configStatusOf(candidate)
      const capability = capabilityOfCandidate(candidate)
      // `blocked` 只挂在「配置层还在池里、但这一轮派不出去」的行上。被策略筛掉 /
      // 手动移除 / 低于下限的行由 `status` 说话，再叠一条额度原因只会让人以为
      // 等一会儿它就回来了。
      const inPool = status === 'kept' || status === 'included'
      const row: RoutePreviewModel = {
        providerId: candidate.providerId,
        providerName: candidate.providerName,
        displayName: candidate.displayName,
        actualModelId: candidate.actualModelId,
        accountCount: 1,
        status,
        ...(filteredBy === undefined ? {} : { filteredBy }),
        ...(failure === undefined ? {} : { unavailableReason: failure }),
        capability,
        ...(inPool && blocked !== undefined && !dispatchableKeys.has(key) ? { blocked } : {}),
        ...(candidate.costBucket === undefined ? {} : { costBucket: candidate.costBucket }),
        ...(candidate.ewmaFirstTokenMs === undefined ? {} : { ewmaFirstTokenMs: candidate.ewmaFirstTokenMs }),
        ...(candidate.costClass === undefined ? {} : { costClass: candidate.costClass }),
        ...(candidate.weight === undefined ? {} : { weight: candidate.weight }),
      }
      index.set(key, row)
      models.push(row)
    }

    const missing: MissingRequirement[] = []
    if (manual.kept.length === 0 && rankInputs.length > 0) {
      missing.push(
        tierKept.length === 0 && pinned.length > 0 && pool.minTier !== undefined
          ? 'min_tier'
          : strategyOutcome.kept.length === 0 ? 'pool_strategy' : 'manual_filter'
      )
    }

    const result: RoutePreviewResult = {
      routeName: route.name,
      profile,
      strategies: strategyOutcome.steps,
      conflicts: strategyOutcome.conflicts,
      models,
      counts: {
        // 只有没被瞬时状态挡下的才算「候选」。**不能**在 `models` 上数「没有 blocked
        // 的行」：被策略筛掉/手动移除的行也在表里、也没有 blocked，那样数出来的是
        // 「配置层没被挡的模型」，不是「这一轮派得出去的模型」。判据就是 `rankInputs`。
        candidates: new Set(rankInputs.map(modelKeyOf)).size,
        afterStrategies: new Set(strategyOutcome.kept.map(modelKeyOf)).size,
        afterManual: new Set(manual.kept.map(modelKeyOf)).size,
        unavailable: models.filter(model => model.status === 'unavailable').length,
      },
      manual: {
        included: new Set(manual.included.map(modelKeyOf)).size,
        excluded: new Set(manual.excluded.map(modelKeyOf)).size,
        unresolved: manual.unresolved,
      },
      missing,
      skipped: [...skipped],
    }
    // 存一份、返回一份克隆：调用方（菜单切片、IPC 载荷）拿到的是自己的副本，
    // 就地改一个字段不会把缓存污染成「下一批调用者看到的假池」。
    this.rememberPreview(cacheKey, result)
    return structuredClone(result)
  }

  /** 写预览缓存并按插入序淘汰：池配置每改一次就多一个键，不淘汰就是一张随编辑增长的表。 */
  private rememberPreview(key: string, value: RoutePreviewResult): void {
    const now = Date.now()
    this.previewCache.set(key, { at: now, value })
    if (this.previewCache.size <= PREVIEW_CACHE_ENTRIES) return
    for (const [cachedKey, entry] of this.previewCache) {
      if (now - entry.at >= PREVIEW_CACHE_MS) this.previewCache.delete(cachedKey)
    }
    while (this.previewCache.size > PREVIEW_CACHE_ENTRIES) {
      const oldest = this.previewCache.keys().next()
      if (oldest.done) break
      this.previewCache.delete(oldest.value)
    }
  }

  /** 清掉历史遗留的带到期时间的钉：新钉恒 `until: 0`（持久），不会被清扫。 */
  private sweepPins(now: number): void {
    for (const [key, pin] of this.modelPins) {
      // 钉住即持久（until: 0）：只有历史遗留的带到期时间的钉才清扫。
      if (pin.until > 0 && pin.until <= now) this.modelPins.delete(key)
    }
  }

  private sweepCircuits(now: number): void {
    for (const [key, entry] of this.modelCircuit) {
      if (entry.until <= now) this.modelCircuit.delete(key)
    }
  }

  /**
   * 生效中的内存钉：会话级优先于路由级（更窄的意图更该赢），同作用域后写覆盖前写。
   * `sessionKey` 与粘性键同一个口径（`conversationKey` / 客户端会话指纹）。
   */
  pinFor(routeName: string, sessionKey?: string, now = Date.now()): ModelPin | undefined {
    this.sweepPins(now)
    if (sessionKey !== undefined && sessionKey.length > 0) {
      const sessionPin = this.modelPins.get(pinMapKey(routeName, 'session', sessionKey))
      if (sessionPin !== undefined) return sessionPin
    }
    return this.modelPins.get(pinMapKey(routeName, 'route'))
  }

  /**
   * 写一颗钉。裁定 2026-11-15：钉住即持久（`until: 0`），没有倒计时、没有自动
   * 退役 —— 只有用户手动替换（`routes:switch`）或手动解除（`routes:unpin`）能改。
   * 路由级钉由 `routes:switch` 落盘成 `preferredModel`（控制台与托盘同一颗）；
   * 这里只承载会话级钉（客户端点名/会话上下文），同样持久、同样硬。
   */
  setPin(pin: Omit<ModelPin, 'until'>, now = Date.now()): ModelPin {
    this.sweepPins(now)
    const record: ModelPin = {
      route: pin.route,
      displayName: pin.displayName.trim(),
      ...(pin.providerId === undefined ? {} : { providerId: pin.providerId }),
      scope: pin.scope,
      ...(pin.sessionKey === undefined ? {} : { sessionKey: pin.sessionKey }),
      until: 0,
      source: pin.source,
    }
    this.modelPins.set(pinMapKey(record.route, record.scope, record.sessionKey), record)
    return record
  }

  clearPin(routeName: string, scope: ModelPinScope = 'route', sessionKey?: string): boolean {
    return this.modelPins.delete(pinMapKey(routeName, scope, sessionKey))
  }

  /**
   * 手动换钉 = 最高响应（裁定 2026-11-16）：用户点名的那一刻，网关自己开的退避票
   * 当场让路 —— 这颗模型的熔断票、它名下账号的故障冷却/429 退避/静默窗口，以及
   * 这条路由的粘性与缓存亲和惯性。下一笔请求立刻按新钉派发，而不是停在「N 秒后
   * 重试」的排队态。事实态不动（当日用量、额度标记、worker 限流、目录缺失）：
   * 那些是上游亲口说的，清了只是伪造容量，真撞墙时拒答会如实报出成因与复位时刻。
   */
  releaseForManualPin(routeName: string, providerId: string, displayName: string): void {
    this.modelCircuit.delete(circuitMapKey(routeName, displayName))
    const entry = storeManager.getEffectiveModels(providerId)
      .find(model => model.displayName.toLowerCase() === displayName.toLowerCase())
    const actualModel = entry?.actualModelId ?? displayName
    for (const account of storeManager.getAccountsByProviderId(providerId)) {
      accountRuntime.clearManualOverride(account.id, actualModel)
    }
    this.clearRouteInertia(routeName)
  }

  /**
   * 解钉 = 回到算法排队：清这条路由的粘性/缓存亲和锚点，下一轮真按分数排序，
   * 而不是被上一段会话的惯性硬钉在刚解掉的那颗模型上。熔断票是算法自己的质量
   * 信号，解钉不清（换钉才清：用户点名是对这颗模型的背书）。
   */
  clearRouteInertia(routeName: string): void {
    this.ensureCacheAffinityLoaded()
    const prefix = `${routeName}|`
    for (const key of [...this.sticky.keys()]) {
      if (key.startsWith(prefix)) this.sticky.delete(key)
    }
    for (const key of [...this.cacheAffinity.keys()]) {
      if (key.startsWith(prefix)) this.cacheAffinity.delete(key)
    }
    this.scheduleAffinityPersist()
  }

  /**
   * 第一次用到缓存亲和时，把磁盘上的读数并进内存表。
   *
   * 只补内存里没有的键：本进程已经写过的新读数优先级更高。过期与形状不合法
   * 的记录在 `normalizeCacheAffinity` 里就被丢掉了。
   */
  private ensureCacheAffinityLoaded(): void {
    if (this.cacheAffinityHydrated) return
    this.cacheAffinityHydrated = true
    let stored: CacheAffinityMap
    try {
      stored = storeManager.getCacheAffinity()
    } catch (error) {
      console.warn('[AutoRouter] 缓存亲和读数载入失败，按空表继续：', error)
      return
    }
    for (const [key, entry] of Object.entries(stored)) {
      if (this.cacheAffinity.has(key)) continue
      this.cacheAffinity.set(key, {
        hint: {
          providerId: entry.providerId,
          displayName: entry.displayName,
          accountId: entry.accountId,
        },
        expiresAt: entry.expiresAt,
      })
    }
  }

  /**
   * 节流落盘。`data.json` 是整档重写，成功请求密集时每笔都写会把回环中继拖慢；
   * 定时器 `unref` 掉，不阻止进程退出 —— 最多丢掉窗口内几笔亲和，下一笔成功会重写。
   */
  private scheduleAffinityPersist(): void {
    this.affinityPersistDirty = true
    if (this.affinityPersistTimer !== null) return
    this.affinityPersistTimer = setTimeout(() => {
      this.affinityPersistTimer = null
      if (!this.affinityPersistDirty) return
      this.affinityPersistDirty = false
      this.flushCacheAffinity()
    }, AFFINITY_PERSIST_DEBOUNCE_MS)
    // Node 与浏览器的定时器都带 unref；类型上按可选写法访问，避免在两种环境里各写一份。
    ;(this.affinityPersistTimer as { unref?: () => void }).unref?.()
  }

  private flushCacheAffinity(): void {
    // 兜底：任何一次写盘都必须基于「磁盘上的全量」而不是本进程见过的子集，
    // 否则启动后先发生的一次解钉会把别的路由的亲和整片抹掉。
    this.ensureCacheAffinityLoaded()
    const now = Date.now()
    const out: CacheAffinityMap = {}
    for (const [key, entry] of this.cacheAffinity) {
      if (entry.expiresAt <= now) continue
      out[key] = { ...entry.hint, expiresAt: entry.expiresAt }
    }
    try {
      storeManager.setCacheAffinity(out)
    } catch (error) {
      // 落盘失败不能让选路失败：内存里的亲和仍然是这一轮的依据。
      console.warn('[AutoRouter] 缓存亲和读数落盘失败：', error)
    }
  }

  /**
   * 给一个 (路由, 模型) 上熔断票。
   *
   * 只在轮次边界起作用：下一轮选路时被熔断的模型排到队尾（而不是删掉 —— 全池都在
   * 熔断时这张票不生效，见 `select`）。同一模型先成功一次就清票（`rememberRoute`），
   * 所以一次抖动不会把模型锁满整个 TTL。
   */
  tripModelCircuit(
    routeName: string,
    displayName: string,
    reason: string,
    minutes = MODEL_CIRCUIT_MINUTES,
    now = Date.now(),
  ): ModelCircuitEntry {
    this.sweepCircuits(now)
    const entry: ModelCircuitEntry = {
      route: routeName,
      displayName: displayName.trim(),
      until: now + Math.max(1, minutes) * 60_000,
      reason,
    }
    this.modelCircuit.set(circuitMapKey(routeName, displayName), entry)
    return entry
  }

  /** 读熔断解禁时间；过期即删（读到的是这一格在 `now` 的真相）。 */
  modelCircuitUntil(routeName: string, displayName: string, now = Date.now()): number | undefined {
    const entry = this.modelCircuit.get(circuitMapKey(routeName, displayName))
    if (entry === undefined) return undefined
    if (entry.until <= now) {
      this.modelCircuit.delete(circuitMapKey(routeName, displayName))
      return undefined
    }
    return entry.until
  }

  clearModelCircuit(routeName?: string, displayName?: string): number {
    let removed = 0
    for (const [key, entry] of this.modelCircuit) {
      if (routeName !== undefined && entry.route !== routeName) continue
      if (displayName !== undefined && entry.displayName !== displayName.trim()) continue
      this.modelCircuit.delete(key)
      removed += 1
    }
    return removed
  }

  circuitEntries(routeName?: string, now = Date.now()): ModelCircuitEntry[] {
    this.sweepCircuits(now)
    return [...this.modelCircuit.values()]
      .filter(entry => routeName === undefined || entry.route === routeName)
      .sort((a, b) => a.until - b.until)
  }

  /** 记录某条路由上一轮实际服务的模型，菜单的「上轮服务」与托盘提示行读这一格。 */
  noteServedModel(
    routeName: string,
    candidate: { provider: { id: string; name: string }; displayName: string },
    now = Date.now(),
  ): void {
    this.lastServed.set(routeName, {
      providerId: candidate.provider.id,
      providerName: candidate.provider.name,
      displayName: candidate.displayName,
      at: now,
    })
    while (this.lastServed.size > STICKY_CAPACITY) {
      const oldest = this.lastServed.keys().next()
      if (oldest.done) break
      this.lastServed.delete(oldest.value)
    }
  }

  /**
   * 这条路由当前可切换的模型：预览池里没被筛掉的那些，当前/被钉的排最前。
   *
   * **被瞬时状态挡下的模型也在里面**（`blocked` 非空，排在能派的之后）。这是推荐
   * 队列的地基：用户要能**看见**「这个模型很好，只是额度到 14:20 才回来」并且照样
   * 把它「固定」—— 裁定 2026-11-16 的「手动固定是最高响应」正是为这一刻准备的。
   * 把它们从可切换集合里去掉，用户就只能在「能派的模型」里选，那正是
   * 「池子里还有 51 个模型一次都没被派过，而界面看不出原因」的原样。
   */
  private selectableModels(route: ModelRoute, now: number, includeDropped = false): {
    models: RoutePreviewModel[]
    current?: RouteMenuCurrent
    pin?: ModelPin
    preferred?: RouteModelRef
  } {
    const preview = this.preview(route)
    const isExcluded = (model: RoutePreviewModel): boolean => model.status === 'excluded'
    // `includeDropped`（控制台路由页）：连被池策略/手动例外筛掉的行也带上 ——
    // 那一页要能就地排除/加回，而不是跳到路由编辑器去改配置。托盘不开这一档：
    // 它不是「选一个来固定」的界面，把几十行筛掉的东西塞进原生菜单只会滚不动。
    const inPool = includeDropped
      ? preview.models
      : preview.models.filter(model =>
          model.status === 'kept' || model.status === 'included' || model.status === 'excluded')
    const dispatchable = (model: RoutePreviewModel): boolean =>
      model.status === 'kept' || model.status === 'included'
    // 分段：能派的 → 被挡下的 → 被排除的 → 其它（仅 includeDropped 时出现）。
    // 段内顺序不动 —— 快照原序就是真实选路次序，菜单不另排一份。
    const selectable = [
      ...inPool.filter(model => dispatchable(model) && model.blocked === undefined),
      ...inPool.filter(model => dispatchable(model) && model.blocked !== undefined),
      ...inPool.filter(model => isExcluded(model)),
      ...inPool.filter(model => !dispatchable(model) && !isExcluded(model)),
    ]
    const current = this.lastServed.get(route.name)
    const pin = this.pinFor(route.name, undefined, now)
    const preferred = route.preferredModel
    const headName = pin?.displayName ?? preferred?.displayName
    const ordered = headName === undefined
      ? selectable
      : [
          ...selectable.filter(model => model.displayName === headName),
          ...selectable.filter(model => model.displayName !== headName),
        ]
    const currentFirst = current === undefined
      ? ordered
      : [
          ...ordered.filter(model => model.displayName === current.displayName),
          ...ordered.filter(model => model.displayName !== current.displayName),
        ]
    return {
      models: currentFirst,
      ...(current === undefined ? {} : { current }),
      ...(pin === undefined ? {} : { pin }),
      ...(preferred === undefined ? {} : { preferred }),
    }
  }

  /**
   * 一条路由的菜单快照（托盘与控制台共用）。
   *
   * 池来自 `preview` —— 与生产请求同一条采集/策略/手动增删管线，菜单里列的就是
   * 选路真的会用的那几个。这里不重新排序、也不另算一份池：两处各算一次，菜单与
   * 真实行为迟早会不一致。
   *
   * `channelAccounts` 是账号渠道 Worker 池的计数：宿主侧每家渠道只有一条空凭据
   * 占位账号，照本机表数永远是 1，而池里可能挂了几个号。读不到（Worker 未起）时
   * 调用方传 `undefined`，渠道行保留占位计数 —— 不把已连上的渠道显示成 0 个账号。
   */
  routeMenu(
    route: ModelRoute,
    limit = ROUTE_MENU_MODELS_DEFAULT,
    now = Date.now(),
    channelAccounts?: ChannelAccountCounts,
    /**
     * 连**被池策略/手动例外筛掉**的模型也带出来（控制台路由页用）。
     * 托盘不传：它只列「能点来固定的」，筛掉的几十行塞进原生菜单滚不动。
     */
    includeDropped = false,
    /**
     * 每行附带能力解析（控制台路由页的标注显示与入口）。托盘不传：它不画能力徽标，
     * 而这条快照是逐请求现算的，逐行一份来源表只会让快捷切换的载荷变重。
     */
    includeCapability = false,
  ): RouteMenuEntry {
    this.sweepCircuits(now)
    const { models, current, pin, preferred } = this.selectableModels(route, now, includeDropped)
    const routeName = route.name
    const pinnedName = pin?.displayName ?? preferred?.displayName
    // 钉子指向的模型不在可派池里：菜单照常显示这颗钉子（配置事实），但标成失效。
    // 不标的话，托盘与路由页都会显示「已固定 X」，而每一轮实际服务的是别人。
    const pinStale = pinnedName !== undefined
      && !models.some(model => model.displayName === pinnedName)
    const pinMeta = (displayName: string, scope: ModelPinScope, until: number, source: ModelPinSource) => ({
      displayName,
      scope,
      until,
      source,
      ...(pinStale ? { stale: true as const } : {}),
    })
    // 星级推荐按 (providerId, displayName) 精确键投影：同名模型多家服务时各评各的，
    // 与写入侧（routes:rate）和归一去重用的是同一条引用键。
    const ratings = new Map(
      (route.modelRatings ?? []).map(entry => [`${entry.providerId}\u0000${entry.displayName}`, entry.stars]),
    )
    // 额度概况按**这一页实际要发的行**算：账本读数是逐 (账号, 模型) 的窗口扫描，
    // 对着整池算就白付几百倍的钱（托盘只要 8 行）。非聚合、又没人声明的行几乎不花
    // 成本（没有可执行上限就不读账本），所以这里不需要再按类型分一次流。
    const visible = models.slice(0, Math.max(1, limit))
    const quotaContext = createQuotaGateContext()
    // 推荐星是选路打分的投影，而打分含 Bandit 战绩 —— 星级不读它，两者就又分叉了
    // （同样的档位、同样的延迟，一个 24h 连败的模型会被排到后面却是同星）。
    // 惰性取一次：没人看星就不扫日志；只查**这一页实际要发的行**。
    let liveStats: Map<string, BanditStats> | undefined
    const liveStatsFor = (providerId: string, actualModelId: string): BanditStats | undefined => {
      liveStats ??= aggregateBanditStats(storeManager.getRequestLogs(), now)
      return liveStats.get(banditKeyOf(providerId, actualModelId))
    }
    return {
      route: routeName,
      enabled: route.enabled !== false,
      modelScope: route.modelScope ?? 'single',
      ...(current === undefined ? {} : { current }),
      ...(pin !== undefined
        ? { pin: pinMeta(pin.displayName, pin.scope, pin.until, pin.source) }
        : preferred !== undefined
          // 持久硬钉没有到期时间：`until: 0` 在界面上读作「一直」（裁定 2026-11-15）。
          ? { pin: pinMeta(preferred.displayName, 'route', 0, 'console') }
          : {}),
      models: visible.map(model => {
        const circuitUntil = this.modelCircuitUntil(routeName, model.displayName, now)
        // 渠道行的账号数取自 Worker 池：本机表里只有那条占位账号。池读不到时
        // （`channelAccounts` 缺席）保持占位计数，而不是显示 0。
        const pool = channelAccounts?.[model.providerId]
        const accountCount = pool !== undefined
          && storeManager.getProviderById(model.providerId)?.type === 'account'
          ? pool.enabled
          : model.accountCount
        const rating = ratings.get(`${model.providerId}\u0000${model.displayName}`)
        const quota = quotaSummaryOf(model.providerId, model.actualModelId, quotaContext, now)
        // 账号级限流明细：`blocked.rate_limited` 只在**全部账号**限流时出现，
        // 而用户要看的是「3 个账号里 1 个限流、最早什么时候回来」——那张表
        // 只读内存（`noteRateLimits` 的逐账号扩展），零额外 RPC。
        const accountLimits = storeManager.getProviderById(model.providerId)?.type === 'account'
          ? accountChannelManager.modelAccountLimitSummary(model.providerId, model.actualModelId, now)
          : undefined
        return {
          providerId: model.providerId,
          providerName: model.providerName,
          displayName: model.displayName,
          accountCount,
          ...(model.ewmaFirstTokenMs === undefined ? {} : { ewmaFirstTokenMs: model.ewmaFirstTokenMs }),
          ...(model.costBucket === undefined ? {} : { costBucket: model.costBucket }),
          ...(circuitUntil === undefined ? {} : { circuitUntil }),
          ...(rating === undefined ? {} : { rating }),
          ...(model.blocked === undefined ? {} : { blocked: model.blocked }),
          ...(accountLimits === undefined ? {} : { accountLimits }),
          ...(quota.windows === 0 ? {} : { quota }),
          recommendedStars: recommendModelStars({
            tier: model.capability.tier,
            ...(model.ewmaFirstTokenMs === undefined ? {} : { ewmaFirstTokenMs: model.ewmaFirstTokenMs }),
            accountCount,
            circuitActive: circuitUntil !== undefined,
            ...(model.blocked === undefined ? {} : { blocked: model.blocked.reason }),
            quotaBand: quota.band,
            ...(model.costBucket === undefined ? {} : { costBucket: model.costBucket }),
            // 生效倍率按同一个 `now` 取：菜单与派发因此在窗口边界上同时切换。
            ...(model.weight === undefined ? {} : { weight: model.weight }),
            ...(liveStatsFor(model.providerId, model.actualModelId) === undefined
              ? {}
              : { live: liveStatsFor(model.providerId, model.actualModelId)! }),
            providerId: model.providerId,
            displayName: model.displayName,
            actualModelId: model.actualModelId,
          }),
          current: current !== undefined && current.displayName === model.displayName,
          pinned: pinnedName !== undefined && pinnedName === model.displayName,
          // 三态投影：路由页据此显示「策略保留 / 手动加回 / 手动排除 / 被策略筛掉」，
          // 与路由编辑器读同一份 preview 结论（同一个 `status` 字段，不另算）。
          status: model.status,
          ...(includeCapability ? { capability: model.capability } : {}),
          ...(model.filteredBy === undefined ? {} : { filteredBy: model.filteredBy }),
          ...(model.unavailableReason === undefined ? {} : { unavailableReason: model.unavailableReason }),
          ...(model.status === 'excluded' ? { excluded: true as const } : {}),
        } satisfies RouteMenuModel
      }),
      // 池内总数（含这一轮被挡下的那些）：它回答「这条路由有多大」，而不是「现在
      // 有几个能派」。菜单行里带 `blocked` 的行仍然算在池里 —— 用户可以固定它。
      totalModels: models.length,
    }
  }

  /**
   * 「换下一个 / 点名切换」的唯一入口（托盘与控制台共用）。
   *
   * 命中校验在这里；落盘由 `routes:switch` 统一做（写路由的 `preferredModel`，
   * 控制台与托盘同一颗持久硬钉，裁定 2026-11-15）。解除是 `routes:unpin`。
   *
   * 失败一定带原因：模型不在池里、池是空的、路由不存在 —— 静默成功会让托盘显示
   * 一个其实没生效的选择。
   */
  switchModel(
    request: RouteSwitchRequest,
    routes: readonly ModelRoute[],
    now = Date.now(),
    channelAccounts?: ChannelAccountCounts,
  ): RouteSwitchResult {
    const route = routes.find(candidate => candidate.name === request.route)
    if (route === undefined) {
      return { ok: false, route: request.route, reason: `路由 '${request.route}' 不存在` }
    }
    if (route.enabled === false) {
      return { ok: false, route: route.name, reason: `路由 '${route.name}' 已停用` }
    }
    const { models, current } = this.selectableModels(route, now)
    if (models.length === 0) {
      return { ok: false, route: route.name, reason: '这条路由当前没有可切换的模型' }
    }

    let target = request.model?.trim()
    if (target === undefined || target.length === 0) {
      // 「换下一个」：从当前服务的模型往前走一格，绕回池首。没有当前读数时取池首。
      const index = current === undefined
        ? -1
        : models.findIndex(model => model.displayName === current.displayName)
      target = models[(index + 1) % models.length]!.displayName
    }
    const hit = models.find(model =>
      model.displayName === target
      && (request.providerId === undefined || model.providerId === request.providerId)
    )
    if (hit === undefined) {
      return {
        ok: false,
        route: route.name,
        model: target,
        reason: `模型 '${target}' 不在这条路由的候选池里`,
        menu: this.routeMenu(route, ROUTE_MENU_MODELS_DEFAULT, now, channelAccounts),
      }
    }

    const scope: ModelPinScope = request.scope ?? 'route'
    if (scope === 'session') {
      return {
        ok: false,
        route: route.name,
        model: hit.displayName,
        reason: '会话级钉只由请求头写入；控制台与托盘的切换都按路由落盘',
      }
    }
    // 裁定 2026-11-15：路由级钉不写内存 —— 由 `routes:switch` 统一落盘成
    // `preferredModel`，控制台与托盘写的是同一颗持久硬钉。这里只负责命中校验。
    return {
      ok: true,
      route: route.name,
      model: hit.displayName,
      // 命中的是哪个 `providerId` 由这里说了算：同名模型可能被多家服务，调用方
      // （`routes:switch` 的落盘分支）要把它原样写进 `preferredModel`，
      // 不能拿着 `request.providerId` 反推 —— 它可能是 undefined。
      providerId: hit.providerId,
      menu: this.routeMenu(route, ROUTE_MENU_MODELS_DEFAULT, now, channelAccounts),
    }
  }

  /**
   * 撤掉一条会话的粘性锚点。
   *
   * 用于「协议成功但内容退化」的轮次：锚点是在响应头阶段写的，而退化要到流结束
   * 才算得出来。留着它，下一轮仍然会被硬优先送到同一家，降权追不上。
   */
  revokeSticky(key: string | undefined, route?: ModelRoute): void {
    if (!key) return
    this.ensureCacheAffinityLoaded()
    this.sticky.delete(stickyMapKey(route?.name ?? LEGACY_ROUTE_NAME, key))
    // Quality degradation is a correctness signal, not a cache trade-off: a
    // repeating or truncated turn must not stay pinned just because its prefix
    // is warm.
    this.cacheAffinity.delete(stickyMapKey(route?.name ?? LEGACY_ROUTE_NAME, key))
    this.scheduleAffinityPersist()
  }

  /**
   * 记录本次成功的路由，让同一会话在**这条路由**的 stickyMinutes 内优先命中同
   * 一个模型。粘性时长按路由取（没传路由才回退 legacy 全局值），键带路由名前缀，
   * 所以两条路由各钉各的、互不覆盖。
   * 被钉住的候选若因冷却/配额从候选池消失，会自然失效，不需要额外清理。
   *
   * 同一处还写一份缓存亲和（`cacheAffinityMinutes`）：它只对能力表里已知支持
   * 前缀缓存的供应商生效，且与 `stickyMinutes` 独立 —— 用户把粘性设为 0 时仍然
   * 可以保留「同一段会话尽量落在同一个账号/模型」这条缓存规则。
   */
  rememberRoute(key: string | undefined, candidate: AutoCandidate, route?: ModelRoute): void {
    const routeName = route?.name ?? LEGACY_ROUTE_NAME
    // 「当前在跑谁」与「这颗熔断票可以撕了」都在成功那一刻记账，且不依赖粘性键：
    // 粘性可以关（`stickyMinutes: 0`），菜单和熔断清除不能跟着一起失效。
    this.noteServedModel(routeName, candidate)
    this.modelCircuit.delete(circuitMapKey(routeName, candidate.displayName))
    if (!key) return

    const fullConfig = storeManager.getConfig()
    const config = fullConfig.autoRouting
    const minutes = route?.stickyMinutes ?? config?.stickyMinutes ?? 0
    const requestedAffinity = config?.cacheAffinityMinutes ?? 0
    const capability = promptCacheCapabilityOf(candidate.provider)
    const cacheCapable = capability !== undefined && capability.mode !== 'unknown'
    // A cache affinity may not outlive the cache it exists for: pinned for 60 min
    // to a provider whose documented TTL is 5 min keeps a switch that no longer
    // pays for anything.
    const affinityMinutes = cacheCapable
      ? effectiveAffinityMinutes(requestedAffinity, capability, fullConfig.promptCaching?.anthropicTtl)
      : 0

    if (minutes <= 0 && affinityMinutes <= 0) return

    if (affinityMinutes > 0) this.ensureCacheAffinityLoaded()
    const now = Date.now()
    for (const [existingKey, entry] of this.sticky) {
      if (entry.expiresAt <= now) {
        this.sticky.delete(existingKey)
      }
    }
    for (const [existingKey, entry] of this.cacheAffinity) {
      if (entry.expiresAt <= now) {
        this.cacheAffinity.delete(existingKey)
      }
    }

    const stickyKey = stickyMapKey(route?.name ?? LEGACY_ROUTE_NAME, key)
    const hint = {
      providerId: candidate.provider.id,
      displayName: candidate.displayName,
      accountId: candidate.account.id,
    }

    if (minutes > 0) {
      this.sticky.delete(stickyKey)
      this.sticky.set(stickyKey, { hint, expiresAt: now + minutes * 60 * 1000 })
    }

    if (affinityMinutes > 0) {
      this.cacheAffinity.delete(stickyKey)
      this.cacheAffinity.set(stickyKey, { hint, expiresAt: now + affinityMinutes * 60 * 1000 })
    }

    while (this.sticky.size > STICKY_CAPACITY) {
      const oldest = this.sticky.keys().next()
      if (oldest.done) break
      this.sticky.delete(oldest.value)
    }
    while (this.cacheAffinity.size > STICKY_CAPACITY) {
      const oldest = this.cacheAffinity.keys().next()
      if (oldest.done) break
      this.cacheAffinity.delete(oldest.value)
    }
    if (affinityMinutes > 0) this.scheduleAffinityPersist()
  }

  /**
   * 该账号当前是否处于冷却期。
   *
   * `model` 给了就连同该模型的限流档一起问 —— 排序与选路关心的是「这个账号跑这个
   * 模型能不能派」，账号整体健康不代表这个模型不在限流窗里。
   */
  isAccountCooling(accountId: string, model?: string): boolean {
    return accountRuntime.isCooling(accountId, Date.now(), model)
  }

  /**
   * 标记账号冷却：429 给了 `model` 就按 (账号, 模型) 档做分钟级指数退避，
   * 其余错误按账号级秒级退避。
   *
   * `details` 里的原文决定要不要升成**终止性**冷却（6h / 1h）：15 秒退避对
   * 「没订阅 / 没钱 / 额度窗已尽」没有意义，每一笔新请求都会把同一家再撞一遍。
   * 判据与 `Retry-After` 同源，见 `failover.ts::permanentRefusalCooldownMs`。
   */
  markAccountCooldown(
    accountId: string,
    status?: number,
    model?: string,
    details: { message?: string; retryAfterMs?: number } = {},
  ): void {
    const now = Date.now()
    // 上游写明的复位时刻是**事实**，1h/6h 终局档只是没有事实时的估计。两者取更晚者
    // 会让客户端白等最多一整档（2026-11-15 现网实测：真实复位 09:56Z，却睡到 10:11Z）。
    // 所以解析到时刻就以它为准，终局档只在没有时刻时兜底；Retry-After 头仍取更晚者。
    const resetMs = quotaWindowResetMs(details.message, now)
    const permanentTtlMs = resetMs === undefined
      ? permanentRefusalCooldownMs({
        status,
        ...(details.message === undefined ? {} : { message: details.message }),
      })
      : undefined
    const retryAfterMs =
      resetMs === undefined ? details.retryAfterMs : Math.max(details.retryAfterMs ?? 0, resetMs)
    accountRuntime.recordFailure(
      accountId,
      status,
      now,
      model,
      retryAfterMs,
      permanentTtlMs === undefined ? {} : { permanentTtlMs },
    )
  }

  /**
   * 凭据类故障的冷却（重新登录 / 补 Key / 匿名槽耗尽）。
   *
   * 账号渠道每家在宿主侧只有一个本机占位账号（`manager.ensureLocalAccount`），
   * 所以「账号级冷却」在这一类里天然就是「渠道级冷却」，不需要另建一张表。
   */
  markCredentialCooldown(accountId: string): void {
    accountRuntime.recordCredentialFailure(accountId)
  }

  /**
   * 成功后解除冷却。带 `model` 只清这个模型的限流档；不带则清该账号全部档
   * （渠道池变化 / 重新登录 / 重启走这条，见 `accountChannels/manager.ts`）。
   */
  clearAccountCooldown(accountId: string, model?: string): void {
    accountRuntime.recordSuccess(accountId, model)
  }

  /** 代理服务重启时清空，避免跨进程生命周期残留 */
  reset(): void {
    accountRuntime.reset()
    // 目录缺失冷却也是运行时状态：代理重启/测试用例之间应回到干净池。
    clearCatalogMissCooldowns()
    // 份额账本与运行时指标同生命周期：重启后不该继续背着上一轮的派发欠债
    dispatchLedger.reset()
    this.sticky.clear()
    // 内存钉/熔断/「当前服务者」都是进程内瞬时状态：重启后回到配置本身
    this.modelPins.clear()
    this.modelCircuit.clear()
    this.lastServed.clear()
    this.previewCache.clear()
    this.seed = 0
  }
}

export const autoRouter = new AutoRouter()
export default autoRouter
