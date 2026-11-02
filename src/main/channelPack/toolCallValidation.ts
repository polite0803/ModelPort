/**
 * 账号渠道入站历史里 `tool_calls` 的形状校验。
 *
 * 渠道包的网关在 `convertToolCalls` 里会拒掉形状不对的 `tool_calls`，但那句
 * 报错只说「invalid function call」——客户端拿到后不知道是**哪一条消息**、
 * **哪一个调用**、**哪个字段**、实际收到的是什么类型，定位全靠猜。
 *
 * 这里在**进网关之前**跑同一套判据，把坐标写进报错：
 * `assistant.tool_calls contains an invalid function call: messages[3].tool_calls[0].function.arguments must be a string, received object`
 *
 * ⚠️ **判据必须与网关逐条对齐**（`vendor/channel-pack/src/openai-gateway/messages.ts`
 * 的 `convertToolCalls`）：网关放行的这里也放行、网关拒的这里也拒。判严了会拒掉
 * 本来能用的请求，判松了等于没校验。两侧都只看 **assistant** 消息的
 * `tool_calls`——其余角色，网关根本不读这个字段。
 *
 * 这条对齐要求**不接受"为了更好的报错"而放宽/收紧**：2026-10-30 曾试过把
 * `arguments` 空串判成违规（理由是想把报错提前并带坐标），但那个理由建立在
 * 一个错误推断（"`Stream error` 前缀 ⇒ 流已开始之后才失败 ⇒ 不是本地校验抛的"）。
 * 渠道请求是**延迟流**：worker 里任何时点的失败都会以流的 `error` 事件浮现，
 * 所以那个前缀不证明时间点。没有证据说明两侧不一致时，保持逐条对齐。
 */
export interface ToolCallViolation {
  /** JSON 路径，形如 `messages[3].tool_calls[0].function.arguments`。 */
  path: string
  /** 期望的形状，如 `a string`。 */
  expected: string
  /** 实际收到的类型，如 `object`。 */
  received: string
}

/** 值的类型描述；空串单独点出来（它「是字符串」但不满足非空要求）。 */
function describe(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'string') return value.length === 0 ? 'empty string' : 'string'
  return typeof value
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * 找出入站历史里第一条形状不对的 `tool_calls`。
 *
 * 全部合法时返回 `undefined`。
 */
export function findToolCallViolation(messages: unknown): ToolCallViolation | undefined {
  if (!Array.isArray(messages)) return undefined

  for (const [messageIndex, message] of messages.entries()) {
    if (message === null || typeof message !== 'object') continue
    const record = message as { role?: unknown; tool_calls?: unknown }
    // 网关只在 assistant 分支读 tool_calls，其余角色带这个字段会被忽略。
    if (record.role !== 'assistant') continue

    const toolCalls = record.tool_calls
    if (toolCalls === undefined) continue
    if (!Array.isArray(toolCalls)) {
      return {
        path: `messages[${messageIndex}].tool_calls`,
        expected: 'an array',
        received: describe(toolCalls),
      }
    }

    for (const [callIndex, call] of toolCalls.entries()) {
      const path = `messages[${messageIndex}].tool_calls[${callIndex}]`
      if (call === null || typeof call !== 'object') {
        return { path, expected: 'an object', received: describe(call) }
      }
      const { id, function: fn } = call as {
        id?: unknown
        function?: { name?: unknown; arguments?: unknown }
      }
      if (!isNonEmptyString(id)) {
        return { path: `${path}.id`, expected: 'a non-empty string', received: describe(id) }
      }
      const name = fn?.name
      if (!isNonEmptyString(name)) {
        return { path: `${path}.function.name`, expected: 'a non-empty string', received: describe(name) }
      }
      const args = fn?.arguments
      if (typeof args !== 'string') {
        return { path: `${path}.function.arguments`, expected: 'a string', received: describe(args) }
      }
    }
  }

  return undefined
}

/**
 * 把违规拼成给客户端看的报错。
 *
 * 前半句沿用网关那句笼统文案（客户端与日志里按它 grep 的老习惯继续有效），
 * 后半句补上坐标与实收类型。
 */
export function formatToolCallViolation(violation: ToolCallViolation): string {
  return `assistant.tool_calls contains an invalid function call: ${violation.path} must be ${violation.expected}, received ${violation.received}`
}

/**
 * 入站历史不合法时抛错。
 *
 * ⚠️ **必须带 `status: 400`** —— 渠道 worker 的错误出口只透传 `status`，缺了它
 * 客户端收到的是 500 而不是 `invalid_request_error`（`mapUpstreamError` 按 4xx
 * 分类）。worker 里其它 400（模型 ID 无效等）用的是同一个写法。
 */
export function assertValidToolCalls(messages: unknown): void {
  const violation = findToolCallViolation(messages)
  if (violation === undefined) return
  throw Object.assign(new Error(formatToolCallViolation(violation)), { status: 400 })
}

