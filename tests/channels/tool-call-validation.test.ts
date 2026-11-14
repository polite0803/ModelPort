import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  assertValidToolCalls,
  findToolCallViolation,
  countToolCallShapes,
  formatToolCallViolation,
  findToolCallPairingDefects,
  formatToolCallPairing,
  repairToolCallAdjacency,
  repairToolCallPairing,
} from '../../src/main/channelPack/toolCallValidation.ts'

/** 客户端回传的一条合法 assistant 工具调用。 */
const validCall = {
  id: 'call_abc',
  type: 'function',
  function: { name: 'get_stock_price', arguments: '{"code":"002837"}' },
}

test('合法的 tool_calls 不报错', () => {
  const messages = [
    { role: 'system', content: '你是选股助手' },
    { role: 'user', content: '查一下 002837' },
    { role: 'assistant', content: null, tool_calls: [validCall] },
  ]

  assert.equal(findToolCallViolation(messages), undefined)
})

test('arguments 是对象时报出坐标与实收类型', () => {
  const messages = [
    { role: 'user', content: '查一下' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_1', function: { name: 'read', arguments: { code: '002837' } } }],
    },
  ]

  const violation = findToolCallViolation(messages)

  assert.equal(violation?.path, 'messages[1].tool_calls[0].function.arguments')
  assert.equal(violation?.expected, 'a string')
  assert.equal(violation?.received, 'object')
  assert.match(
    formatToolCallViolation(violation!),
    /assistant\.tool_calls contains an invalid function call: messages\[1\]\.tool_calls\[0\]\.function\.arguments must be a string, received object/,
  )
})

test('缺少 id 时点名到 id 字段', () => {
  const messages = [
    { role: 'assistant', tool_calls: [{ function: { name: 'read', arguments: '{}' } }] },
  ]

  const violation = findToolCallViolation(messages)

  assert.equal(violation?.path, 'messages[0].tool_calls[0].id')
  assert.equal(violation?.expected, 'a non-empty string')
  assert.equal(violation?.received, 'undefined')
})

test('id 为空串按无效处理（与网关同口径）', () => {
  const messages = [
    { role: 'assistant', tool_calls: [{ id: '', function: { name: 'read', arguments: '{}' } }] },
  ]

  const violation = findToolCallViolation(messages)

  assert.equal(violation?.path, 'messages[0].tool_calls[0].id')
  assert.equal(violation?.received, 'empty string')
})

test('缺少 function.name 时点名到 function.name', () => {
  const messages = [
    { role: 'assistant', tool_calls: [{ id: 'call_1', function: { arguments: '{}' } }] },
  ]

  const violation = findToolCallViolation(messages)

  assert.equal(violation?.path, 'messages[0].tool_calls[0].function.name')
  assert.equal(violation?.received, 'undefined')
})

test('tool_calls 不是数组时报出类型', () => {
  const messages = [{ role: 'assistant', tool_calls: { name: 'read' } }]

  const violation = findToolCallViolation(messages)

  assert.equal(violation?.path, 'messages[0].tool_calls')
  assert.equal(violation?.expected, 'an array')
  assert.equal(violation?.received, 'object')
})

test('tool_calls 元素不是对象时报出类型', () => {
  const messages = [{ role: 'assistant', tool_calls: ['call_1'] }]

  const violation = findToolCallViolation(messages)

  assert.equal(violation?.path, 'messages[0].tool_calls[0]')
  assert.equal(violation?.expected, 'an object')
  assert.equal(violation?.received, 'string')
})

test('arguments 为空串是合法的（网关接受空串参数）', () => {
  const messages = [
    { role: 'assistant', tool_calls: [{ id: 'call_1', function: { name: 'read', arguments: '' } }] },
  ]

  assert.equal(findToolCallViolation(messages), undefined)
})

test('非 assistant 角色的 tool_calls 不参与判定（网关也不读）', () => {
  const messages = [
    { role: 'user', content: 'hi', tool_calls: [{ id: '', function: {} }] },
    { role: 'tool', content: '42', tool_call_id: 'call_1' },
  ]

  assert.equal(findToolCallViolation(messages), undefined)
})

