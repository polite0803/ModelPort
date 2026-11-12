/**
 * 思考回灌：观测下行 SSE → 按 tool_call.id 缓存 → 下一轮补回历史。
 *
 * 洞的来历（2026-11-07 实测，聚合 `deepseek` 线 3 笔 400）：
 * `The reasoning_content in the thinking mode must be passed back to the API.`
 * 渠道包侧早有一套同机制，但它跑在 worker 线程里、只覆盖 `type: 'account'`；
 * 客户端直连聚合 `deepseek` 走的是通用 openai-chat 分支，从来没接过这一步。
 *
 * 2026-11-12：两条泳道合并到主线程一份缓存。渠道包自己那份已退役 —— 它和主线程
 * 各持一张 Map，会话在两条线之间换家时上一轮的思考找不到，下一轮就是 400。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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

test('适用范围：账号渠道整类放行（与聚合线路共用主线程缓存），开关 0 时整体关断', () => {
  const deepseek = { type: 'aggregate' as const, apiEndpoint: 'https://api.deepseek.com' }
  assert.equal(reasoningEchoApplies(deepseek, {} as NodeJS.ProcessEnv), true)
  assert.equal(reasoningEchoApplies(deepseek, { DSH_REASONING_REPLAY: '0' } as unknown as NodeJS.ProcessEnv), false)
  // 账号渠道不看端点：渠道包里的上游各自要不要这个字段无从枚举，补上只是多一个属性。
  assert.equal(reasoningEchoApplies({ type: 'account' }, {} as NodeJS.ProcessEnv), true)
  assert.equal(
    reasoningEchoApplies({ type: 'account' }, { DSH_REASONING_REPLAY: '0' } as unknown as NodeJS.ProcessEnv),
    false,
  )
  assert.equal(
    reasoningEchoApplies({ type: 'custom', apiEndpoint: 'https://api.openai.com/v1' }, {} as NodeJS.ProcessEnv),
    false,
  )
})

test('渠道包不再自己攒思考（线程隔离，跨泳道时那份 Map 补不回来）', () => {
  const root = (relative: string) =>
    readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8')
  const worker = root('src/main/channelPack/worker.ts')
  const forwarder = root('src/main/proxy/forwarder.ts')
  const chat = root('src/main/proxy/routes/chat.ts')
  // 正向门：账号渠道的补回在主线程、在派发给 worker 之前。
  assert.match(forwarder, /this\.withReplayedReasoning\(request, \{ id: providerId \}\)/)
  // 观测点必须两条下行路径都在：转换路径（聚合）与直通路径（账号渠道）。
  assert.equal(
    (chat.match(/reasoningEcho\?\.push\(chunk\)/g) ?? []).length,
    2,
    'chat 路由少了一处下行观测（直通路径 = 账号渠道）',
  )
  // 反向门：worker 线程里不得再出现自己的缓存实例。
  assert.equal(/new ReasoningReplay\(/.test(worker), false, '渠道包又把线程内缓存接回来了')
  assert.equal(/reasoningReplay\./.test(worker), false, '渠道包又在自己观测/补回了')
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

test('跨泳道：上一轮在账号渠道发出的思考，下一轮落到聚合线路同样补得回来', () => {
  // 两份观测器分别代表两条泳道；缓存只有一份（`replayCache`），所以键在两边都查得到。
  const accountLane = createReasoningEchoObserver()
  accountLane.push(reasoningFrame('渠道包的思考') + toolFrame('call_echo-cross'))
  accountLane.finish()

  // 下一轮换到聚合线路：inject 不认线路，只按 tool_call.id 查这份共享缓存。
  const { request, injected } = injectReasoningEcho(requestOf([assistantTurn('call_echo-cross')]))
  assert.equal(injected, 1)
  assert.equal(
    (request.messages as Array<{ reasoning_content?: string }>)[0].reasoning_content,
    '渠道包的思考',
  )
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