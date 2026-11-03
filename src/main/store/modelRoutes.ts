/**
 * 多路由（`AppConfig.routes`）的归一化、一次性迁移与请求解析。
 *
 * 为什么在 store 层而不是 `proxy/autoRouting.ts`：`autoRouting.ts` 是纯决策层
 * （不读 store、不认识 `auto` 这个名字），路由概念只允许出现在它外面这一层。
 * 本文件同样不 import electron，所以 `node --test` 可以直接钉住迁移与归一语义。
 *
 * 三条不可变规则：
 * - 每个函数都返回**新对象/新数组**，绝不原地改入参（AGENTS.md CRITICAL）；
 * - 读取侧（`normalizeModelRoutes`）遇到非法条目**安全丢弃**，绝不抛异常 ——
 *   一次手坏的 data.json 不能把整个 config 读挂（那会让代理起不来）；
 * - 写入侧（`checkRouteName` / `validateRoutesForWrite`）返回**可读错误**，
 *   IPC 与管理 API 共用同一套错误码。
 */
import type {
  AutoPoolStrategy,
  AutoPreference,
  AutoRoutingConfig,
  LoadBalanceStrategy,
  ModelRoute,
  RouteModelRef,
} from '../../shared/types.ts'
import { isAutoPoolStrategyId, FAIRNESS_LEAD_MAX } from '../../shared/types.ts'
import { normalizeAutoRoutingConfig } from './autoRoutingConfig.ts'
import type { ModelRouteError } from '../../shared/modelRouteName.ts'
import {
  canonicalRouteName,
  findRouteNameConflict,
  isCanonicalRouteName,
  validateRouteNameInput,
} from '../../shared/modelRouteName.ts'

/** 迁移生成的那条路由的名字：legacy 单 `auto` 模型降级为一条普通可编辑可删除的路由。 */
export const LEGACY_AUTO_ROUTE_NAME = 'auto'

/** 路由缺省打分口径：与 `DEFAULT_CONFIG.loadBalanceStrategy`、`rankCandidates` 同值。 */
const DEFAULT_ROUTE_STRATEGY: LoadBalanceStrategy = 'round-robin'

const LOAD_BALANCE_STRATEGIES: readonly LoadBalanceStrategy[] = [
  'round-robin',
  'fill-first',
  'failover',
  'smart',
  'pace',
]

/**
 * 写入侧的 `strategy` 校验。读取侧对非法值一律回落（见 `strategyOf`），但新建/编辑
 * 时静默回落等于「选了 pace、存下来变成 round-robin」。
 * ⚠️ 与 `prefer` 有意不同：`prefer` 的「未知即回落 balanced」是既有契约
 * （tests/store/auto-routing-config.test.ts 钉着），逐路由复用时必须保持同一兜底。
 */
export function isRouteStrategyValue(value: unknown): value is LoadBalanceStrategy {
  return typeof value === 'string' && LOAD_BALANCE_STRATEGIES.includes(value as LoadBalanceStrategy)
}

export interface NormalizeRoutesOptions {
  /**
   * 路由没写或写了非法 `strategy` 时回落到的口径。调用方传
   * `config.loadBalanceStrategy`：那正是今天 `auto` 用的打分口径，
   * 于是「手坏的 strategy」不会把请求打到另一个权重表上。
   */
  fallbackStrategy?: LoadBalanceStrategy
}

function strategyOf(raw: unknown, options: NormalizeRoutesOptions): LoadBalanceStrategy {
  if (typeof raw === 'string' && LOAD_BALANCE_STRATEGIES.includes(raw as LoadBalanceStrategy)) {
    return raw as LoadBalanceStrategy
  }
  return options.fallbackStrategy ?? DEFAULT_ROUTE_STRATEGY
}

/** 单条手动增删引用的上限：够覆盖整个目录，又不给手写 data.json 留无限增长的余地 */
const MAX_MANUAL_MODEL_REFS = 2000

/**
 * 归一一条路由的手工增删列表。规则与其它字段相反：**非法条目整条丢弃**而不是
 * 补默认值 —— 一条 `{providerId: '', displayName: ''}` 补成什么都只会指向错误模型。
 * 去重按 `providerId + displayName` 的大小写不敏感形式，保留第一次出现的大小写
 * （展示名是对上游模型表的精确键，不能因为去重被改小写）。
 */
