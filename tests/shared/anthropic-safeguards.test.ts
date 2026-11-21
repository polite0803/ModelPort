/**
 * Anthropic 服务端 Auto mode 审核（safeguards）透传的契约测试。
 *
 * 这件事的全部价值在于「成对、原样、只在能执行审核的一方」三条。任何一条被写坏，
 * 失败形态都是**静默**的：客户端拿不到判决，退回自己的内置 classifier，每受审一次
 * 动作就多打一笔按 token 计费的请求，而界面上只多出一张「已退回内置审核」的卡片。
 * 所以这里对每条判据都配一个反例，而不只测顺路。
 *
 * 报文形状不是照文档想象写的，取自本机 Claude Desktop 安装里 `claude.exe` 的实际
 * 解析代码：
 * - 请求：`anthropic-beta: dangerous-tool-use-2026-09-03` + body 顶层 `safeguards`；
 * - 流式返回：`message_delta.delta.safeguard_results`（`"safeguard_results" in delta`）；
 * - 非流式返回：响应顶层 `safeguard_results`；
 * - 判据：`OUr()` 先 `safeParse` 整个数组，再筛 `type === 'dangerous_tool_use'`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ANTHROPIC_SAFEGUARDS_BETA,
  anthropicSafeguardsCapable,
  hasSafeguardResults,
  hasSafeguardsBeta,
  hasSafeguardsField,
  withSafeguardsBeta,
} from '../../src/shared/anthropicSafeguards.ts'
import {
  anthropicToChatRequest,
  chatResponseToAnthropicMessage,
  createAnthropicStreamTranslator,
} from '../../src/shared/anthropicWire.ts'

const requestBody = (extra: Record<string, unknown> = {}) => ({
  model: 'claude-sonnet-4-5',
  max_tokens: 64,
  messages: [{ role: 'user', content: 'hi' }],
  ...extra,
})

const SAFEGUARDS = {
  rules: ['do not delete files'],
  folders: ['/home/polit/projects'],
  user_name: 'polit',
  git: { branch: 'main', changed_files: 3 },
}

const VERDICT = [{
  type: 'dangerous_tool_use',
  status: { type: 'available', tool_uses: { toolu_01: 'allowed' } },
}]

test('beta 头是逗号列表，比较按成员而不是整串相等', () => {
  assert.equal(hasSafeguardsBeta(ANTHROPIC_SAFEGUARDS_BETA), true)
  assert.equal(hasSafeguardsBeta(`foo-2025-01-01, ${ANTHROPIC_SAFEGUARDS_BETA}`), true)
  // 前缀相同但不是同一个成员：整串 startsWith 会把它误判成已有。
  assert.equal(hasSafeguardsBeta(`${ANTHROPIC_SAFEGUARDS_BETA}-extra`), false)
  assert.equal(hasSafeguardsBeta(undefined), false)
})

test('追加 beta 值不重复、也不覆盖别家已有的值', () => {
  assert.equal(withSafeguardsBeta(undefined), ANTHROPIC_SAFEGUARDS_BETA)
  assert.equal(withSafeguardsBeta(''), ANTHROPIC_SAFEGUARDS_BETA)
  assert.equal(
    withSafeguardsBeta('extended-cache-ttl-2025-04-11'),
    `extended-cache-ttl-2025-04-11,${ANTHROPIC_SAFEGUARDS_BETA}`,
  )
  // 已经有就不追加：重复值会被严格上游判成非法头。
  const once = withSafeguardsBeta(undefined)
  assert.equal(withSafeguardsBeta(once), once)
})

test('safeguards 字段：只认存在且为对象，null 与标量都算没带', () => {
  assert.equal(hasSafeguardsField({ safeguards: SAFEGUARDS }), true)
  assert.equal(hasSafeguardsField({ safeguards: null }), false)
  assert.equal(hasSafeguardsField({ safeguards: 'on' }), false)
  assert.equal(hasSafeguardsField({}), false)
  assert.equal(hasSafeguardsField(null), false)
})

test('只有 anthropic-messages 且条目声明了能力的上游才算能执行审核', () => {
  const entry = { serverSideSafeguards: true }
  assert.equal(anthropicSafeguardsCapable(
    { type: 'aggregate', wire: 'anthropic-messages', aggregateId: 'anthropic' }, entry), true)
  // wire 对了但条目没声明：目录里 Anthropic 之外的 anthropic-wire 条目（z.ai / minimax）
  // 不跑这项审核，搬过去只会白送会话现场。
  assert.equal(anthropicSafeguardsCapable(
    { type: 'aggregate', wire: 'anthropic-messages', aggregateId: 'glm' }, {}), false)
  // 非聚合（内建 / 账号渠道）即使 wire 写着 anthropic 也不搬。
  assert.equal(anthropicSafeguardsCapable(
    { type: 'builtin', wire: 'anthropic-messages' }, entry), false)
  assert.equal(anthropicSafeguardsCapable(
    { type: 'account', wire: 'anthropic-messages' }, entry), false)
  // chat 线没有这一格。
  assert.equal(anthropicSafeguardsCapable(
    { type: 'aggregate', wire: 'openai-chat' }, entry), false)
  assert.equal(anthropicSafeguardsCapable(undefined, entry), false)
})

test('判决表判据：非空数组且每项是对象，空数组与标量都不算', () => {
  assert.equal(hasSafeguardResults(VERDICT), true)
  assert.equal(hasSafeguardResults([]), false)
  assert.equal(hasSafeguardResults('available'), false)
  assert.equal(hasSafeguardResults([null]), false)
  assert.equal(hasSafeguardResults(undefined), false)
})

test('入站：关着时不搬 safeguards，且如实记进 dropped', () => {
  const { request, dropped } = anthropicToChatRequest(requestBody({ safeguards: SAFEGUARDS }), {
    model: 'auto',
    stream: true,
  })
  assert.equal('safeguards' in request, false)
  assert.ok(dropped.includes('body:safeguards'), `dropped=${JSON.stringify(dropped)}`)
})

test('入站：开着时原样搬运，内部结构一个键都不解释', () => {
  const { request, dropped } = anthropicToChatRequest(requestBody({ safeguards: SAFEGUARDS }), {
    model: 'auto',
    stream: true,
    forwardsSafeguards: true,
  })
  assert.deepEqual(request.safeguards, SAFEGUARDS)
  assert.equal(dropped.includes('body:safeguards'), false)
})

test('入站：开着但请求没带 safeguards 时不凭空造一个', () => {
  const { request } = anthropicToChatRequest(requestBody(), {
    model: 'auto',
    stream: true,
    forwardsSafeguards: true,
  })
  assert.equal('safeguards' in request, false)
})

test('出站链路：chat chunk 顶层的判决被放回 message_delta.delta', () => {
  const translator = createAnthropicStreamTranslator({ model: 'claude-x', fallbackId: 'abc' })
  const chunk = JSON.stringify({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: null }],
  })
  const withVerdict = JSON.stringify({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: {}, finish_reason: null }],
    safeguard_results: VERDICT,
  })
  const tail = JSON.stringify({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  })
  const out = translator.push(`${`data: ${chunk}\n\n`}${`data: ${withVerdict}\n\n`}${`data: ${tail}\n\n`}`)
    + translator.end()

  const messageDelta = out
    .split('\n\n')
    .filter(frame => frame.includes('event: message_delta'))
    .map(frame => JSON.parse(frame.split('\n').find(line => line.startsWith('data:'))!.slice(5).trim()))
  assert.equal(messageDelta.length, 1)
  assert.deepEqual(messageDelta[0].delta.safeguard_results, VERDICT)
})

test('出站链路：没有判决时 message_delta 不带这一格，而不是带 null', () => {
  const translator = createAnthropicStreamTranslator({ model: 'claude-x', fallbackId: 'abc' })
  const chunk = JSON.stringify({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: 'stop' }],
  })
  const out = translator.push(`data: ${chunk}\n\n`) + translator.end()
  const messageDelta = out
    .split('\n\n')
    .find(frame => frame.includes('event: message_delta'))!
  const parsed = JSON.parse(messageDelta.split('\n').find(line => line.startsWith('data:'))!.slice(5).trim())
  // 客户端判据是 `"safeguard_results" in delta`：写 null 会让它把「上游没给」
  // 读成「给了个空判决」。
  assert.equal('safeguard_results' in parsed.delta, false)
})

test('非流式：chat 响应顶层的判决挪回 anthropic 顶层', () => {
  const chatBody = {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    choices: [{
      index: 0,
      message: { role: 'assistant', content: 'done' },
      finish_reason: 'stop',
    }],
    safeguard_results: VERDICT,
  }
  const message = chatResponseToAnthropicMessage(chatBody, { model: 'claude-x', fallbackId: 'abc' })
  assert.deepEqual(message.safeguard_results, VERDICT)
})

test('非流式：没有判决时不出现这一格', () => {
  const message = chatResponseToAnthropicMessage({
    id: 'chatcmpl-1',
    choices: [{ index: 0, message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
  }, { model: 'claude-x', fallbackId: 'abc' })
  assert.equal('safeguard_results' in message, false)
})