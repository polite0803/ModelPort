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

/**
 * 调用↔结果的**配对**缺陷类别。与上面的形状判据是两件事：形状判「字段对不对」，
 * 这里判「每一条调用是否恰好有一条结果回填它」。
 */
export type ToolCallPairingDefectKind =
  /** 历史里声明了调用，却没有任何结果回填 —— 客户端那一轮被中断的残留。 */
  | 'unanswered_call'
  /** 同一个 `call_id` 声明了两次 —— 流式收尾重复发同一个块。 */
  | 'duplicate_call'
  /** 结果找不到产生它的调用。 */
  | 'orphan_result'
  /** 同一个调用被回填了多次。 */
  | 'duplicate_result'

export interface ToolCallPairingDefect {
  kind: ToolCallPairingDefectKind
  /** JSON 路径，形如 `messages[7].tool_calls[0]` 或 `messages[9]`。 */
  path: string
  callId: string
  /** 工具名；结果项取不到名字时是空串。 */
  name: string
}

export interface ToolCallPairingCounts {
  unansweredCalls: number
  duplicateCalls: number
  orphanResults: number
  duplicateResults: number
}

export interface ToolCallPairingRepair {
  /** 没有缺陷时**原样返回同一个数组**；删过东西才是新数组。 */
  messages: unknown
  counts: ToolCallPairingCounts
  /** 缺陷明细（只有下标、id 与工具名，不含任何用户内容），按扫描顺序。 */
  defects: ToolCallPairingDefect[]
}

interface PairingPlan {
  defects: ToolCallPairingDefect[]
  /** 整条丢弃的消息下标。 */
  dropMessage: Set<number>
  /** 消息下标 → 该条 `tool_calls` 里要丢弃的下标。 */
  dropCall: Map<number, Set<number>>
}

function callIdOf(call: unknown): string {
  const id = (call as { id?: unknown } | null)?.id
  return typeof id === 'string' ? id : ''
}

function callNameOf(call: unknown): string {
  const name = (call as { function?: { name?: unknown } } | null)?.function?.name
  return typeof name === 'string' ? name : ''
}

/**
 * 扫一遍历史，算出配对缺陷与对应的丢弃下标。
 *
 * 非数组入参返回 `undefined`（与 `findToolCallViolation` 同样的宽容：校验层不该
 * 因为形状怪异而崩，怪异由形状判据去管）。
 */
function planToolCallPairing(messages: unknown): PairingPlan | undefined {
  if (!Array.isArray(messages)) return undefined

  const declared = new Map<string, { messageIndex: number; callIndex: number }>()
  const answered = new Set<string>()
  const defects: ToolCallPairingDefect[] = []
  const dropMessage = new Set<number>()
  const dropCall = new Map<number, Set<number>>()

  const dropCallAt = (messageIndex: number, callIndex: number): void => {
    const existing = dropCall.get(messageIndex)
    if (existing === undefined) dropCall.set(messageIndex, new Set([callIndex]))
    else existing.add(callIndex)
  }

  // 第一遍登记调用：只认第一次声明，重复声明的丢掉（保留第一条，因为它才是
  // 结果所对应的那一次）。
  messages.forEach((message, messageIndex) => {
    const record = message as { role?: unknown; tool_calls?: unknown } | null
    if (record === null || typeof record !== 'object') return
    if (record.role !== 'assistant' || !Array.isArray(record.tool_calls)) return

    record.tool_calls.forEach((call, callIndex) => {
      const id = callIdOf(call)
      if (id === '') return
      const path = `messages[${messageIndex}].tool_calls[${callIndex}]`
      const first = declared.get(id)
      if (first !== undefined) {
        defects.push({ kind: 'duplicate_call', path, callId: id, name: callNameOf(call) })
        dropCallAt(messageIndex, callIndex)
        return
      }
      declared.set(id, { messageIndex, callIndex })
    })
  })

  // 第二遍登记结果：调用都不存在的结果、以及同一调用的第二次回填，都丢掉。
  messages.forEach((message, messageIndex) => {
    const record = message as { role?: unknown; tool_call_id?: unknown } | null
    if (record === null || typeof record !== 'object') return
    if (record.role !== 'tool') return

    const id = typeof record.tool_call_id === 'string' ? record.tool_call_id : ''
    const path = `messages[${messageIndex}]`
    if (id === '' || !declared.has(id)) {
      defects.push({ kind: 'orphan_result', path, callId: id, name: '' })
      dropMessage.add(messageIndex)
      return
    }
    if (answered.has(id)) {
      defects.push({ kind: 'duplicate_result', path, callId: id, name: '' })
      dropMessage.add(messageIndex)
      return
    }
    answered.add(id)
  })

  // 第三遍：声明了却没人回填的调用。放最后，保证明细里先出现「重复/孤儿」再出现
  // 「未回答」，读日志时和丢弃的因果顺序一致。
  for (const [id, where] of declared) {
    if (answered.has(id)) continue
    const call = (messages[where.messageIndex] as { tool_calls: unknown[] }).tool_calls[where.callIndex]
    defects.push({
      kind: 'unanswered_call',
      path: `messages[${where.messageIndex}].tool_calls[${where.callIndex}]`,
      callId: id,
      name: callNameOf(call),
    })
    dropCallAt(where.messageIndex, where.callIndex)
  }

  return { defects, dropMessage, dropCall }
}

