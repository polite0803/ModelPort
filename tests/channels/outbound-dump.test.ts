/**
 * 出站取证摘要的纯函数测试（无 electron、无网络、无文件写入）。
 *
 * 钉住的语义：
 * 1. 开关取值 → 路径的三种解析（关 / 默认位置 / 自定义路径）；
 * 2. 摘要里**只有**末尾片段，不含整条正文（取证开关不许变成第二份用户数据）；
 * 3. OpenAI 形状与 harness 形状都要能读出「最后一条是不是带 `<user_query>` 的 user」；
 * 4. 工具调用留条数与名称，不留 arguments 内容；
 * 5. 超长会话按条数截断并给出溢出条数。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DUMP_MAX_MESSAGES,
  resolveDumpTarget,
  summarizeOutbound,
} from '../../src/main/channelPack/outboundDump.ts'

test('开关解析：未设置与 0 关闭，1 落到数据目录，其它值当路径', () => {
  assert.equal(resolveDumpTarget(undefined, '/data'), null)
  assert.equal(resolveDumpTarget('', '/data'), null)
  assert.equal(resolveDumpTarget('  ', '/data'), null)
  assert.equal(resolveDumpTarget('0', '/data'), null)

  const defaulted = resolveDumpTarget('1', '/data')
  assert.ok(defaulted && defaulted.includes('channel-pack'), '默认位置在 channel-pack 子目录')
  assert.ok(defaulted && defaulted.endsWith('outbound-dump.ndjson'))

  assert.equal(resolveDumpTarget('/tmp/pin.ndjson', '/data'), '/tmp/pin.ndjson')
  assert.equal(resolveDumpTarget('TRUE', '/data')?.includes('outbound-dump.ndjson'), true)
})

test('摘要只留末尾片段，不复制整条正文', () => {
  const secret = `正文开头标记${'很长的用户正文。'.repeat(200)}\n<user_query>继续</user_query>`
  const record = summarizeOutbound({
    ts: 1,
    requestId: 'r1',
    model: 'buddy/hy3',
    stream: true,
    openAiMessages: [{ role: 'user', content: secret }],
    harnessMessages: [{ role: 'user', content: [{ type: 'text', text: secret }] }],
    tailChars: 40,
  })

  assert.equal(record.openAi[0].chars, secret.length, '长度是全文长度，内容只留尾巴')
  assert.equal(record.openAi[0].tail, secret.slice(-40))
  assert.ok(!JSON.stringify(record).includes('正文开头标记'), '尾巴以外的正文不得落盘')
  assert.ok(record.openAi[0].tail.includes('<user_query>继续</user_query>'), '尾巴要够长到能看见指令')
  assert.equal(JSON.stringify(record).length < 2000, true, '整条记录必须远小于原文')
  assert.equal(record.harness[0].tail, secret.slice(-40), '两种形状读到同一条尾巴')
})

test('能读出「最后一条是带 user_query 的 user」，含多模态数组形状', () => {
  const record = summarizeOutbound({
    ts: 1,
    requestId: 'r2',
    model: 'buddy/hy3',
    stream: false,
    openAiMessages: [
      { role: 'system', content: '你是助手' },
      { role: 'user', content: [{ type: 'text', text: '<user_query>实施顺序：⑨→①</user_query>' }] },
    ],
    harnessMessages: [
      { role: 'system', content: [{ type: 'text', text: '你是助手' }] },
      { role: 'user', content: [{ type: 'text', text: '<user_query>实施顺序：⑨→①</user_query>' }] },
    ],
  })

  assert.equal(record.openAi.at(-1)?.role, 'user')
  assert.match(record.openAi.at(-1)?.tail ?? '', /<user_query>.*<\/user_query>/)
  assert.equal(record.harness.at(-1)?.role, 'user')
  assert.deepEqual(record.harness.at(-1)?.blocks, ['text'])
  assert.equal(record.openAiChars, record.openAi.reduce((n, m) => n + m.chars, 0))
})

test('工具调用留条数与名称，harness 的 tool-result 归属 id 也留', () => {
  const record = summarizeOutbound({
    ts: 1,
    requestId: 'r3',
    model: 'workbuddy/hy3',
    stream: true,
    openAiMessages: [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"/etc/secret"}' } },
          { id: 'call_2', type: 'function', function: { name: 'bash', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '内容' },
    ],
    harnessMessages: [
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: '想' },
          { type: 'tool-call', id: 'call_1', name: 'read_file', arguments: '{"path":"/etc/secret"}' },
        ],
      },
      { role: 'user', content: [{ type: 'tool-result', toolCallId: 'call_1', content: '内容' }] },
    ],
  })

  assert.equal(record.openAi[0].toolCalls, 2)
  assert.deepEqual(record.openAi[0].toolNames, ['read_file', 'bash'])
  assert.ok(!JSON.stringify(record).includes('/etc/secret'), 'arguments 内容不得进取证文件')
  assert.equal(record.openAi[1].toolCallId, 'call_1')
  assert.deepEqual(record.harness[0].blocks, ['reasoning', 'tool-call'])
  assert.deepEqual(record.harness[0].toolNames, ['read_file'])
  assert.equal(record.harness[1].toolCallId, 'call_1', 'harness 的 tool-result 要能看出归属')
})

test('超长会话按条数截断并报告溢出', () => {
  const many = Array.from({ length: DUMP_MAX_MESSAGES + 7 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `#${i}`,
  }))
  const record = summarizeOutbound({
    ts: 1,
    requestId: 'r4',
    model: 'buddy/hy3',
    stream: true,
    openAiMessages: many,
    harnessMessages: many,
  })

  assert.equal(record.openAi.length, DUMP_MAX_MESSAGES)
  assert.equal(record.overflow, 7)
})

test('坏形状不抛错（缺 role / 非对象条目按 unknown 记账）', () => {
  const record = summarizeOutbound({
    ts: 1,
    requestId: 'r5',
    model: 'buddy/hy3',
    stream: true,
    openAiMessages: [null, 'oops', { content: 'no role' }],
    harnessMessages: [],
  })

  assert.equal(record.openAi.length, 3)
  assert.equal(record.openAi[0].role, 'unknown')
  assert.equal(record.openAi[2].role, 'unknown')
  assert.equal(record.harness.length, 0)
})
