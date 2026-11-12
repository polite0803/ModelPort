import type { ChatCompletionRequest } from '../types'

/**
 * 输出上限有两种写法：`max_tokens`（OpenAI 的旧名）与 `max_completion_tokens`（现名）。
 * Codex 系客户端只发后者 —— DSH 的 pi-ai 层按 baseUrl 挑拼法，不在它白名单里的主机
 * 一律用 `max_completion_tokens`，本地代理正是这种主机。
 *
 * 下游没有一处读别名：转发体白名单（`forwarder.buildRequestBody`）、Anthropic wire 的
 * `max_tokens`、responses wire 的 `max_output_tokens` 都只看 `max_tokens`。不折的后果不是
 * 报错，是**上限被静默丢弃**，上游于是按自己的默认值截断（Anthropic wire 用代码里的
 * 4096），客户端看到的只剩一句「已达到输出 token 上限」。
 * 渠道包 worker 本来就两把都读（`max_completion_tokens` 优先），所以账号渠道从不出现这个症状。
 *
 * 优先级与 worker、请求日志同口径：别名优先，两把都给时用别名的值。
 * 只改拼法，不校验、不补默认值 —— 客户端没给上限就不发明一个。
 */
export function normalizeOutputCap<T extends { max_tokens?: number; max_completion_tokens?: number }>(
  request: T,
): T {
  if (request.max_completion_tokens === undefined) return request

  const { max_completion_tokens: alias, ...rest } = request
  return { ...rest, max_tokens: alias } as T
}

/**
 * 客户端与设置都没给上限时，anthropic wire 唯一能用的数。
 *
 * 不是「模型的最大输出」—— 那需要一个目录里根本没有的字段（`models-dev` 快照只带
 * 价格），把请求体里的上限放大到某个模型的上限会换来另一类失败（超限直接 400）。
 * 它只是 Anthropic 必填字段的最小可用兜底，真值由设置的
 * `defaultMaxOutputTokens` 决定，这里只负责设置缺失（老库）时的口径。
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4096

/** 设置里存的值只有正整数才算数：手坏的 data.json 不该换来一次 400 或一次 0 上限。 */
export function outputCapFallbackOf(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : DEFAULT_MAX_OUTPUT_TOKENS
}

/**
 * anthropic wire 的 `max_tokens` 是必填的，客户端没给就必须由代理补一个 —— 补的是
 * 设置里的 `defaultMaxOutputTokens`，不是代码里改不动的常量。
 *
 * 只补 anthropic：其余 wire 不带上限就是「让上游自己定」，那是上游的口径；而我们
 * 在这里补出来的数截断了回答，责任在我们的用户。
 * 排在 `applyModelParameters` 之后调用，所以「每模型参数 > 客户端 > 设置」这个优先
 * 序天然成立（前两者任一存在就不覆盖）。
 */
export function ensureAnthropicOutputCap<T extends ChatCompletionRequest>(
  request: T,
  wire: string | undefined,
  fallback: number
): T {
  if (wire !== 'anthropic-messages') return request
  if (typeof request.max_tokens === 'number' && request.max_tokens > 0) return request
  return { ...request, max_tokens: fallback } as T
}
