import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeToolCallArguments } from '../../src/main/proxy/utils/toolArguments.ts'
import type { ChatMessage } from '../../src/main/proxy/types.ts'

// 客户端实际发来的历史：类型里 arguments 声明为 string，运行时什么都有
const asIncoming = (message: Record<string, unknown>): ChatMessage => message as unknown as ChatMessage

const assistantWith = (...calls: unknown[]): Record<string, unknown> => ({
  role: 'assistant',
  content: null,
  tool_calls: calls.map((function_, index) => ({
    id: `call_${index}`,
    type: 'function',
    function: function_,
  })),
})

const argsOf = (message: unknown, callIndex = 0): unknown =>
  (message as { tool_calls: Array<{ function: { arguments: unknown } }> }).tool_calls[callIndex].function.arguments

test('反斜杠未转义的 Windows 路径补成合法 JSON（2026-11-01 的 400 现场）', () => {
  const bad = '{"command":"Get-ChildItem D:\\work | Sort-Object Length -Desc | Select -First 1 Name,Length"}'
  // 现场样本本身必须解析不出
  assert.throws(() => JSON.parse(bad))

  const result = normalizeToolCallArguments([asIncoming(assistantWith({ name: 'powershell', arguments: bad }))])

  assert.equal(result.repaired, 1)
  assert.equal(result.discarded, 0)
  const args = argsOf(result.messages[0]) as string
  assert.deepEqual(JSON.parse(args), {
    command: 'Get-ChildItem D:\\work | Sort-Object Length -Desc | Select -First 1 Name,Length',
  })
})

test('已经合法的 arguments 一字节不动，数组也是原对象', () => {
  const good = '{"path":"C:\\\\temp\\\\a.txt","n":1}'
  const messages = [asIncoming({ role: 'user', content: 'hi' }), asIncoming(assistantWith({ name: 'read', arguments: good }))]

  const result = normalizeToolCallArguments(messages)

  assert.equal(result.repaired, 0)
  assert.equal(result.messages, messages, '无改写时不得复制数组')
  assert.equal(argsOf(result.messages[1]), good)
})

test('空串 / 空白 / null / 缺字段统一成 {}，不算丢弃', () => {
  const result = normalizeToolCallArguments([
    asIncoming(assistantWith({ name: 'now', arguments: '' }, { name: 'pad', arguments: '   ' })),
    asIncoming(assistantWith({ name: 'nul', arguments: null })),
    asIncoming(assistantWith({ name: 'missing' })),
  ])

  assert.equal(result.repaired, 4)
  assert.equal(result.discarded, 0)
  assert.deepEqual([argsOf(result.messages[0], 0), argsOf(result.messages[0], 1)], ['{}', '{}'])
  assert.equal(argsOf(result.messages[1]), '{}')
  assert.equal(argsOf(result.messages[2]), '{}')
})

test('客户端把参数塞成对象时序列化，不改成 {}', () => {
  const result = normalizeToolCallArguments([asIncoming(assistantWith({ name: 'search', arguments: { q: 'hi' } }))])

  assert.equal(result.repaired, 1)
  assert.equal(result.discarded, 0)
  assert.equal(argsOf(result.messages[0]), '{"q":"hi"}')
})

test('修不好的（截断、非对象）降级成 {} 并计入 discarded', () => {
  const result = normalizeToolCallArguments([
    asIncoming(assistantWith({ name: 'trunc', arguments: '{"command":"echo hi' }, { name: 'scalar', arguments: '123' })),
  ])

  assert.equal(result.repaired, 2)
  assert.equal(result.discarded, 2)
  assert.deepEqual([argsOf(result.messages[0], 0), argsOf(result.messages[0], 1)], ['{}', '{}'])
})

test('合法转义与 \\\\u 序列原样保留，只有非法的才补', () => {
  const mixed = '{"a":"x\\ny","b":"\\u0041","c":"D:\\work","d":"a\\\\b","e":"q\\"r"}'
  // c 里的 \w 是非法转义，整串解析不出
  assert.throws(() => JSON.parse(mixed))

  const result = normalizeToolCallArguments([asIncoming(assistantWith({ name: 't', arguments: mixed }))])
  const parsed = JSON.parse(argsOf(result.messages[0]) as string) as Record<string, string>

  assert.equal(result.repaired, 1)
  assert.deepEqual(parsed, { a: 'x\ny', b: 'A', c: 'D:\\work', d: 'a\\b', e: 'q"r' })
})

test('字符串之外的裸反斜杠不猜，交给 {} 兜底', () => {
  const result = normalizeToolCallArguments([asIncoming(assistantWith({ name: 't', arguments: '{"a":\\1}' }))])

  assert.equal(result.discarded, 1)
  assert.equal(argsOf(result.messages[0]), '{}')
})

test('只动 assistant 的 tool_calls，其余角色与非对象调用不碰', () => {
  const toolMessage = { role: 'tool', tool_call_id: 'call_0', content: 'ok' }
  const messages = [
    asIncoming(toolMessage),
    asIncoming({ role: 'assistant', content: '纯文本，没有 tool_calls' }),
    asIncoming({ role: 'assistant', tool_calls: [null, 'nope', { id: 'c', type: 'function' }] }),
  ]

  const result = normalizeToolCallArguments(messages)

  assert.equal(result.messages[0], toolMessage)
  assert.equal(result.messages[1], messages[1])
  assert.deepEqual(result.messages[2], messages[2], '缺 function 的调用形状问题由校验负责，这里不猜')
})

test('入参不被修改，改过的消息是新对象，同轮未改的调用保持原对象', () => {
  const untouched = { id: 'call_ok', type: 'function', function: { name: 'read', arguments: '{"p":"a"}' } }
  const broken = { id: 'call_bad', type: 'function', function: { name: 'read', arguments: '{"p":"D:\\a"}' } }
  const assistant = asIncoming({ role: 'assistant', content: null, tool_calls: [untouched, broken] })
  const snapshot = JSON.parse(JSON.stringify([assistant]))

  const result = normalizeToolCallArguments([assistant])

  assert.deepEqual(JSON.parse(JSON.stringify([assistant])), snapshot, '原消息必须保持非法 JSON')
  assert.notEqual(result.messages[0], assistant, '改过的消息是新对象')
  assert.equal((result.messages[0] as { tool_calls: unknown[] }).tool_calls[0], untouched, '同轮里合法的调用复用原对象')
})
