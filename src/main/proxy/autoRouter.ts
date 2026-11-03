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
import { resolvePoolRoute } from '../store/modelRoutes'
import type { Account, Provider, UserModelMarks } from '../store/types'
import type {
  AutoPoolStrategy,
  AutoPoolStrategyId,
  AutoPreference,
  ModelCapability,
  ModelCapabilityHint,
  ModelRoute,
  RouteModelRef,
  RoutePreviewModel,
  RoutePreviewResult,
  RoutePreviewSample,
  RoutePreviewStatus,
} from '../../shared/types'
import { DEFAULT_FAIRNESS_LEAD } from '../../shared/types'
import type { ChatCompletionRequest } from './types'
import type { CatalogAdoption } from '../../shared/modelCatalog.ts'
import { adoptionsForModel, catalogAdoptionHint } from '../../shared/modelCatalog.ts'
import { accountRuntime } from './accountRuntime'
import { getChannelDefinition } from '../providers/accountChannels/catalogue'
import {
  advertisedContextFloorOf,
  advertisedContextTokens,
  applyContractFilter,
  applyManualModelSelection,
  applyModelNamePin,
  applyPoolStrategiesWithTrace,
  capabilityOfCandidate,
  contractNeeds,
  explainMissing,
  conversationKey,
  hashString,
  hardFilterFailure,
  mergedHintOf,
  profileRequest,
  providerMeetsContract,
  rankCandidates,
  type AutoRoutingStrategy,
  type MissingRequirement,
  type PoolStrategyCandidate,
  type RequestProfile,
  type StickyHint,
} from './autoRouting'
import { createQuotaGateContext, quotaBlockReason, aggregateHeadroom } from './quota/gate.ts'
import { aggregateBanditStats, banditKeyOf } from './autoBandit.ts'
import { dispatchLedger, dispatchKeyOf } from './dispatchLedger.ts'
import { aggregateContextWindow } from './modelCapabilities.ts'
import { aggregateThirdPartyHint } from '../../shared/aggregateCapabilities.ts'
import { costBucketOf, type CostBucket } from '../../shared/channels.ts'
import type { ClientSessionKey } from '../../shared/clientSessionKey.ts'
import { aggregateCostOf, costBucketOfAggregateClass, type AggregateCostClass } from '../../shared/aggregateCost.ts'
import { getAggregateEntry } from '../providers/aggregate/registry.ts'

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

export interface AutoCandidate {
  account: Account
  provider: Provider
  displayName: string
  actualModel: string
}

export interface AutoRouteDecision {
  profile: RequestProfile
  candidates: AutoCandidate[]
  /**
   * 本次将服务的第一候选**已公布**的上下文窗口（token）。没公布就是 `undefined` ——
   * 不兜底成猜测值，日志与 `/v1/models` 用同一个口径（`shared/requestContextFit.ts`）。
   */
  contextWindow?: number
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
  /** 胜负原因：只有一个候选 / 命中会话粘性 / 综合分 */
  reason: 'only' | 'sticky' | 'score'
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
  hint: ModelCapabilityHint | undefined
): { bucket: CostBucket; costClass?: AggregateCostClass } {
  const free = hint?.free === true
  if (free) return { bucket: 'free' }
  if (hint?.weight !== undefined) return { bucket: costBucketOf(hint.weight, free) }

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

/** 没传路由时（legacy 路径）在粘性表与响应头里使用的名字：就是那个虚拟模型名。 */
const LEGACY_ROUTE_NAME = AUTO_MODEL_ID

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
  thirdParty?: ModelCapabilityHint
  manual?: ModelCapabilityHint
}

/**
 * 收集一个模型全部标注层。`marks` / `adoptions` 是本次决策一次性读出的两张表 ——
 * 逐候选读 store 会让一次 `select` 读几十次盘上对象。
 *
 * 顺序与 metadata 链一致：manual > record > official > catalog >（静态/第三方在
 * `resolveCapabilityDetail` 内按固定顺序补位）。catalog 只来自 adoption ledger，
 * 未采用的候选不参与；价格字段永远不会出现在这里。
 */
