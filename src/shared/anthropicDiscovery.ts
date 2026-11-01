/**
 * Anthropic 客户端（Claude Desktop / Claude Code）模型发现的**可发现名**生成规则。
 *
 * 为什么需要这一层：Anthropic 客户端在 gateway 模式下会按 Anthropic 自己的名字表筛
 * `/v1/models` 的每一行（本机装的 Claude Desktop 4.4212 安装里那段解析代码就是
 * `!Fo(t.id) && !n ? [] : [...]`，`n` 是 `anthropic_family_tier`），新版进一步把它
 * 收成「只保留以 `claude` / `anthropic` 开头的 id」。本网关的模型名是
 * `<条目>/<模型>` 这种形态（`llm7/claude-opus-5`、`zai/glm-5`），所以同一个**真实
 * Claude 模型**会因为条目前缀而被客户端整行丢掉。
 *
 * 为什么生成的是**路由**而不是别名：`/v1/models` 现在只广告路由（见 `AGENTS.md`
 * 「advertises routes only」），别名再也不会出现在客户端的清单里。而一条叫
 * `claude-opus-5` 的路由必须**钉死**它服务的模型 —— `poolStrategies: []` 的语义是
 * 「不过滤」＝全目录，那样客户端写着 Opus、实际可能跑国产模型，正是本仓「不许把
 * 拿不到装成正常结果」禁止的形态。钉定用的是 `ModelRoute.pinModels`（与
 * `includeModels` 同一套引用形状），所以这里生成的每条路由自带候选池。
 *
 * 名字一律取自数据里**本来就存在**的 Anthropic id（目录展示名本身、上游 id、或
 * `<条目>/<模型>` 的叶子段），绝不凭空造 `claude-my-favorite` 这种客户端认不出、
 * 也说明不了任何东西的名字。含点号或斜杠的 Anthropic id（`claude-opus-4.8`、
 * `anthropic/claude-haiku-4.5`）过不了路由名字符集 `[a-z0-9_-]{1,64}` —— 那不是可以
 * 绕的格式问题，是路由名要进 `X-ModelPort-Route-Name` 响应头的硬约束，逐条报出来。
 */
import { isCanonicalRouteName } from './modelRouteName.ts'
import type { RouteModelRef } from './types.ts'

/** 客户端白名单接受的前缀（大小写不敏感；比较前一律转小写）。 */
export const ANTHROPIC_DISCOVERABLE_PREFIXES = ['claude', 'anthropic'] as const

/**
 * 一个模型名能不能被 Anthropic 客户端发现。
 *
 * 只看**发出去的那个 id**：客户端先按 Anthropic 的名字表筛（新版收成前缀筛），
 * 所以 `llm7/claude-opus-5` 这种带条目前缀的名字即使含 `claude` 也不算。
 */
export function isDiscoverableForAnthropicClients(name: string): boolean {
  const lower = name.trim().toLowerCase()
  if (lower === '') return false
  return ANTHROPIC_DISCOVERABLE_PREFIXES.some(prefix => lower.startsWith(prefix))
}

/** `<条目>/<模型>` 的叶子段；不含 `/` 时原样返回。 */
function leafOf(displayName: string): string {
  const index = displayName.indexOf('/')
  return index < 0 ? displayName : displayName.slice(index + 1)
}

/** 生成器看到的一家供应商（纯数据，便于测试喂夹具）。 */
export interface DiscoveryProvider {
  id: string
  name: string
  /** 这家有启用中的账号；没有就不该为它造入口（生成了也是必死的名字）。 */
  hasActiveAccount: boolean
  /** 网关对外的模型名 + 它真正发给上游的那个 id（上游 id 未知时省略）。 */
  models: Array<{ displayName: string; upstreamId?: string }>
}

export type AnthropicDiscoverySkipReason =
  | 'no-active-account'
  | 'already-visible'
  | 'route-name-taken'
  | 'mapping-exists'
  | 'name-not-routable'

/** 一条要新建的路由：名字是客户端会发回来的 Anthropic id，`pinModels` 是它的候选池。 */
export interface AnthropicDiscoveryRoute {
  name: string
  pinModels: RouteModelRef[]
  /** 供人核对：这些引用分别来自哪几家。 */
  providerNames: string[]
}

export interface AnthropicDiscoveryPlan {
  create: AnthropicDiscoveryRoute[]
  /** 本来就能被发现的网关名（目录展示名），只报数不生成。 */
  alreadyVisible: string[]
  /** 逐条给原因：客户端那边「列表里少了一家」必须能被解释，不能只有一个数字。 */
  skipped: Array<{ name: string; reason: AnthropicDiscoverySkipReason }>
}

/**
 * IPC `anthropic:discovery-plan|apply` 的返回形状，与 `routes:*` 同风格：
 * 错误原样到达 UI，不许在 IPC 层变成 `undefined`。
 */
export interface AnthropicDiscoveryFailure {
  code: 'storage_unavailable'
  message: string
}

export type AnthropicDiscoveryResult =
  | { ok: true; plan: AnthropicDiscoveryPlan }
  | { ok: false; error: AnthropicDiscoveryFailure }

