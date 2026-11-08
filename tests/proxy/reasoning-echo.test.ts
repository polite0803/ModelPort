/**
 * 聚合线路的思考回灌：观测下行 SSE → 按 tool_call.id 缓存 → 下一轮补回历史。
 *
 * 洞的来历（2026-11-07 实测，聚合 `deepseek` 线 3 笔 400）：
 * `The reasoning_content in the thinking mode must be passed back to the API.`
 * 渠道包侧早有同一机制（`channelPack/worker.ts`），但它只覆盖 `type: 'account'`；
 * 客户端直连聚合 `deepseek` 走的是通用 openai-chat 分支，从来没接过这一步。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createReasoningEchoObserver,
  injectReasoningEcho,
  isDeepSeekEndpoint,
  reasoningEchoApplies,
  recordReasoningEchoCompletion,
} from '../../src/main/proxy/reasoningEcho.ts'

function frame(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-x',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'm',
    choices: [{ index: 0, delta: payload, finish_reason: null }],
  })}\n\n`
}

const reasoningFrame = (text: string) => frame({ reasoning_content: text })
const toolFrame = (id: string) => frame({
  tool_calls: [{ index: 0, id, type: 'function', function: { name: 'read', arguments: '{}' } }],
})

const assistantTurn = (id: string) => ({
  role: 'assistant',
  content: null,
  tool_calls: [{ id, type: 'function', function: { name: 'read', arguments: '{}' } }],
})

const requestOf = (messages: unknown[]) => ({ model: 'deepseek/deepseek-flash', messages }) as never

test('端点判定：只认 api.deepseek.com 这个主机，后缀伪装不算', () => {
  assert.equal(isDeepSeekEndpoint('https://api.deepseek.com'), true)
  assert.equal(isDeepSeekEndpoint('https://api.deepseek.com/v1'), true)
  assert.equal(isDeepSeekEndpoint('https://API.DeepSeek.com/'), true)
  assert.equal(isDeepSeekEndpoint('https://api.deepseek.com.evil.example'), false)
  assert.equal(isDeepSeekEndpoint('https://api.deepseek.ai'), false)
  assert.equal(isDeepSeekEndpoint('https://api.openai.com/v1'), false)
  assert.equal(isDeepSeekEndpoint(''), false)
  assert.equal(isDeepSeekEndpoint(undefined), false)
  assert.equal(isDeepSeekEndpoint('not a url'), false)
})

test('适用范围：账号渠道跳过（worker.ts 自己观测），开关 0 时整体关断', () => {
  const deepseek = { type: 'aggregate' as const, apiEndpoint: 'https://api.deepseek.com' }
  assert.equal(reasoningEchoApplies(deepseek, {} as NodeJS.ProcessEnv), true)
  assert.equal(reasoningEchoApplies(deepseek, { DSH_REASONING_REPLAY: '0' } as unknown as NodeJS.ProcessEnv), false)
  assert.equal(
    reasoningEchoApplies({ type: 'account', apiEndpoint: 'https://api.deepseek.com' }, {} as NodeJS.ProcessEnv),
    false,
  )
  assert.equal(
    reasoningEchoApplies({ type: 'custom', apiEndpoint: 'https://api.openai.com/v1' }, {} as NodeJS.ProcessEnv),
    false,
  )
})

test('流式观测：跨块（含多字节中文被切断）仍能完整回灌', () => {
  const text = reasoningFrame('先想一下再调用') + toolFrame('call_echo-1')
  const bytes = Buffer.from(text, 'utf8')
  // 切在「想」这个三字节字符的中间：按块 toString 会造出替换字符。
  const cut = bytes.indexOf(Buffer.from('想', 'utf8')) + 1
  assert.ok(cut > 1, '前置：确实切在多字节字符内部')

  const observer = createReasoningEchoObserver()
  observer.push(bytes.subarray(0, cut))
  observer.push(bytes.subarray(cut, cut + 17))
  observer.push(bytes.subarray(cut + 17))
  observer.finish()

  const inbound = [assistantTurn('call_echo-1')]
  const before = JSON.stringify(inbound)
  const { request, injected } = injectReasoningEcho(requestOf(inbound))

  assert.equal(injected, 1)
  assert.equal((request.messages as Array<{ reasoning_content?: string }>)[0].reasoning_content, '先想一下再调用')
  assert.equal(JSON.stringify(inbound), before, '入站数组一个字节都不改')
})

test('并发隔离：两个流的累积不会互相污染', () => {
  const a = createReasoningEchoObserver()
  const b = createReasoningEchoObserver()
  a.push(reasoningFrame('思考甲'))
  b.push(reasoningFrame('思考乙'))
  a.push(toolFrame('call_echo-a'))
  b.push(toolFrame('call_echo-b'))
  a.finish()
  b.finish()

  const { request, injected } = injectReasoningEcho(requestOf([
    assistantTurn('call_echo-a'),
    assistantTurn('call_echo-b'),
  ]))
  const messages = request.messages as Array<{ reasoning_content?: string }>
  assert.equal(injected, 2)
  assert.equal(messages[0].reasoning_content, '思考甲')
  assert.equal(messages[1].reasoning_content, '思考乙')
})

test('真无思考的轮次不补：宁可上报 400，也不编造思考', () => {
  const observer = createReasoningEchoObserver()
  observer.push(toolFrame('call_echo-no-reasoning'))
  observer.finish()

  const { injected } = injectReasoningEcho(requestOf([assistantTurn('call_echo-no-reasoning')]))
  assert.equal(injected, 0)
})

test('没有尾随换行的半帧在 finish 时仍然入缓存', () => {
  const observer = createReasoningEchoObserver()
  // 去掉整段最后的 `\n\n`：最后一行只能靠 finish() 的尾巴冲刷才会被解析。
  observer.push((reasoningFrame('尾巴思考') + toolFrame('call_echo-tail')).trimEnd())
  observer.finish()

  const { injected } = injectReasoningEcho(requestOf([assistantTurn('call_echo-tail')]))
  assert.equal(injected, 1)
})

test('非流式响应体同样入缓存（message 而不是 delta）', () => {
  recordReasoningEchoCompletion({
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        reasoning_content: '非流式思考',
        tool_calls: [{ id: 'call_echo-sync', type: 'function', function: { name: 'x', arguments: '{}' } }],
      },
      finish_reason: 'tool_calls',
    }],
  })

  const { request, injected } = injectReasoningEcho(requestOf([assistantTurn('call_echo-sync')]))
  assert.equal(injected, 1)
  assert.equal((request.messages as Array<{ reasoning_content?: string }>)[0].reasoning_content, '非流式思考')
})