test('非数组的 messages 与缺字段的消息不报错（不是这一层的职责）', () => {
  assert.equal(findToolCallViolation(undefined), undefined)
  assert.equal(findToolCallViolation('not-an-array'), undefined)
  assert.equal(findToolCallViolation([null, 42, { role: 'assistant' }]), undefined)
})

test('报出的是第一条违规（顺序与网关一致：消息序、调用序）', () => {
  const messages = [
    { role: 'assistant', tool_calls: [{ id: 'ok', function: { name: 'a', arguments: '{}' } }] },
    { role: 'assistant', tool_calls: [
      { id: 'ok', function: { name: 'b', arguments: '{}' } },
      { id: 'ok', function: { name: 'c', arguments: 7 } },
    ] },
  ]

  const violation = findToolCallViolation(messages)

  assert.equal(violation?.path, 'messages[1].tool_calls[1].function.arguments')
})

test('assertValidToolCalls 对合法历史不抛错', () => {
  assert.doesNotThrow(() => assertValidToolCalls([
    { role: 'assistant', tool_calls: [validCall] },
  ]))
})

test('影子诊断：统计规范合法但上游可能不认的形状', () => {
  // 纯观测：它不进校验路径，只回答"缺 reasoning_content 占多少"这类问题。
  // 存在的理由见 countToolCallShapes 注释（请求体 1.8MB、日志只留开头 2%，
  // 从请求体取证结构性走不通）。
  const messages = [
    { role: 'system', content: 'x' },
    { role: 'assistant', content: 'no call here' },
    // 带 tool_calls 但缺 reasoning_content，且参数空串、名字带前缀
    { role: 'assistant', tool_calls: [{ id: 'a', function: { name: 'api:read', arguments: '' } }] },
    // 齐全：有 reasoning、有参数、裸名
    { role: 'assistant', reasoning_content: '想了', tool_calls: [{ id: 'b', function: { name: 'write', arguments: '{}' } }] },
  ]

  const counts = countToolCallShapes(messages)
  assert.equal(counts.assistantWithCalls, 2, '只数带 tool_calls 的 assistant 轮')
  assert.equal(counts.missingReasoning, 1)
  assert.equal(counts.emptyArguments, 1)
  assert.equal(counts.prefixedName, 1)
})

test('影子诊断：非法输入返回全 0，绝不抛错', () => {
  // 观测器不能在请求路径上制造新失败。
  for (const bad of [undefined, null, 'x', 42, {}]) {
    assert.deepEqual(countToolCallShapes(bad), {
      assistantWithCalls: 0, missingReasoning: 0, emptyArguments: 0, prefixedName: 0,
    })
  }
  assert.deepEqual(countToolCallShapes([null, 42, { role: 'user' }]), {
    assistantWithCalls: 0, missingReasoning: 0, emptyArguments: 0, prefixedName: 0,
  })
})

test('assertValidToolCalls 抛出的错误带 400（否则客户端收到 500 而非 invalid_request_error）', () => {
  const messages = [
    { role: 'assistant', tool_calls: [{ id: 'call_1', function: { name: 'read', arguments: {} } }] },
  ]

  assert.throws(
    () => assertValidToolCalls(messages),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal((error as { status?: number }).status, 400)
      assert.match(
        error.message,
        /messages\[0\]\.tool_calls\[0\]\.function\.arguments must be a string, received object/,
      )
      return true
    },
  )
})

// ── 调用↔结果配对 ────────────────────────────────────────────────────
// 起因（2026-11-11）：Codex 打 `codex` 线路时，同一份历史被 buddy/deepseek-v4-pro 与
// buddy/kimi-k3.1-pro 判 502「tool calls and tool results do not match」，换到
// buddy/mimo-v2.6-pro 才 200，此后整轮粘在弱候选上。判据、为何删除而非补结果、
// 以及本入口看不见的下游，都写在 repairToolCallPairing 的注释里。

const call = (id: string, name = 'exec_command') => ({
  id,
  type: 'function',
  function: { name, arguments: '{}' },
})
const toolResult = (id: string, content = 'ok') => ({ role: 'tool', tool_call_id: id, content })