export function normalizeRouteModelRefs(input: unknown): RouteModelRef[] {
  if (!Array.isArray(input)) return []

  const out: RouteModelRef[] = []
  const seen = new Set<string>()
  for (const entry of input as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const rawProvider = (entry as { providerId?: unknown }).providerId
    const rawName = (entry as { displayName?: unknown }).displayName
    if (typeof rawProvider !== 'string' || typeof rawName !== 'string') continue
    const providerId = rawProvider.trim()
    const displayName = rawName.trim()
    if (providerId.length === 0 || displayName.length === 0) continue

    const key = `${providerId.toLowerCase()}\u0000${displayName.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ providerId, displayName })
    if (out.length >= MAX_MANUAL_MODEL_REFS) break
  }
  return out
}

/**
 * 写入侧的模型引用校验（`pinModels` / `includeModels` / `excludeModels` 同一口径）：
 * 只校验**结构**，不校验模型是否还存在。
 *
 * 不按目录拒绝的理由：一条路由可能引用了用户刚刚停用的模型，若按目录拒绝，
 * 之后任何一次无关的编辑都会因为这条陈旧引用而永久 400。真正取不回的引用
 * 由候选池预览列为 `unresolved`，用户在那里删掉即可。
 */
export function checkRouteModelRefs(
  field: 'pinModels' | 'includeModels' | 'excludeModels',
  input: unknown
): ModelRouteError | undefined {
  if (input === undefined) return undefined
  if (!Array.isArray(input)) {
    return { code: 'invalid_input', message: `Route field '${field}' must be an array` }
  }
  for (const entry of input as unknown[]) {
    const providerId = (entry as { providerId?: unknown } | null)?.providerId
    const displayName = (entry as { displayName?: unknown } | null)?.displayName
    if (typeof providerId !== 'string' || providerId.trim().length === 0
      || typeof displayName !== 'string' || displayName.trim().length === 0) {
      return {
        code: 'invalid_input',
        message: `Route field '${field}' entries need a non-empty providerId and displayName`,
      }
    }
  }
  return undefined
}

/**
 * 逐条归一：per-route 字段一律走既有的 `normalizeAutoRoutingConfig`，
 * 保持与 legacy **同一兜底**（maxAttempts 1–5、stickyMinutes 0–1440、
 * 未知 prefer→balanced、非法 pool strategy id 剔除、undefined→出厂默认）。
 * 这里不复用它的 `enabled`：那是 legacy 的「auto 模型开关」，与路由的启用位语义不同。
 */
/**
 * 份额轮转领先档（`ModelRoute.fairnessLead`）的归一。
 *
 * 非法值返回 `undefined` 而不是出厂默认：这个字段与 `stickyHardPin` 同形，「没配」
 * 必须保持不落键，读侧才有唯一的默认落点（`shared/types.ts::DEFAULT_FAIRNESS_LEAD`）。
 * 上界夹到 `FAIRNESS_LEAD_MAX`，因为领先档每加 1，把全池转一圈要的请求数就翻倍。
 */
function normalizeFairnessLead(input: unknown): number | undefined {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < 0) return undefined
  return Math.min(FAIRNESS_LEAD_MAX, Math.round(input))
}

function normalizeRouteFields(name: string, entry: Record<string, unknown>, options: NormalizeRoutesOptions): ModelRoute {
  // 只把**存在**的键交给归一化：缺省键要落到 `normalizeAutoRoutingConfig` 自己的
  // 出厂默认（`{...DEFAULT, ...input}`），写成 `maxAttempts: undefined` 会把默认值
  // 覆盖成 undefined，然后靠 Number(undefined)→NaN 分支兜住 —— 那就不再是同一条兜底路径。
  const auto = normalizeAutoRoutingConfig({
    ...(entry.maxAttempts !== undefined ? { maxAttempts: entry.maxAttempts } : {}),
    ...(entry.stickyMinutes !== undefined ? { stickyMinutes: entry.stickyMinutes } : {}),
    ...(entry.prefer !== undefined ? { prefer: entry.prefer } : {}),
    ...(entry.poolStrategies !== undefined ? { poolStrategies: entry.poolStrategies } : {}),
  } as Partial<AutoRoutingConfig>)

  const basedOn = canonicalRouteName(entry.basedOnRoute)
  // 份额轮转的领先档：非数或负数按「没配」处理（读侧回落到出厂默认），合法值取整并夹到
  // `FAIRNESS_LEAD_MAX`。这里不落出厂默认值是有意的：`fairnessLead` 与 `stickyHardPin`
  // 同形，缺省键不进 Record，盘上每条路由才不会多出这一格。
  const fairnessLead = normalizeFairnessLead(entry.fairnessLead)

  return {
    name,
    enabled: entry.enabled !== false,
    strategy: strategyOf(entry.strategy, options),
    prefer: auto.prefer,
    maxAttempts: auto.maxAttempts,
    stickyMinutes: auto.stickyMinutes,
    poolStrategies: auto.poolStrategies,
    // 缺省键归一成空数组而不是 `undefined`：读侧每条路由同形，消费方不用区分
    // 「没配手动增删」与「配了空列表」。
    includeModels: normalizeRouteModelRefs(entry.includeModels),
    excludeModels: normalizeRouteModelRefs(entry.excludeModels),
    pinModels: normalizeRouteModelRefs(entry.pinModels),
    // 只在显式关掉时落键：缺省即硬钉（见 `ModelRoute.stickyHardPin`）。把「没配」也归一成
    // `true` 会让盘上每条路由多出这一格，而读侧两处判断（`!== false`）本来就同形。
    ...(entry.stickyHardPin === false ? { stickyHardPin: false } : {}),
    ...(fairnessLead === undefined ? {} : { fairnessLead }),
    // 引用只认规范名，且**不许引用自己**：手坏的盘上留一个自引用就会让「取池」这一步
    // 无限递归，写入侧本来拒绝，读侧再兜一层保证不 500。
    ...(basedOn.length > 0 && basedOn !== name ? { basedOnRoute: basedOn } : {}),
  }
}

/**
 * 读取侧归一（`normalizeConfig` 调用）。规则：
 * - 入参不是对象 → `{}`（首次迁移由调用方负责，见 `routesFromLegacyAutoRouting`）；
 * - **键即名字**：存储键规范化后必须还是它自己且落在 `[a-z0-9_-]{1,64}`，否则整条丢弃；
 *   `name` 字段与键不一致时以键为准并把 `name` 修成键 —— 请求解析、/v1/models、
 *   sticky 键都按「键 == name」读，留着两套写法就会分叉；
 * - 大小写不敏感重复 → 保留**排序后靠前**的那个（不依赖 Record 的插入顺序：
 *   纯数字名如 `2026` 会被 JS 整数键提升而先迭代）；
 * - 逐条字段归一，非法值走兜底而不是丢整条；
 * - 不查模型目录：路由名与同名模型的冲突按「路由优先」处理，不是丢弃路由。
 */
export function normalizeModelRoutes(
  input: unknown,
  options: NormalizeRoutesOptions = {}
): Record<string, ModelRoute> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}

  const entries = input as Record<string, unknown>
  const out: Record<string, ModelRoute> = {}

  for (const rawKey of Object.keys(entries).sort((a, b) => a.localeCompare(b))) {
    const key = canonicalRouteName(rawKey)
    if (!isCanonicalRouteName(key) || key !== rawKey) continue

    const entry = entries[rawKey]
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue

    // 重复与非法键都已经按排序取舍：先到先得，后来者丢弃（不静默覆盖用户的一条路由）
    if (out[key] !== undefined) continue

    out[key] = normalizeRouteFields(key, entry as Record<string, unknown>, options)
  }

  return out
}

/**
 * 一次性迁移：legacy `config.autoRouting` → 名为 `auto` 的路由。
 *
 * 判据在调用方（`store.ts::normalizeConfig`）**看原始存储对象有没有 `routes` 这个键**，
 * 而不是「routes 是不是空」：按空迁移会让用户删光路由后的每一次读取都重新造出 `auto`，
 * 直接违反「删除后这个名字不再被路由」。键一旦存在（哪怕是 `{}`）就永不迁移，
 * 于是这条迁移天然幂等。
 *
 * `enabled` 取 legacy 的开关值：用户关掉过 auto 就不能在升级后被悄悄打开。
 * `strategy` 取当时的 `loadBalanceStrategy`：那正是今天 auto 用的打分口径。
 */
export function routesFromLegacyAutoRouting(
  autoRouting: unknown,
  options: NormalizeRoutesOptions = {}
): Record<string, ModelRoute> {
  const legacy = normalizeAutoRoutingConfig(
    (autoRouting && typeof autoRouting === 'object' ? autoRouting : {}) as Partial<AutoRoutingConfig>
  )

  return {
    [LEGACY_AUTO_ROUTE_NAME]: normalizeRouteFields(
      LEGACY_AUTO_ROUTE_NAME,
      {
        enabled: legacy.enabled,
        prefer: legacy.prefer,
        maxAttempts: legacy.maxAttempts,
        stickyMinutes: legacy.stickyMinutes,
        poolStrategies: legacy.poolStrategies,
      },
      options
    ),
  }
}

/**
 * 「预设路由」的一次性播种表：两类来源，同一套建法与判据。
 *
 * 1. **协议路由**（`kind: 'protocol'`）：R2 之后 `/v1/models` 只广告**启用中的路由名**，
 *    只会说某套入站协议的客户端（Codex 的 Responses）需要有一个属于自己的名字。
 * 2. **档位路由**（`kind: 'tier'`）：`/v1/chat` 的调用方按「日常 / 稳定 / 性能」选一条。
 *    档位的定义就是它的 `poolStrategies` + `prefer`：日常＝免费档模型，稳定＝账号渠道
 *    （消耗渠道配额，不花聚合的钱），性能＝强档模型。
 *
 * 判据与 `auto` 那条迁移同一形状：看原始存储对象里的记档键**有没有记过这个名字**，
 * 不看路由表是否为空 —— 用户删掉以后不许每次读取都重新造出来。
 */
export interface PresetRouteSeed {
  /** 规范名（`[a-z0-9_-]{1,64}`）；既是记档用的键，也是客户端填的 `model`。 */
  name: string
  /** 两类来源只影响文档与日志口径，不参与任何判定。 */
  kind: 'protocol' | 'tier'
  /** 只为日志与界面可读：不参与任何判定。 */
  label: string
  /**
   * 覆盖 `auto` 的池策略。
   *
   * 协议路由**不设**（沿用 auto 的池）：能力档是严格判据（未标注即淘汰，见
   * `autoRouting.ts::STRATEGY_PREDICATES`），拿它当出厂值会让一个还没同步过能力的
   * 安装立刻广告一条必 503 的死名字。
   *
   * 档位路由**必须设**：档位的定义就是它的筛选。空池在这里是用户看得见的既有状态
   * （`/v1/models` 照旧广告 + 路由卡片的空池警示），不是被出厂值掩盖的缺席。
   */
  poolStrategies?: AutoPoolStrategy[]
  /** 覆盖 `auto` 的优化目标；只有档位路由需要。 */
  prefer?: AutoPreference
}

export const PRESET_ROUTE_SEEDS: readonly PresetRouteSeed[] = [
  { name: 'codex', kind: 'protocol', label: 'Codex（Responses 入站）' },
  {
    name: 'daily',
    kind: 'tier',
    label: '日常（免费档模型）',
    poolStrategies: [{ id: 'free-only', operator: 'and' }],
    prefer: 'cheap',
  },
  {
    name: 'stable',
    kind: 'tier',
    label: '稳定（账号渠道额度）',
    poolStrategies: [{ id: 'channel-only', operator: 'and' }],
    prefer: 'balanced',
  },
  {
    name: 'performance',
    kind: 'tier',
    label: '性能（强档模型）',
    poolStrategies: [{ id: 'strong-tier', operator: 'and' }],
    prefer: 'strong',
  },
]

/**
 * 播种判据：记档键里**没记过**的名字才要处理。
 *
 * 判据不看路由表是否为空（删光以后每次读取都重新造出来，等于出厂值推翻「这个名字
 * 不再被路由」），也不看 `routes` 键存不存在（那是 `auto` 那条迁移的判据，两回事）。
 * `recorded` 是磁盘原值，可能是 undefined、非数组、或混着手写的怪值，所以这里只做
 * 「是不是字符串数组 + 包不包含」，不修脏数据（那是 `normalizeConfig` 的活）。
 */
export function pendingPresetRouteSeeds(recorded: unknown): PresetRouteSeed[] {
  const done = Array.isArray(recorded)
    ? recorded.filter((entry): entry is string => typeof entry === 'string')
    : []
  return PRESET_ROUTE_SEEDS.filter(seed => !done.includes(seed.name))
}

/**
 * 播种出来的那条路由长什么样：**除名字与档位自己的覆盖项以外，全部沿用 `auto`**。
 *
 * `enabled` 沿用 `auto`：用户关掉过 auto 就不该在升级后被悄悄打开（与那条迁移同一裁定）。
 */
export function presetRouteFields(
  auto: ModelRoute | undefined,
  legacy: AutoRoutingConfig,
  fallbackStrategy: LoadBalanceStrategy,
  seed: PresetRouteSeed
): Partial<ModelRoute> {
  return {
    enabled: auto?.enabled ?? legacy.enabled,
    strategy: auto?.strategy ?? fallbackStrategy,
    prefer: seed.prefer ?? auto?.prefer ?? legacy.prefer,
    maxAttempts: auto?.maxAttempts ?? legacy.maxAttempts,
    stickyMinutes: auto?.stickyMinutes ?? legacy.stickyMinutes,
    // 与 `stickyMinutes` 同一条继承规则：种子路由跟着 `auto` 那一条走，用户关过硬钉
    // 就不该在下次播种时被悄悄打开。写成布尔即可 —— 归一化只保留显式 `false`。
    stickyHardPin: auto?.stickyHardPin !== false,
    // 份额轮转跟着 `auto` 那条走，同 `stickyHardPin` 一条继承规则；没配过就不落键，
    // 让读侧的出厂默认（`DEFAULT_FAIRNESS_LEAD`）保持唯一落点。
    ...(auto?.fairnessLead !== undefined ? { fairnessLead: auto.fairnessLead } : {}),
    poolStrategies: seed.poolStrategies ?? auto?.poolStrategies ?? legacy.poolStrategies,
    // 不钉名：钉谁只能来自用户目录里真实存在的 (providerId, displayName)。
    pinModels: [],
    includeModels: [],
    excludeModels: [],
  }
}

/**
 * 请求解析：把 `request.model` 解析成一条路由（大小写不敏感、trim）。
 *
 * 返回**不看 `enabled`** 的那一条：停用名要能被上层认出并给出可读错误，
 * 而不是掉进「按普通模型名解析 → 503 no_available_account」那条完全无关的分支。
 * 广告位（`/v1/models`）用的是 `enabledModelRoutes()`，那里才过滤。
 *
 * 优先级：路由名 **优先于** 同名模型（与今天 `auto` 的判定顺序一致）。
 */
export function findModelRoute(
  routes: Record<string, ModelRoute> | undefined,
  requestedModel: unknown
): ModelRoute | undefined {
  if (!routes) return undefined
  const name = canonicalRouteName(requestedModel)
  if (name.length === 0) return undefined

  const direct = routes[name]
  if (direct !== undefined && direct.name === name) return direct

  for (const route of Object.values(routes)) {
    if (route === undefined) continue
    if (canonicalRouteName(route.name) === name) return route
  }
  return undefined
}

/**
 * 全部路由（含停用的），按名字排序 —— `routes:list` 的返回值。
 * 排序理由与 `enabledModelRoutes` 相同：不许依赖 Record 的迭代顺序。
 */
export function allModelRoutes(routes: Record<string, ModelRoute> | undefined): ModelRoute[] {
  if (!routes) return []
  return Object.values(routes)
    .filter((route): route is ModelRoute => route !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * 在服的路由，按名字排序 —— `/v1/models` 的广告位顺序必须稳定，
 * 所以这里显式排序，不依赖 Record 的迭代顺序（整数键提升会让 `2026` 排到最前）。
 */
export function enabledModelRoutes(routes: Record<string, ModelRoute> | undefined): ModelRoute[] {
  if (!routes) return []
  return Object.values(routes)
    .filter((route): route is ModelRoute => route !== undefined && route.enabled)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** 池引用解不开的原因（三种都要能分别说清，不许合并成一句「路由不可用」）。 */
export type RoutePoolBreakReason =
  /** 被引用的路由不存在（删掉了，或手坏的盘） */
  | 'missing'
  /** 被引用的路由已停用 */
  | 'disabled'
  /** 被引用的路由自己也带引用 —— 写入侧禁止，读侧到此为止，不递归 */
  | 'nested'

export type RoutePoolResolution =
  | { ok: true; route: ModelRoute }
  | { ok: false; route: ModelRoute; reason: RoutePoolBreakReason }

/**
 * 解开一跳池引用：`basedOnRoute` 存在时，「怎么选模型」全部取自被引用的那条路由，
 * 名字与启用位仍是本路由的 —— 响应头 `X-ModelPort-Route-Name`、sticky 键、请求日志里的
 * 路由名都必须是用户点名的那一个，否则「客户端选了 A、日志说 B」。
 *
 * 只解一跳，且引用链在写入侧就被限制成一跳，所以这里不需要环检测。
 */
export function resolvePoolRoute(
  routes: Record<string, ModelRoute> | undefined,
  route: ModelRoute
): RoutePoolResolution {
  const target = route.basedOnRoute
  if (target === undefined || target === '') return { ok: true, route }

  const referenced = routes?.[target]
  if (referenced === undefined) return { ok: false, route, reason: 'missing' }
  if (!referenced.enabled) return { ok: false, route, reason: 'disabled' }
  if (referenced.basedOnRoute !== undefined) return { ok: false, route, reason: 'nested' }

  return { ok: true, route: { ...referenced, name: route.name, enabled: route.enabled } }
}

/**
 * 池引用断掉时给客户端的那句话。两条入口共用一种说法，措辞只在这里定一次：
 * 用户要知道的是「这条路由的池来自哪条、那条现在怎么了」，不是又一句「不可用」。
 */
export function routePoolBreakMessage(route: ModelRoute, reason: RoutePoolBreakReason): string {
  const target = route.basedOnRoute ?? ''
  switch (reason) {
    case 'missing':
      return `Route '${route.name}' takes its pool from '${target}', which no longer exists`
    case 'disabled':
      return `Route '${route.name}' takes its pool from '${target}', which is disabled`
    case 'nested':
      return `Route '${route.name}' takes its pool from '${target}', which takes its own pool from another route (only one hop is allowed)`
  }
}

/** 一次请求对路由表的判定结果（chat / completions 两条入口共用）。 */
export type RouteRequestOutcome =
  /** 命中且在服：按这条路由跑 */
  | { kind: 'routable'; route: ModelRoute }
  /** 命中但已停用：必须是可读的「路由已停用」，不能掉进具名模型路径 */
  | { kind: 'disabled'; route: ModelRoute }
  /** 命中且在服，但它引用的那条池来源没了/停了/二级引用：点名原因，不许静默回落 */
  | { kind: 'broken-reference'; route: ModelRoute; reason: RoutePoolBreakReason }
  /** 这不是一个（在服或已停用的）路由名：按普通模型名解析（映射、聚合链、具名账号） */
  | { kind: 'not-a-route' }

/**
 * 请求解析的门禁：路由名 **优先于** 同名模型，判定顺序与错误可读性都在这里定一次，
 * 两条入口（`/v1/chat/completions`、`/v1/completions`）不许各写一套。
 *
 * 表里查不到就是 `not-a-route`，**保留虚拟名也不例外**（今天只有 legacy 的 `auto`）。
 * 这是拍板过的语义：删除 `auto` 之后 `/v1/models` 不再广告它，`model="auto"` 退回
 * 普通模型名解析 —— 没有同名模型时拿到的是既有的未知模型错误（具名路径的
 * `503 no_available_account`），不是新的 404，也不是 500。
 *
 * 为什么不在这里为保留名另立一条「路由不存在」分支（本文件曾有过 `missing` 那一条）：
 * - `code: 'route_not_found'` 已经是 **URL 路径没挂载** 的意思
 *   （`proxy/routeErrorPolicy.ts`，被 `tests/api/route-error-policy.test.ts`、
 *   `tests/api/rejection-log.test.ts` 钉着，与模型名无关）。同一个 code 装两种语义，
 *   客户端按 code 分流时必然踩串，所以这两个语义不许共存于一个 code；
 * - 「保留名删不掉就等于回退 legacy 全局 `autoRouting`」这个担忧与本分支无关：
 *   回退的唯一入口是 `autoRouter.select()` 的 `route ?? legacy` 兜底，而调用方只在
 *   outcome 为 `routable` 时才进 auto 路由（见 chat.ts / completions.ts 的
 *   `route = kind === 'routable' ? route : undefined`）。`not-a-route` 根本不走那一步。
 *
 * 保留的是 `disabled`：存在但被用户停用的名字仍然给可读错误（`route_disabled`），
 * 不许退化成无关的 `no_available_account`。
 */
export function resolveRouteRequest(
  routes: Record<string, ModelRoute> | undefined,
  requestedModel: unknown
): RouteRequestOutcome {
  const route = findModelRoute(routes, requestedModel)
  if (route !== undefined) {
    if (!route.enabled) return { kind: 'disabled', route }
    const pool = resolvePoolRoute(routes, route)
    return pool.ok
      ? { kind: 'routable', route: pool.route }
      : { kind: 'broken-reference', route, reason: pool.reason }
  }

  return { kind: 'not-a-route' }
}

/** 写入校验的上下文：谁占着名字、表里已有什么。 */
export interface RouteNameContext {
  /** 正在持久化的路由表（改名的那条已通过 `excluding` 排除） */
  routes: Record<string, ModelRoute>
  /** 所有供应商目录里的展示名（**含已停用但仍在目录里的**）与供应商内部映射名 */
  modelNameOccupants: string[]
  /** 全局 `config.modelMappings` 的键（用户自建别名） */
  aliasOccupants: string[]
  /** 新建/编辑时的规范名 */
  name: string
  /** 改名时旧的规范名；新建时省略 */
  excluding?: string
}

/**
 * 单个名字的写入校验：字符集 → routes 内唯一 → 模型名冲突 → 别名冲突。
 * 顺序有意如此：字符集不过就别提其他（错误文案要指对问题）。
 */
export function checkRouteName(context: RouteNameContext): ModelRouteError | undefined {
  const validated = validateRouteNameInput(context.name)
  if (!validated.ok) return validated.error

  const { name } = validated
  const excluding = canonicalRouteName(context.excluding ?? '')

  for (const existing of Object.values(context.routes)) {
    if (existing === undefined) continue
    const existingName = canonicalRouteName(existing.name)
    if (existingName.length === 0 || existingName === excluding) continue
    if (existingName === name) {
      return { code: 'duplicate_name', message: `A route named '${name}' already exists` }
    }
  }

  const modelHit = findRouteNameConflict(name, context.modelNameOccupants)
  if (modelHit !== undefined) {
    return {
      code: 'conflicts_model',
      message: `Route name '${name}' collides with the served model '${modelHit}'`,
    }
  }

  const aliasHit = findRouteNameConflict(name, context.aliasOccupants)
  if (aliasHit !== undefined) {
    return {
      code: 'conflicts_alias',
      message: `Route name '${name}' collides with the model alias '${aliasHit}'`,
    }
  }

  return undefined
}

/**
 * 写入侧的池策略校验：读取侧丢掉非法 id 就够了，但**新建/编辑**时用户是明确点了
 * 「保存」的，静默丢掉就是「我明明勾了三项怎么只剩两项」。非法 id 报可读错误。
 */
export function checkPoolStrategyIds(input: unknown): ModelRouteError | undefined {
  if (input === undefined) return undefined
  if (!Array.isArray(input)) {
    return { code: 'invalid_input', message: "Route field 'poolStrategies' must be an array" }
  }
  for (const entry of input as unknown[]) {
    const id = (entry as { id?: unknown } | null)?.id
    if (typeof id !== 'string' || !isAutoPoolStrategyId(id)) {
      return { code: 'unknown_pool_strategy', message: `Unknown pool strategy id: ${JSON.stringify(id)}` }
    }
  }
  return undefined
}

/** 表里已经存在的规范名：这些是「已生效」的名字，不再拿同名模型去拒绝。 */
function persistedRouteNames(routes: Record<string, ModelRoute> | undefined): Set<string> {
  const names = new Set<string>()
  for (const route of Object.values(routes || {})) {
    const name = canonicalRouteName(route?.name)
    if (name.length > 0) names.add(name)
  }
  for (const key of Object.keys(routes || {})) {
    const name = canonicalRouteName(key)
    if (name.length > 0) names.add(name)
  }
  return names
}

/**
 * 整表写入校验（管理 API `PUT /v1/management/config[/:key]` 与 IPC 共用）。
 *
 * 只拒绝**结构非法**与**新出现**的名字冲突：已经在表里的名字是「已生效的路由」，
 * 之后同步进来一个同名模型不改变它的行为（请求解析按路由优先），所以不能因此
 * 让每一次配置写入永久 400。
 *
 * 名字规则与 `routes:*` IPC 同源（同一个 `validateRouteNameInput`），并且把
 * 「键必须等于其规范形」升级为硬校验：读侧会丢弃非规范键（脏盘容错，不许削弱），
 * 写侧若放行它们就是「200 成功 + 条目凭空消失」。trim+小写后的规范形与输入不同
 * （`Auto`、` Fast `）→ 400，消息里带具体键与它的规范形。
 */
export function validateRoutesForWrite(
  input: unknown,
  current: Record<string, ModelRoute> | undefined,
  occupants: { modelNames: string[]; aliases: string[] }
): string[] {
  const errors: string[] = []

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return ['routes must be an object keyed by route name']
  }

  const known = persistedRouteNames(current)
  const entries = input as Record<string, unknown>

  for (const rawKey of Object.keys(entries).sort((a, b) => a.localeCompare(b))) {
    const validated = validateRouteNameInput(rawKey)
    if (!validated.ok) {
      errors.push(`routes.${JSON.stringify(rawKey)}: ${validated.error.message}`)
      continue
    }
    // 键必须**等于其规范形**：`routes:*` IPC 在落盘前就规范化（键天生是规范形），而读取侧
    // (`normalizeModelRoutes`) 会把「键 != canonicalRouteName(键)」的条目静默丢弃。整表写
    // 若不拒这一步，`Auto`/`a b` 这类键就会「保存成功但列表里永远没有」——写侧与读侧必须
    // 共用同一套名字规则，这里就是共用的那一条硬校验（消息点名具体键并给出规范形）。
    if (validated.name !== rawKey) {
      errors.push(
        `routes.${JSON.stringify(rawKey)}: the key must equal its canonical name '${validated.name}' ` +
        '(trimmed and lowercase; non-canonical keys are dropped by the reader)'
      )
      continue
    }
    const name = validated.name

    const entry = entries[rawKey]
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`routes.${name}: must be an object`)
      continue
    }

    const record = entry as Record<string, unknown>
    const entryName = canonicalRouteName(record.name)
    if (entryName.length > 0 && entryName !== name) {
      errors.push(`routes.${name}: its 'name' field ('${record.name}') must match the key`)
    }
    if (record.enabled !== undefined && typeof record.enabled !== 'boolean') {
      errors.push(`routes.${name}: 'enabled' must be a boolean`)
    }
    if (record.strategy !== undefined && !isRouteStrategyValue(record.strategy)) {
      errors.push(`routes.${name}: 'strategy' must be one of ${LOAD_BALANCE_STRATEGIES.join(', ')}`)
    }
    if (record.poolStrategies !== undefined) {
      if (!Array.isArray(record.poolStrategies)) {
        errors.push(`routes.${name}: 'poolStrategies' must be an array`)
      } else {
        for (const strategy of record.poolStrategies as unknown[]) {
          const id = (strategy as { id?: unknown } | null)?.id
          if (typeof id !== 'string' || !isAutoPoolStrategyId(id)) {
            errors.push(`routes.${name}: unknown pool strategy id ${JSON.stringify(id)}`)
          }
        }
      }
    }
    for (const field of ['pinModels', 'includeModels', 'excludeModels'] as const) {
      const refError = checkRouteModelRefs(field, record[field])
      if (refError !== undefined) {
        errors.push(`routes.${name}: ${refError.message}`)
      }
    }

    // 池引用的三条硬规则在这里定一次：目标必须是已存在的规范名、不能自引用、只能一跳。
    // 「只能一跳」是环检测的替代品 —— 链长上限 1 就不可能成环，读侧因此不必递归。
    const basedRaw = record.basedOnRoute
    if (typeof basedRaw === 'string' && basedRaw.trim() !== '') {
      const based = canonicalRouteName(basedRaw)
      if (based.length === 0 || based !== basedRaw.trim()) {
        errors.push(`routes.${name}: 'basedOnRoute' must be an existing canonical route name`)
      } else if (based === name) {
        errors.push(`routes.${name}: 'basedOnRoute' cannot reference itself`)
      } else if (!known.has(based) && entries[based] === undefined) {
        errors.push(`routes.${name}: 'basedOnRoute' references the unknown route '${based}'`)
      } else {
        const targetIncoming = entries[based] as Record<string, unknown> | undefined
        const targetBased = canonicalRouteName(
          targetIncoming?.basedOnRoute ?? current?.[based]?.basedOnRoute,
        )
        if (targetBased.length > 0) {
          errors.push(
            `routes.${name}: pool references are one hop only; '${based}' already references '${targetBased}'`,
          )
        }
      }
    }

    if (known.has(name)) continue

    const modelHit = findRouteNameConflict(name, occupants.modelNames)
    if (modelHit !== undefined) {
      errors.push(`routes.${name}: collides with the served model '${modelHit}'`)
      continue
    }
    const aliasHit = findRouteNameConflict(name, occupants.aliases)
    if (aliasHit !== undefined) {
      errors.push(`routes.${name}: collides with the model alias '${aliasHit}'`)
    }
  }

  const lowercased = new Map<string, string>()
  for (const key of Object.keys(entries)) {
    const name = canonicalRouteName(key)
    if (name.length === 0) continue
    const previous = lowercased.get(name)
    if (previous !== undefined && previous !== key) {
      errors.push(`routes.${key}: duplicates routes.${previous} (names compare case-insensitively)`)
    }
    lowercased.set(name, key)
  }

  return errors
}

/**
 * 组装一次写入后的新表（CRUD 与 `PUT /v1/management/config` 共用）。
 *
 * `base` 是现有表（**已经归一**）、`incoming` 是这次提交的表：同名条目按
 * 字段合并（PATCH 语义，路由的池策略整体替换而不是追加），随后再过一遍归一，
 * 因此返回的表与读取侧归一的结果完全同形 —— 落盘与读出不会再有两个版本。
 */
export function mergeRouteTables(
  base: Record<string, ModelRoute>,
  incoming: Record<string, ModelRoute>
): Record<string, ModelRoute> {
  const merged: Record<string, ModelRoute> = { ...base }

  for (const [key, route] of Object.entries(incoming)) {
    const name = canonicalRouteName(key)
    if (!isCanonicalRouteName(name)) continue
    const previous = merged[name]
    merged[name] = previous === undefined
      ? { ...route, name }
      : {
          ...previous,
          ...route,
          name,
          poolStrategies: route.poolStrategies ?? previous.poolStrategies,
          // 手动增删是「整表替换」的列表，不是可拼接的集合：省略表示沿用，
          // 空数组表示用户清空了它 —— 这两种必须能区分。
          includeModels: route.includeModels ?? previous.includeModels,
          excludeModels: route.excludeModels ?? previous.excludeModels,
        }
  }

  return merged
}