/**
 * **影子诊断**：统计入站历史里"规范合法、但某家上游可能不认"的形状。
 *
 * ## 为什么需要它（而不是把请求体写进日志）
 *
 * 2026-10-30 试图用请求体日志定位那 179 次 `invalid function call` 失败，失败得
 * 很彻底：真实请求体 **1.8MB**，而 `requestLogConfig.maxBodyChars` 默认 8000、
 * 拉到 40000 也只保留**开头 2%** —— 而 `tool_calls`/`reasoning_content` 这些要看的
 * 东西必然在 `messages` **尾部**（最近的几轮）。截断保头部，所以这条路结构性地
 * 抓不到；把上限抬到 2MB 又会让每条日志几百 MB。
 *
 * 所以改成**只记判定结果、不记内容**：这里算几个布尔计数，由调用方写进应用日志。
 * 一次就能回答"缺 reasoning_content 占多少"这类问题，而日志里没有一个字是用户内容。
 *
 * ⚠️ **纯观测**：本函数不参与校验、不改变任何行为，`assertValidToolCalls` 的判据
 * 与网关仍严格对齐。删掉它不影响功能。
 *
 * 统计三档（都是"我们放行、但可能被上游拒"的形状）：
 * - `assistantWithCalls`：带 `tool_calls` 的 assistant 历史轮数（分母）
 * - `missingReasoning`：其中**没有** `reasoning_content` 的轮数（DeepSeek 思考模式
 *   要求两者成对，见 `messages.ts` 里 reasoning 那段注释）
 * - `emptyArguments` / `prefixedName`：空串参数、带 `:` 前缀的工具名各多少个调用
 */
export interface ToolCallShapeCounts {
  assistantWithCalls: number
  missingReasoning: number
  emptyArguments: number
  prefixedName: number
}

/**
 * 清洗发给账号渠道的**工具定义**。
 *
 * 真实缺陷（2026-11-02 Codex → Raccoon）：Codex 的延迟工具发现会带一条
 * `type:'function', function:{name:'', ...}` 的 `tool_search`；空名字在 Responses
 * 里是客户端的占位，但 chat completions 上游会直接 400/502：
 * `tools[14].function.name is invalid or missing`。
 *
 * 同一批请求里还有 `apply_patch` / `collaboration` / MCP 工具缺少 `parameters`
 * （它们是 freeform/custom 工具）。部分上游（Agnes 实测）同样拒收缺字段的定义，
 * 所以这里补一个空对象 schema，而不是把它们一起删掉 —— 客户端仍能按名字调用，
 * 参数由客户端自己校验。
 *
 * 空名字工具**无法被模型正确调用**，删除不会损失可用能力；把定义原样送上去
 * 只会让整条请求在严格上游直接失败。返回新数组，不修改入参。
 */
export function sanitizeChatToolDefinitions(tools: unknown): unknown {
  if (!Array.isArray(tools)) return tools

  const sanitized: unknown[] = []
  for (const tool of tools) {
    if (tool === null || typeof tool !== 'object') continue
    const record = tool as { type?: unknown; function?: unknown }
    if (record.type !== 'function' || record.function === null || typeof record.function !== 'object') {
      // chat completions 只认 function 工具；其它自定义形状原样发上去只会被拒。
      continue
    }
    const fn = record.function as { name?: unknown; parameters?: unknown }
    if (typeof fn.name !== 'string' || fn.name.trim().length === 0) continue
    const nextFunction = fn.parameters === undefined || fn.parameters === null
      || typeof fn.parameters !== 'object'
      ? { ...fn, parameters: { type: 'object', properties: {} } }
      : fn
    sanitized.push({ ...record, function: nextFunction })
  }
  return sanitized
}

export function countToolCallShapes(messages: unknown): ToolCallShapeCounts {
  const counts: ToolCallShapeCounts = {
    assistantWithCalls: 0,
    missingReasoning: 0,
    emptyArguments: 0,
    prefixedName: 0,
  }
  if (!Array.isArray(messages)) return counts

  for (const message of messages) {
    if (message === null || typeof message !== 'object') continue
    const record = message as {
      role?: unknown
      reasoning_content?: unknown
      tool_calls?: unknown
    }
    if (record.role !== 'assistant' || !Array.isArray(record.tool_calls)) continue
    counts.assistantWithCalls += 1

    const reasoning = record.reasoning_content
    if (typeof reasoning !== 'string' || reasoning.length === 0) counts.missingReasoning += 1

    for (const call of record.tool_calls) {
      const fn = (call as { function?: { name?: unknown; arguments?: unknown } } | null)?.function
      if (typeof fn?.arguments === 'string' && fn.arguments.length === 0) counts.emptyArguments += 1
      if (typeof fn?.name === 'string' && fn.name.includes(':')) counts.prefixedName += 1
    }
  }
  return counts
}