test('配平的历史一个字节都不动，且返回同一个数组', () => {
  const messages = [
    { role: 'user', content: '继续' },
    { role: 'assistant', content: null, tool_calls: [call('call_1')] },
    toolResult('call_1'),
    { role: 'assistant', content: '做完', tool_calls: [call('call_2'), call('call_3')] },
    toolResult('call_2'),
    toolResult('call_3'),
  ]

  assert.deepEqual(findToolCallPairingDefects(messages), [])
  const repaired = repairToolCallPairing(messages)
  assert.equal(repaired.messages, messages, '无缺陷时不复制，避免每轮白拷 1.8MB')
  assert.equal(repaired.defects.length, 0)
})

test('声明了却没人回填的调用被删掉，正文保留', () => {
  const messages = [
    { role: 'assistant', content: '我先看一眼', tool_calls: [call('call_1', 'read')] },
    { role: 'user', content: '然后呢' },
  ]

  const defects = findToolCallPairingDefects(messages)
  assert.equal(defects.length, 1)
  assert.equal(defects[0]!.kind, 'unanswered_call')
  assert.equal(defects[0]!.path, 'messages[0].tool_calls[0]')
  assert.equal(defects[0]!.name, 'read')

  const repaired = repairToolCallPairing(messages)
  assert.equal((repaired.messages as unknown[]).length, 2)
  const kept = (repaired.messages as Record<string, unknown>[])[0]!
  assert.equal(kept.content, '我先看一眼')
  assert.equal('tool_calls' in kept, false, '调用清空后必须连键一起撤，留空数组上游照样拒')
  assert.equal(repaired.counts.unansweredCalls, 1)
})

test('content 为 null 且唯一调用无结果时整条 assistant 删除', () => {
  const messages = [
    { role: 'user', content: '跑一下' },
    { role: 'assistant', content: null, tool_calls: [call('call_1')] },
  ]

  const repaired = repairToolCallPairing(messages)
  assert.equal((repaired.messages as unknown[]).length, 1, '留着会变成空回复')
})

test('找不到调用的结果被删掉', () => {
  const messages = [
    toolResult('call_gone'),
    { role: 'user', content: 'hi' },
  ]

  const defects = findToolCallPairingDefects(messages)
  assert.equal(defects.length, 1)
  assert.equal(defects[0]!.kind, 'orphan_result')
  assert.equal(defects[0]!.path, 'messages[0]')

  const repaired = repairToolCallPairing(messages)
  assert.equal((repaired.messages as unknown[]).length, 1)
  assert.equal(repaired.counts.orphanResults, 1)
})

test('空 tool_call_id 的结果算孤儿（没有调用能匹配上它）', () => {
  const defects = findToolCallPairingDefects([toolResult(''), { role: 'tool', content: 'x' }])
  assert.equal(defects.length, 2)
  assert.ok(defects.every(defect => defect.kind === 'orphan_result'))
})

test('同一 call_id 重复声明时保留第一条、删掉后来的', () => {
  const messages = [
    { role: 'assistant', content: null, tool_calls: [call('call_1', 'first')] },
    { role: 'assistant', content: null, tool_calls: [call('call_1', 'second')] },
    toolResult('call_1'),
  ]

  const defects = findToolCallPairingDefects(messages)
  assert.equal(defects.length, 1)
  assert.equal(defects[0]!.kind, 'duplicate_call')
  assert.equal(defects[0]!.path, 'messages[1].tool_calls[0]')

  const repaired = repairToolCallPairing(messages)
  assert.equal((repaired.messages as unknown[]).length, 2, '第二条 assistant 整条消失')
  assert.equal(repaired.counts.duplicateCalls, 1)
})

test('同一调用被回填两次时保留第一条结果', () => {
  const messages = [
    { role: 'assistant', content: null, tool_calls: [call('call_1')] },
    toolResult('call_1', '第一份'),
    toolResult('call_1', '第二份'),
  ]

  const defects = findToolCallPairingDefects(messages)
  assert.equal(defects.length, 1)
  assert.equal(defects[0]!.kind, 'duplicate_result')
  assert.equal(defects[0]!.path, 'messages[2]')

  const repaired = repairToolCallPairing(messages)
  assert.equal((repaired.messages as unknown[]).length, 2)
  assert.deepEqual((repaired.messages as Record<string, unknown>[])[1]!.content, '第一份')
})