function capabilityHintsFor(
  provider: Provider,
  displayName: string,
  actualModelId: string,
  marks: UserModelMarks,
  adoptions: readonly CatalogAdoption[]
): CandidateHints {
  const record = provider.modelCapabilities?.[displayName]
  const aggregateId = provider.type === 'aggregate' ? (provider.aggregateId ?? provider.id) : undefined
  const contextWindow = aggregateId === undefined
    ? undefined
    : aggregateContextWindow(aggregateId, actualModelId)
  const thirdParty = aggregateId === undefined
    ? undefined
    : aggregateThirdPartyHint(aggregateId, actualModelId)
  const manual = marks[provider.id]?.[displayName]
  const catalog = catalogAdoptionHint(adoptionsForModel(adoptions, provider.id, displayName))

  return {
    ...(record === undefined ? {} : { record }),
    ...(contextWindow === undefined ? {} : { official: { contextTokens: contextWindow } }),
    ...(catalog === undefined ? {} : { catalog }),
    ...(thirdParty === undefined ? {} : { thirdParty }),
    ...(manual === undefined ? {} : { manual }),
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

  /** 广告下界用的候选池：与请求无关（空 messages，故渠道工具门与工具负载都不参与），且不扣瞬时可用性 */
  private advertisedPool(): PoolStrategyCandidate[] {
    const probe = { messages: [] } as unknown as ChatCompletionRequest
    return this.collectCandidates(probe, Date.now(), { ignoreTransientAvailability: true }).rankInputs
  }

  /**
   * 一条路由在给定池上折叠出的候选：池策略之后、手动增删之后。不传 `route` 时回退
   * legacy 全局池策略（与 `select` 同口径）。广告下界与候选数都从这里折，两处不许
   * 各写一遍折叠（写两遍就会有一遍忘了 `excludeModels`）。
   */
  private keptOfPool(pool: readonly PoolStrategyCandidate[], route?: ModelRoute): PoolStrategyCandidate[] {
    // 名字钉定先收基底：广告下界与选路折的是同一个基底，两处不许分叉。
    const base = applyModelNamePin(pool, route?.pinModels)
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

  /** 一条路由在给定池上的窗口下界 */
  private floorOfPool(pool: readonly PoolStrategyCandidate[], route?: ModelRoute): number | undefined {
    return advertisedContextFloorOf(
      this.keptOfPool(pool, route).map(candidate => advertisedContextTokens(capabilityOfCandidate(candidate)))
    )
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
  } = {}): {
    rankInputs: PoolStrategyCandidate[]
    candidatesByKey: Map<string, AutoCandidate>
    skipped: Set<string>
  } {
    const providers = storeManager.getProviders().filter(provider => provider.enabled)
    const needs = contractNeeds(request)
    const marks = storeManager.getUserModelMarks()
    const adoptions = storeManager.getCatalogAdoptions()
    const rankInputs: PoolStrategyCandidate[] = []
    const candidatesByKey = new Map<string, AutoCandidate>()
    // 前置剔除的候选及原因（Set 去重：同一模型多账号命中同一原因只记一条）
    const skipped = new Set<string>()
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

        for (const account of accounts) {
          if (!options.ignoreTransientAvailability) {
            if (account.dailyLimit && (account.todayUsed ?? 0) >= account.dailyLimit) {
              continue
            }

            // 额度已打满的候选根本不进排序，失败切换才不会浪费一次上游请求
            const quotaBlocked = quotaBlockReason(provider, account.id, model.actualModelId, gateContext)
            if (quotaBlocked !== undefined) {
              skipped.add(`${provider.id}/${model.displayName}:${quotaBlocked}`)
              continue
            }
          }

          // 带上这个候选的真实模型名：429 限流档按 (账号, 模型) 记，只查账号会漏掉
          // 「账号健康、但这个模型正在限流里」的那一档
          const runtime = accountRuntime.snapshot(account.id, now, model.actualModelId)
          const key = candidateKey(provider.id, account.id, model.displayName)
          const hints = capabilityHintsFor(provider, model.displayName, model.actualModelId, marks, adoptions)
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
            mergedHintOf({ manualHint: hints.manual, capabilityHint: hints.record, thirdPartyHint: hints.thirdParty })
          )
          const candidate: PoolStrategyCandidate = {
            providerId: provider.id,
            providerName: provider.name,
            displayName: model.displayName,
            actualModelId: model.actualModelId,
            accountId: account.id,
            providerType: provider.type,
            todayUsed: account.todayUsed,
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
            ...(hints.thirdParty === undefined ? {} : { thirdPartyHint: hints.thirdParty }),
            contractCapable,
            costBucket: costSignal.bucket,
            ...(costSignal.costClass === undefined ? {} : { costClass: costSignal.costClass }),
            ...(quotaHeadroom === undefined ? {} : { quotaHeadroom }),
            ...(live === undefined ? {} : { live }),
            dispatchCount: dispatches.counts.get(dispatchKeyOf(provider.id, model.actualModelId)) ?? 0,
          }
          rankInputs.push(candidate)
          candidatesByKey.set(key, {
            account,
            provider,
            displayName: model.displayName,
            actualModel: model.actualModelId,
          })
        }
      }
    }

    return { rankInputs, candidatesByKey, skipped }
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
    sessionKey?: ClientSessionKey
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

    const { rankInputs, candidatesByKey, skipped } = this.collectCandidates(request, now)
    const needs = contractNeeds(request)

    // 策略筛选（静态、用户预设）：在候选池构建处、契约过滤之前生效。
    // 策略针对模型而非账号——同一模型的多账号候选一起过滤。空数组 = 不过滤，
    // 候选池与未配置策略时完全一致。过滤后为空则走下方契约/排序兜底（空池
    // 时 explainMissing 自然返回空，不误报缺能力）。
    const poolStrategies = route?.poolStrategies ?? autoConfig?.poolStrategies ?? []
    // 名字钉定：基底先收到被点名的模型，`includeModels` 也只能在这个基底里取回 ——
    // 否则一条钉死的路由会被一次手动增删绕开。
    const pinnedRankInputs = applyModelNamePin(rankInputs, route?.pinModels)
    const strategyOutcome = applyPoolStrategiesWithTrace(pinnedRankInputs, poolStrategies)

    // 手动增删：策略之后、契约过滤之前。exclude 赢过 include，include 只能从
    // 策略前就有资格的候选里取回模型 —— 不会复活停用的模型，也不会绕过下面
    // 的契约过滤与排序阶段的硬过滤。
    const manual = applyManualModelSelection(
      strategyOutcome.kept,
      pinnedRankInputs,
      route?.includeModels ?? [],
      route?.excludeModels ?? []
    )
    const pool = manual.kept

    // 契约过滤：有能满足的候选就只在它们里面挑；全都不满足时
    // `n > 1` 直接交给调用方报 400（内置供应商本来就这样拒绝），
    // `response_format` 则照常路由并标记降级——返回自由文本比拒绝可用。
    const contract = applyContractFilter(pool, needs)
    const contractPool = contract.pool
    const degraded = contract.degraded
    const missing: string[] = contract.missing

    // 空池要能区分「供应商没候选」和「配置把候选筛光了」：后两者指向用户
    // 自己刚改的设置，归成前者会让人白查供应商。
    if (pool.length === 0 && missing.length === 0 && rankInputs.length > 0) {
      missing.push(strategyOutcome.kept.length === 0 ? 'pool_strategy' : 'manual_filter')
    }

    const seed = this.seed++
    // 粘性键优先用客户端给的会话标识：agent 客户端自动摘要会改写首条用户消息，内容
    // 指纹随之改变，同一段会话就会被派到别家。没有标识时逐字沿用内容指纹（老行为）。
    const stickyKeySource: 'client-session' | 'content-hash' =
      sessionKey === undefined ? 'content-hash' : 'client-session'
    const key = sessionKey !== undefined
      ? `session:${hashString(sessionKey.value)}`
      : conversationKey(request)
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

    // 候选池非空却排不出结果时，说明缺的是某种能力，而不是没有供应商
    if (ranked.length === 0 && missing.length === 0) {
      missing.push(...explainMissing(profile, contractPool))
    }

    // 会话粘性在路由层是**硬优先**（`stickyHardPin`，缺省即开）：打分里的 0.12 只是
    // 「同分时的倾向」，盖不过免费/档位/成本差；实测 Codex 同一段对话 21 次请求在 7 个
    // 模型之间跳，最后被 Spark-X2.6 接成「继续上一轮」。agent 会话换模型比慢一点更
    // 伤：上下文理解、工具协议、缓存全部重来。这里把上一轮成功的模型提到队首；它若
    // 停服/冷却，候选池里自然没有它，仍然自动让位。
    // 关掉这一格就退回路由 v2 计划 §1.4 的纯加分语义：首位由打分决定，粘性只提供
    // +0.12 / +0.06，差距过大时会让位给更合适的候选。
    const ordered = route?.stickyHardPin === false ? ranked : promoteSticky(ranked, sticky)

    const candidates: AutoCandidate[] = []
    for (const input of ordered) {
      const candidate = candidatesByKey.get(
        candidateKey(input.providerId, input.accountId, input.displayName)
      )
      if (candidate) {
        candidates.push(candidate)
      }
    }

    // 命中粘性的原因如实报出去，供响应头/日志使用。
    const stickyHit = sticky !== undefined
      && candidates[0] !== undefined
      && candidates[0].provider.id === sticky.providerId
      && candidates[0].displayName === sticky.displayName

    return {
      profile,
      route,
      routeName,
      // 服务候选已公布的窗口；没公布就不写（`undefined`），日志/头都用同一个数
      ...(ordered.length === 0 || capabilityOfCandidate(ordered[0]!).contextTokens === undefined
        ? {}
        : { contextWindow: capabilityOfCandidate(ordered[0]!).contextTokens }),
      // 换家的基础上限随 decision 交给 forwarder：转发层不许再自己去读
      // legacy 全局 `autoRouting.maxAttempts`，那样逐路由的设置只对账号故障类的
      // 收口生效、对失败换家不生效。
      baseCap: maxAttempts,
      // 整条排序结果都交给换家循环：尾部候选在可恢复类失败（排队/额度/限流/目录不认）
      // 时继续顶上，账号故障类（5xx/网络）撞满 `baseCap` 就收手，另有墙钟预算兜底。
      // 这里不再裁剪家数 —— 裁到 `maxAttempts + 3` 就等于在选号阶段替供应商做了
      // 「这条路由只准用这几个模型」的决定，而池子里其余模型连被派一次的机会都没有。
      candidates,
      conversationKey: key,
      stickyKeySource,
      degraded,
      skipped: [...skipped],
      missing,
      prefer,
      reason: candidates.length <= 1 ? 'only' : stickyHit ? 'sticky' : 'score',
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
  preview(route: ModelRoute, sample: RoutePreviewSample = {}): RoutePreviewResult {
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

    const { rankInputs, skipped } = this.collectCandidates(probe, Date.now())
    // 池引用先解开再折：预览显示的必须是实际会用的那个池。断掉的引用按本路由自己的字段折
    // —— 请求路径会在 chat/completions 点名报错，这里只是编辑器辅助，不重复那套判定。
    const resolution = resolvePoolRoute(storeManager.getConfig().routes, route)
    const pool = resolution.ok ? resolution.route : route
    // 名字钉定与选路、广告下界同一份规则：预览折的必须是实际会用的那个基底。
    const pinned = applyModelNamePin(rankInputs, pool.pinModels)
    const strategyOutcome = applyPoolStrategiesWithTrace(pinned, pool.poolStrategies)
    const manual = applyManualModelSelection(
      strategyOutcome.kept,
      pinned,
      pool.includeModels,
      pool.excludeModels
    )

    const modelKeyOf = (candidate: PoolStrategyCandidate): string =>
      `${candidate.providerId}\u0000${candidate.displayName.trim().toLowerCase()}`
    const keptKeys = new Set(manual.kept.map(modelKeyOf))
    const includedKeys = new Set(manual.included.map(modelKeyOf))
    const excludedKeys = new Set(manual.excluded.map(modelKeyOf))
    const pinnedKeys = new Set(pinned.map(modelKeyOf))

    const index = new Map<string, RoutePreviewModel>()
    const models: RoutePreviewModel[] = []
    for (const candidate of rankInputs) {
      const key = modelKeyOf(candidate)
      const existing = index.get(key)
      if (existing !== undefined) {
        existing.accountCount += 1
        continue
      }

      const capability = capabilityOfCandidate(candidate)
      const failure = hardFilterFailure(profile, capability)
      let status: RoutePreviewStatus
      let filteredBy: AutoPoolStrategyId | undefined
      if (!pinnedKeys.has(key)) {
        // 钉了名字又不在名单里：这条与「被池策略筛掉」是两种缺席，分开说才不会让人
        // 去动池策略找原因。
        status = 'not-pinned'
      } else if (excludedKeys.has(key)) {
        status = 'excluded'
      } else if (failure !== undefined) {
        status = 'unavailable'
      } else if (includedKeys.has(key)) {
        status = 'included'
      } else if (keptKeys.has(key)) {
        status = 'kept'
      } else {
        status = 'filtered'
        filteredBy = strategyOutcome.droppedBy.get(candidate)
      }

      const row: RoutePreviewModel = {
        providerId: candidate.providerId,
        providerName: candidate.providerName,
        displayName: candidate.displayName,
        accountCount: 1,
        status,
        ...(filteredBy === undefined ? {} : { filteredBy }),
        ...(failure === undefined ? {} : { unavailableReason: failure }),
        capability,
        ...(candidate.costBucket === undefined ? {} : { costBucket: candidate.costBucket }),
        ...(candidate.costClass === undefined ? {} : { costClass: candidate.costClass }),
      }
      index.set(key, row)
      models.push(row)
    }

    const missing: MissingRequirement[] = []
    if (manual.kept.length === 0 && rankInputs.length > 0) {
      missing.push(strategyOutcome.kept.length === 0 ? 'pool_strategy' : 'manual_filter')
    }

    return {
      routeName: route.name,
      profile,
      strategies: strategyOutcome.steps,
      conflicts: strategyOutcome.conflicts,
      models,
      counts: {
        candidates: models.length,
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
  }

  /**
   * 撤掉一条会话的粘性锚点。
   *
   * 用于「协议成功但内容退化」的轮次：锚点是在响应头阶段写的，而退化要到流结束
   * 才算得出来。留着它，下一轮仍然会被硬优先送到同一家，降权追不上。
   */
  revokeSticky(key: string | undefined, route?: ModelRoute): void {
    if (!key) return
    this.sticky.delete(stickyMapKey(route?.name ?? LEGACY_ROUTE_NAME, key))
  }

  /**
   * 记录本次成功的路由，让同一会话在**这条路由**的 stickyMinutes 内优先命中同
   * 一个模型。粘性时长按路由取（没传路由才回退 legacy 全局值），键带路由名前缀，
   * 所以两条路由各钉各的、互不覆盖。
   * 被钉住的候选若因冷却/配额从候选池消失，会自然失效，不需要额外清理。
   */
  rememberRoute(key: string | undefined, candidate: AutoCandidate, route?: ModelRoute): void {
    if (!key) return

    const minutes = route?.stickyMinutes
      ?? storeManager.getConfig().autoRouting?.stickyMinutes
      ?? 0
    if (minutes <= 0) return

    const now = Date.now()
    for (const [existingKey, entry] of this.sticky) {
      if (entry.expiresAt <= now) {
        this.sticky.delete(existingKey)
      }
    }

    const stickyKey = stickyMapKey(route?.name ?? LEGACY_ROUTE_NAME, key)
    this.sticky.delete(stickyKey)
    this.sticky.set(stickyKey, {
      hint: {
        providerId: candidate.provider.id,
        displayName: candidate.displayName,
        accountId: candidate.account.id,
      },
      expiresAt: now + minutes * 60 * 1000,
    })

    while (this.sticky.size > STICKY_CAPACITY) {
      const oldest = this.sticky.keys().next()
      if (oldest.done) break
      this.sticky.delete(oldest.value)
    }
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
   */
  markAccountCooldown(accountId: string, status?: number, model?: string): void {
    accountRuntime.recordFailure(accountId, status, Date.now(), model)
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
    // 份额账本与运行时指标同生命周期：重启后不该继续背着上一轮的派发欠债
    dispatchLedger.reset()
    this.sticky.clear()
    this.seed = 0
  }
}

export const autoRouter = new AutoRouter()
export default autoRouter
