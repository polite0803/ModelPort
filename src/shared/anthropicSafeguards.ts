/**
 * Anthropic 服务端 Auto mode 审核（safeguards）的透传协议。
 *
 * Claude Code / Claude Desktop 的 auto mode 会在**同一笔** `/v1/messages` 请求里
 * 让上游对「模型接下来要做的动作」下判断：请求带 `anthropic-beta:
 * dangerous-tool-use-2026-09-03` 头与 body 顶层 `safeguards`，上游在
 * `message_delta` 的 `delta.safeguard_results` 里回一张判决表。两者**成对**出现
 * （官方网关兼容文档原文："the two travel as a pair"）。
 *
 * 为什么要有这个模块：本网关的 `/v1/messages` 是「翻成 chat → 本机回环 → 翻回
 * anthropic」。`safeguards` 在 chat 形状里没有位置，翻译层按白名单把它丢掉；`anthropic-beta`
 * 头也在回环请求里被重建过。结果是客户端永远等不到判决表，退回自己的内置 classifier，
 * 每个受审动作多打一次请求、并按 token 计费（那张「Auto mode switched to its built-in
 * safety check for this session」卡片就是这件事的告示）。
 *
 * 本模块只做**形状与配对**：不进对话、不加提示词、不解释判决内容。判决是上游的判断，
 * 网关的角色是让它原样穿过，且只在「这条链路真能把它送到执行审核的上游」时才搬
 * （判据见 {@link anthropicSafeguardsCapable}，理由见该函数的注释）。
 */

/** beta 头里对应的那个值；请求头与 body 必须成对，缺一个上游就不认。 */
export const ANTHROPIC_SAFEGUARDS_BETA = 'dangerous-tool-use-2026-09-03'

/** 判决条目的 `type`。目前只有这一种，别的原样放行、绝不改写。 */
export const SAFEGUARD_RESULT_TYPE = 'dangerous_tool_use'

/** `anthropic-beta` 头是逗号分隔列表，比较与追加都按成员做。 */
export function hasSafeguardsBeta(header: unknown): boolean {
  if (typeof header !== 'string') return false
  return header
    .split(',')
    .map(part => part.trim().toLowerCase())
    .includes(ANTHROPIC_SAFEGUARDS_BETA)
}

/** 把 safeguards 的 beta 值并进现有头值；已有就不重复追加。 */
export function withSafeguardsBeta(header: unknown): string {
  if (hasSafeguardsBeta(header)) return String(header)
  const existing = typeof header === 'string' ? header.trim() : ''
  return existing === '' ? ANTHROPIC_SAFEGUARDS_BETA : `${existing},${ANTHROPIC_SAFEGUARDS_BETA}`
}

/**
 * 请求体里带没带 `safeguards`。
 *
 * 只认「存在且是对象」：`null` 与标量都算没带。判定存在就原样搬运、不检查内部结构 ——
 * 它的 schema 归上游，网关照抄才不会在下一个字段被加进来时又丢一次。
 */
export function hasSafeguardsField(body: unknown): boolean {
  if (body === null || typeof body !== 'object') return false
  const value = (body as Record<string, unknown>).safeguards
  return value !== null && typeof value === 'object'
}

/**
 * 这条上游链路能不能把 `safeguards` 送到真正执行审核的一方。
 *
 * 判据只有一条：**wire 是 `anthropic-messages` 且聚合条目声明了
 * `serverSideSafeguards`**。不按供应商 id 硬编码，因为「谁跑审核」是上游的事实，
 * 不是网关的猜测；目录里只有 Anthropic 官方条目声明了它。
 *
 * 为什么其它上游一律不搬：`safeguards` 描述的是会话现场（目录路径、用户名、git
 * 状态、权限规则）。发给一个不做审核的第三方，就是把这份现场白送出去换一个必然
 * 不存在的回答；而且严格上游会对未知顶层字段整条 400，那会把一整个回合打不出去。
 * 所以「不能审核 = 不搬」，与本网关既有的「诚实优先于好看」同一口径。
 */
export function anthropicSafeguardsCapable(
  provider: { type?: string; wire?: string; aggregateId?: string } | undefined,
  entry: { serverSideSafeguards?: boolean } | undefined
): boolean {
  if (provider?.type !== 'aggregate') return false
  if (provider.wire !== 'anthropic-messages') return false
  return entry?.serverSideSafeguards === true
}

/**
 * 上游 `message_delta.delta.safeguard_results` 里有没有可读的判决。
 *
 * 只做「有没有」：`safeguard_results` 存在、是非空数组、每项带 `type`。内容原样
 * 交给客户端，这个函数绝不改写它 —— 网关不解释判决，只负责不弄丢。
 */
export function hasSafeguardResults(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false
  return value.every(item => item !== null && typeof item === 'object')
}