/**
 * 只检测、不改写 —— 给测试和「先看清是哪一侧悬空」用。
 */
export function findToolCallPairingDefects(messages: unknown): ToolCallPairingDefect[] {
  return planToolCallPairing(messages)?.defects ?? []
}

/**
 * 把配对不齐的历史修成配平的，**只做删除**。
 *
 * ## 为什么需要（2026-11-11 实测）
 *
 * Codex 经 `/v1/responses` 打 `codex` 线路时，同一份历史被三家账号渠道判死：
 * `buddy/deepseek-v4-pro` 与 `buddy/kimi-k3.1-pro` 回 502
 * `工具记录不完整，请新建任务 tool calls and tool results do not match`，
 * 换到 `buddy/mimo-v2.6-pro` 才 200。那句中文文案不在本仓与渠道包源码里
 * （`grep -rn 工具记录不完整 src vendor` 零命中），是上游服务自己的判据。
 * 后果不是「这一条失败」而是**整轮粘到弱候选**：此后 turn 13–16 的
 * `auto.reason` 全是 `sticky`，弱模型开始「宣布要做→直接结束回合」，
 * 用户读到的就是 15:52 / 16:10 / 16:11 三次无故停下。
 *
 * ## 为什么是删除而不是补一条结果
 *
 * 本网关不注入任何提示词（AGENTS.md 裁定 2026-11-03）。凭空造一句
 * 「（无结果）」就是往用户对话里写正文，要过 `gateway-authored-text` 的双向对账；
 * 而删除属于明确放行的「deletion-only trimming」，且语义上诚实：客户端既然没带回
 * 结果，那次尝试在本轮记录里本来就不成立。重复声明/重复回填同理 —— 保留第一条，
 * 因为后面的那条与它同 id、不带新信息，留着才是上游拒收的直接原因。
 *
 * ## 边界（别把这里当成万能修复）
 *
 * 本入口只看得见**宿主交给渠道 worker 的 OpenAI messages**。若失配是更下游的
 * harness 转换（`vendor/channel-pack/src/openai-gateway/`）造成的，这里删不掉，
 * 但 warn 行的计数会一直是 0 而上游仍报同样的 502 —— 那个组合就是「缺陷在下游」的
 * 判据，别回头改这里。
 */
export function repairToolCallPairing(messages: unknown): ToolCallPairingRepair {
  const plan = planToolCallPairing(messages)
  const defects = plan?.defects ?? []
  const counts: ToolCallPairingCounts = {
    unansweredCalls: 0,
    duplicateCalls: 0,
    orphanResults: 0,
    duplicateResults: 0,
  }
  for (const defect of defects) {
    if (defect.kind === 'unanswered_call') counts.unansweredCalls += 1
    else if (defect.kind === 'duplicate_call') counts.duplicateCalls += 1
    else if (defect.kind === 'orphan_result') counts.orphanResults += 1
    else counts.duplicateResults += 1
  }

  if (plan === undefined || defects.length === 0) {
    return { messages, counts, defects }
  }

  const repaired: unknown[] = []
  ;(messages as unknown[]).forEach((message, messageIndex) => {
    if (plan.dropMessage.has(messageIndex)) return

    const droppedCallIndexes = plan.dropCall.get(messageIndex)
    if (droppedCallIndexes === undefined) {
      repaired.push(message)
      return
    }

    const record = message as { content?: unknown; tool_calls?: unknown }
    const keptCalls = (record.tool_calls as unknown[]).filter(
      (_, callIndex) => !droppedCallIndexes.has(callIndex),
    )
    if (keptCalls.length > 0) {
      repaired.push({ ...(message as object), tool_calls: keptCalls })
      return
    }

    // 调用被清空了：还有正文就留正文，没有就整条删除 —— 一条 `content:null` 且
    // 不带调用的 assistant 消息会被上游当成空回复。
    const content = record.content
    const hasText = typeof content === 'string'
      ? content.trim() !== ''
      : content !== undefined && content !== null
    if (!hasText) return

    const withoutCalls = { ...(message as object) } as Record<string, unknown>
    delete withoutCalls.tool_calls
    repaired.push(withoutCalls)
  })

  return { messages: repaired, counts, defects }
}

/**
 * 把配对明细压成一行日志文本（调用方负责决定级别与是否落行）。
 *
 * 只输出下标、`call_id` 与工具名：请求体 1.8MB、落盘只保头部 2%，内容取证结构性
 * 走不通（见 `countToolCallShapes` 注释），而配对问题本来就不需要内容就能定位。
 */
export function formatToolCallPairing(defects: ToolCallPairingDefect[], limit = 12): string {
  const head = defects.slice(0, limit).map(defect => `${defect.kind} ${defect.path} (${defect.callId})`).join(', ')
  const rest = defects.length - Math.min(defects.length, limit)
  return rest > 0 ? `${head}, 另有 ${rest} 条同类` : head
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