export type AnthropicRouteApplyResult =
  | {
      ok: true
      created: AnthropicDiscoveryRoute[]
      /** 逐条带原因：一条建不出（名字冲突等）不该让整批回滚。 */
      failed: Array<{ name: string; message: string }>
      plan: AnthropicDiscoveryPlan
    }
  | { ok: false; error: AnthropicDiscoveryFailure }

/**
 * 算出「让 Anthropic 客户端能发现本网关真实 Claude 模型」需要新增哪些路由。
 *
 * 幂等：同名路由已存在、该名字已经能被发现、或名字过不了路由字符集，都不生成。
 * 同一个 Anthropic id 被多家服务时合成**一条**路由，候选池里带上全部几家 —— 那才是
 * 路由该做的事（跨家故障转移），别名做不到。
 */
export function planAnthropicDiscovery(input: {
  providers: DiscoveryProvider[]
  /** 目录里的模型展示名（含已停用的条目带来的名字）—— 路由名不得遮住一个已能用的模型名。 */
  visibleNames: string[]
  /** `config.routes` 的名字。 */
  routeNames: string[]
  /** `config.modelMappings` 的键：路由名与别名冲突会被写入校验拒绝，先在这里报出来。 */
  mappingKeys: string[]
}): AnthropicDiscoveryPlan {
  const lower = (value: string) => value.trim().toLowerCase()
  const visible = new Set(input.visibleNames.map(lower))
  const routes = new Set(input.routeNames.map(lower))
  const mappings = new Set(input.mappingKeys.map(lower))

  const planned = new Map<string, AnthropicDiscoveryRoute>()
  const create: AnthropicDiscoveryRoute[] = []
  const alreadyVisible = new Set<string>()
  const skipped: Array<{ name: string; reason: AnthropicDiscoverySkipReason }> = []
  const reportedSkip = new Set<string>()

  for (const provider of input.providers) {
    for (const model of provider.models) {
      // 候选名只有一个来源、一条顺序：目录名本身就是 Anthropic 写法 → 上游 id →
      // `<条目>/<模型>` 的叶子段。三者都要过前缀判定，过不了就不生成（它不是 Claude
      // 模型，不是一条需要解释的缺席）。
      const candidate = isDiscoverableForAnthropicClients(model.displayName)
        ? model.displayName
        : [model.upstreamId, leafOf(model.displayName)]
            .map(value => (value ?? '').trim())
            .find(isDiscoverableForAnthropicClients)

      if (candidate === undefined) continue

      const key = lower(candidate)

      if (!provider.hasActiveAccount) {
        // 没有可用账号的条目不能生入口：名字进了客户端列表就是必死的候选。
        pushSkip(skipped, reportedSkip, candidate, 'no-active-account')
        continue
      }

      if (candidate === model.displayName) {
        alreadyVisible.add(candidate)
        continue
      }

      if (routes.has(key)) {
        pushSkip(skipped, reportedSkip, candidate, 'route-name-taken')
        continue
      }
      if (visible.has(key)) {
        pushSkip(skipped, reportedSkip, candidate, 'already-visible')
        continue
      }
      if (mappings.has(key)) {
        pushSkip(skipped, reportedSkip, candidate, 'mapping-exists')
        continue
      }
      // 路由名的字符集是硬约束（名字要进 `X-ModelPort-Route-Name` 响应头），
      // 含点号/斜杠的 Anthropic id 因此建不出路由 —— 报出来，让人决定。
      if (!isCanonicalRouteName(key)) {
        pushSkip(skipped, reportedSkip, candidate, 'name-not-routable')
        continue
      }

      const existing = planned.get(key)
      if (existing !== undefined) {
        const ref: RouteModelRef = { providerId: provider.id, displayName: model.displayName }
        planned.set(key, {
          ...existing,
          pinModels: [...existing.pinModels, ref],
          providerNames: existing.providerNames.includes(provider.name)
            ? existing.providerNames
            : [...existing.providerNames, provider.name],
        })
        const index = create.findIndex(route => lower(route.name) === key)
        if (index >= 0) create[index] = planned.get(key) as AnthropicDiscoveryRoute
        continue
      }

      const route: AnthropicDiscoveryRoute = {
        name: key,
        pinModels: [{ providerId: provider.id, displayName: model.displayName }],
        providerNames: [provider.name],
      }
      planned.set(key, route)
      create.push(route)
    }
  }

  return {
    create,
    alreadyVisible: [...alreadyVisible].sort(),
    skipped,
  }
}

/** 同一个名字可能从好几家目录里报上来，原因只记第一次，不刷重复行。 */
function pushSkip(
  skipped: Array<{ name: string; reason: AnthropicDiscoverySkipReason }>,
  reported: Set<string>,
  name: string,
  reason: AnthropicDiscoverySkipReason
): void {
  const key = `${name.toLowerCase()}\u0000${reason}`
  if (reported.has(key)) return
  reported.add(key)
  skipped.push({ name, reason })
}