test('一条 assistant 里两个调用只缺一个结果时，只删那一个', () => {
  const messages = [
    { role: 'assistant', content: null, tool_calls: [call('call_1'), call('call_2')] },
    toolResult('call_2'),
  ]

  const repaired = repairToolCallPairing(messages)
  const kept = (repaired.messages as Record<string, unknown>[])[0]!
  assert.deepEqual((kept.tool_calls as unknown[]).map(item => (item as { id: string }).id), ['call_2'])
})

test('修复不改写入参数', () => {
  const messages = [
    { role: 'assistant', content: null, tool_calls: [call('call_1')] },
    toolResult('call_missing'),
  ]
  const snapshot = structuredClone(messages)

  repairToolCallPairing(messages)

  assert.deepEqual(messages, snapshot)
})

test('明细行只带坐标与 id，且超长时截断', () => {
  const messages = Array.from({ length: 20 }, (_, index) => ({
    role: 'assistant', content: null, tool_calls: [call(`call_${index}`)],
  }))

  const defects = findToolCallPairingDefects(messages)
  assert.equal(defects.length, 20)
  const line = formatToolCallPairing(defects)
  assert.match(line, /unanswered_call messages\[0\]\.tool_calls\[0\] \(call_0\)/)
  assert.doesNotMatch(line, /messages\[19\]/, '默认只留 12 条')
  assert.match(line, /另有 8 条同类/)
})

test('怪异输入不抛错：非数组原样返回，缺字段的消息跳过', () => {
  for (const bad of [undefined, null, 'x', 42, {}]) {
    assert.deepEqual(findToolCallPairingDefects(bad), [])
    const repaired = repairToolCallPairing(bad)
    assert.equal(repaired.messages, bad)
    assert.deepEqual(repaired.counts, {
      unansweredCalls: 0, duplicateCalls: 0, orphanResults: 0, duplicateResults: 0,
    })
  }
  assert.deepEqual(findToolCallPairingDefects([null, 42, { role: 'assistant' }]), [])
  // 缺 tool_call_id 的 tool 消息没人能匹配上它，按孤儿处理
  assert.equal(findToolCallPairingDefects([{ role: 'tool', content: 'x' }]).length, 1)
})

test('相邻性：结果与调用隔着用户消息时上提（2026-11-12 loomy 2013 现场）', () => {
  const messages = [
    { role: 'user', content: '查一下' },
    { role: 'assistant', content: null, tool_calls: [call('call_A')] },
    { role: 'user', content: '用前复权' },
    toolResult('call_A'),
  ]

  const repaired = repairToolCallAdjacency(messages)

  assert.equal(repaired.movedResults, 1)
  assert.notEqual(repaired.messages, messages)
  assert.deepEqual(repaired.messages, [
    { role: 'user', content: '查一下' },
    { role: 'assistant', content: null, tool_calls: [call('call_A')] },
    toolResult('call_A'),
    { role: 'user', content: '用前复权' },
  ])
})

test('相邻性：并行批的两条结果一起上提、保持原相对顺序', () => {
  const messages = [
    { role: 'assistant', content: null, tool_calls: [call('call_A'), call('call_B')] },
    { role: 'user', content: '插进来的' },
    toolResult('call_A'),
    toolResult('call_B'),
  ]

  const repaired = repairToolCallAdjacency(messages)

  assert.equal(repaired.movedResults, 2)
  assert.deepEqual(repaired.messages, [
    { role: 'assistant', content: null, tool_calls: [call('call_A'), call('call_B')] },
    toolResult('call_A'),
    toolResult('call_B'),
    { role: 'user', content: '插进来的' },
  ])
})

test('相邻性：良好历史一个字节不动，返回同一个数组', () => {
  const messages = [
    { role: 'user', content: '继续' },
    { role: 'assistant', content: null, tool_calls: [call('call_A'), call('call_B')] },
    toolResult('call_A'),
    toolResult('call_B'),
    { role: 'user', content: '谢谢' },
  ]

  const repaired = repairToolCallAdjacency(messages)

  assert.equal(repaired.movedResults, 0)
  assert.equal(repaired.messages, messages)
})

test('相邻性：同批结果之间的先后不算缺陷', () => {
  const messages = [
    { role: 'assistant', content: null, tool_calls: [call('call_A'), call('call_B')] },
    toolResult('call_B'),
    toolResult('call_A'),
  ]

  const repaired = repairToolCallAdjacency(messages)

  assert.equal(repaired.movedResults, 0)
  assert.equal(repaired.messages, messages)
})

test('相邻性：结果先于调用时上提到 assistant 紧后', () => {
  const messages = [
    toolResult('call_A'),
    { role: 'assistant', content: null, tool_calls: [call('call_A')] },
    { role: 'user', content: '后面' },
  ]

  const repaired = repairToolCallAdjacency(messages)

  assert.equal(repaired.movedResults, 1)
  assert.deepEqual(repaired.messages, [
    { role: 'assistant', content: null, tool_calls: [call('call_A')] },
    toolResult('call_A'),
    { role: 'user', content: '后面' },
  ])
})

test('相邻性：A 的结果前面隔着 B 的调用（原 2013 根因形状）也拆开', () => {
  const messages = [
    { role: 'assistant', content: null, tool_calls: [call('call_A')] },
    { role: 'assistant', content: null, tool_calls: [call('call_B')] },
    toolResult('call_A'),
    toolResult('call_B'),
  ]

  const repaired = repairToolCallAdjacency(messages)

  assert.equal(repaired.movedResults, 2)
  assert.deepEqual(repaired.messages, [
    { role: 'assistant', content: null, tool_calls: [call('call_A')] },
    toolResult('call_A'),
    { role: 'assistant', content: null, tool_calls: [call('call_B')] },
    toolResult('call_B'),
  ])
})

test('相邻性：空 id 的结果不归这里管，重排后仍在场', () => {
  const messages = [
    { role: 'assistant', content: null, tool_calls: [call('call_A')] },
    { role: 'tool', content: '没有 id' },
    toolResult('call_A'),
  ]

  const repaired = repairToolCallAdjacency(messages)

  assert.equal(repaired.movedResults, 1)
  const rebuilt = repaired.messages as Array<{ role: string; tool_call_id?: string }>
  assert.equal(rebuilt.length, 3)
  assert.deepEqual(rebuilt[0], { role: 'assistant', content: null, tool_calls: [call('call_A')] })
  assert.equal(rebuilt[1].tool_call_id, 'call_A')
  assert.deepEqual(rebuilt[2], { role: 'tool', content: '没有 id' })
})

test('相邻性：重排一次之后幂等', () => {
  const messages = [
    { role: 'assistant', content: null, tool_calls: [call('call_A')] },
    { role: 'user', content: '插进来的' },
    toolResult('call_A'),
  ]
  const first = repairToolCallAdjacency(messages)
  assert.equal(first.movedResults, 1)

  const second = repairToolCallAdjacency(first.messages)
  assert.equal(second.movedResults, 0)
  assert.equal(second.messages, first.messages)
})

test('相邻性：先配平再重排的组合（孤儿先删，重排不把垃圾上提）', () => {
  const messages = [
    { role: 'assistant', content: null, tool_calls: [call('call_A')] },
    toolResult('call_orphan'),
    { role: 'user', content: '插进来的' },
    toolResult('call_A'),
  ]
  const pairing = repairToolCallPairing(messages)
  assert.equal(pairing.defects.length, 1)
  assert.equal(pairing.defects[0].kind, 'orphan_result')

  const adjacency = repairToolCallAdjacency(pairing.messages)
  assert.equal(adjacency.movedResults, 1)
  assert.deepEqual(adjacency.messages, [
    { role: 'assistant', content: null, tool_calls: [call('call_A')] },
    toolResult('call_A'),
    { role: 'user', content: '插进来的' },
  ])
})

test('相邻性：怪异输入原样返回', () => {
  for (const bad of [undefined, null, 'x', 42, {}]) {
    const repaired = repairToolCallAdjacency(bad)
    assert.equal(repaired.messages, bad)
    assert.equal(repaired.movedResults, 0)
  }
  // 全程没有带 id 的调用时也不动
  const messages = [{ role: 'user', content: 'x' }, { role: 'tool', content: '没有 id' }]
  const repaired = repairToolCallAdjacency(messages)
  assert.equal(repaired.messages, messages)
  assert.equal(repaired.movedResults, 0)
})
