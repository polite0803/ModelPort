/**
 * 裁剪上限必须是**硬约束**：输出永远不超过 `maxTokens`。
 *
 * 回归背景（2026-11-16，现网火山 Agent Plan 烧穿 5 小时窗）。`TokenLimitStrategy`
 * 有两条独立的路让上限变成建议值：
 *
 * 1. 最新一条自己就超预算时，它被**原样**保留（本意是别把历史裁成空数组）；
 *    于是单条 tool 结果（一次文件读/搜索结果）能带着整笔请求远超上限 ——
 *    实测 125,024 token 打在 65,536 上（1.9x）。
 * 2. `trimmed` 由**消息条数**推导，而截断不改条数：日志写「Trimmed from 4 to 4」，
 *    调用方据此判定「什么都没发生」并丢弃结果，超预算的原文照发。
 *
 * 判据是方向而不是某个具体数字：任意输入下 `est(out) <= maxTokens`，且裁断后
 * 仍有东西可回答（不是空数组）。另外两条负控保证断言有分辨力。
 *
 * 纯函数层，无 store、无 electron、无网络（CCR 写入失败也只降级成「无指针」）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ContextManagementService,
  TokenLimitStrategy,
  DEFAULT_TOKEN_LIMIT_CONFIG,
} from '../../src/main/proxy/services/contextManagementService.ts'
import type { ChatMessage } from '../../src/main/proxy/types.ts'

const msg = (role: ChatMessage['role'], length: number): ChatMessage =>
  ({ role, content: 'x'.repeat(length) }) as ChatMessage

/** 中文正文：1.5 字符/token，与压缩侧的标定表一致。 */
const cjk = (role: ChatMessage['role'], repeats: number): ChatMessage =>
  ({ role, content: '这是一条很长的中文搜索结果内容，包含大量无关字段和重复数据。'.repeat(repeats) }) as ChatMessage

const strategy = (maxTokens: number, extra: Partial<Parameters<typeof DEFAULT_TOKEN_LIMIT_CONFIG> & object> = {}) =>
  new TokenLimitStrategy({ ...DEFAULT_TOKEN_LIMIT_CONFIG, enabled: true, maxTokens, ...extra })

const est = (messages: ChatMessage[]) => ContextManagementService.estimateTotalTokens(messages)

test('单条超大 tool 结果：输出落在上限内（这是 1.9x 的那一格）', () => {
  // 198,014 字符中文 ≈ 132,000 token，远超 65,536。
  const huge = cjk('tool', 6000)
  assert.ok(est([huge]) > 65_536, '前置：这一条自己就必须超过上限，否则断言恒真')

  const result = strategy(65_536).execute([
    msg('system', 3000),
    { role: 'user', content: '继续' } as ChatMessage,
    huge,
  ])

  const tokens = est(result.messages)
  assert.ok(tokens <= 65_536, `输出必须 ≤ 上限，实际 ${tokens}`)
  assert.equal(result.messages.length, 3, '不是清空历史，而是把超大的一条截短')
  assert.equal(result.trimmed, true, '必须报「裁过」')
  assert.equal(result.rewrote, true, '条数没变、内容变了')
})

test('截断留下可取回的指针，而不是静默丢字节', () => {
  const huge = cjk('tool', 6000)
  const result = strategy(20_000).execute([huge])
  const content = String(result.messages[0]?.content ?? '')

  // 指针要带 hash（CCR 落盘成功时）或明确说原文不可取（落盘失败时）——
  // 两种都比「悄悄少了一半」诚实。
  assert.match(
    content,
    /chars dropped to fit the context budget\./,
    '被截断的消息必须自己说明它被截断了',
  )
  assert.ok(
    /Retrieve more: hash=[a-f0-9]{24}/.test(content) || content.includes('Original unavailable to retrieve.'),
    `截断指针要么可取回要么明确不可取，实际尾部: ${JSON.stringify(content.slice(-120))}`,
  )
})

test('不许二次截断：已带标记的消息原样通过', () => {
  const once = strategy(20_000).execute([cjk('tool', 6000)])
  const twice = strategy(20_000).execute(once.messages)
  assert.equal(
    String(twice.messages[0]?.content),
    String(once.messages[0]?.content),
    '第二遍再截会把「标记的尾巴」当成正文，指针与原文就不再对应',
  )
})

test('硬约束：无论形状如何，输出都不超上限', () => {
  const cap = 8_000
  const cases: ChatMessage[][] = [
    // 单条超预算
    [cjk('user', 2000)],
    // 系统块 + 首条任务 + 尾部 tool：三份预留互相挤压
    [msg('system', 6000), cjk('user', 1500), msg('assistant', 3000), cjk('tool', 4000)],
    // tool 组被切开的情形
    [
      msg('system', 900),
      msg('user', 900),
      { role: 'assistant', content: 'x'.repeat(900), tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }] } as ChatMessage,
      cjk('tool', 3000),
    ],
    // 多条中等大小的 tool 结果（裁剪点落在组中间）
    [msg('system', 300), cjk('tool', 800), cjk('tool', 800), cjk('tool', 800)],
  ]

  for (const [index, messages] of cases.entries()) {
    const before = est(messages)
    const result = strategy(cap).execute(messages)
    const after = est(result.messages)
    assert.ok(after <= cap, `case ${index}: 输出 ${after} 超过上限 ${cap}（输入 ${before}）`)
    assert.ok(result.messages.length > 0, `case ${index}: 不许裁成空数组`)
    assert.ok(
      result.messages.some(message => message.role !== 'system'),
      `case ${index}: 只剩系统提示 = 没有要回答的话`,
    )
  }
})

test('负控：不截断时输出等于输入 —— 「≤上限」不是靠乱删通过的', () => {
  const small = [msg('system', 300), msg('user', 300)]
  const result = strategy(65_536).execute(small)
  assert.equal(est(result.messages), est(small))
  assert.equal(result.trimmed, false)
  assert.equal(result.rewrote, false)
  // 逐条引用相同：这条路径一个字节都不许改（`taskPrefix`/`toolGroupStart`
  // 会用 slice 重建数组，所以比的是元素而不是数组本身）。
  assert.deepEqual(result.messages, small, '没有可裁的就不许动内容')
  result.messages.forEach((message, index) => {
    assert.equal(message, small[index], `第 ${index} 条必须还是同一对象（未被重写）`)
  })
})

test('负控：把上限调到输入之上，上一条硬约束就不该再触发截断', () => {
  const huge = cjk('tool', 200)
  const generous = strategy(10_000_000).execute([huge])
  assert.equal(generous.trimmed, false)
  assert.equal(est(generous.messages), est([huge]))

  // 同一份输入，上限压到它之下 —— 这次必须截断。两次对照证明上一条断言测的是
  // 上限本身，而不是「这条消息恰好没超」。
  const tight = strategy(1_000).execute([huge])
  assert.equal(tight.trimmed, true)
  assert.ok(est(tight.messages) <= 1_000)
})

test('中文按 1.5 字符/token 计价：不再用 3 把预算算大一倍', () => {
  // 900 字符中文：旧口径 ceil(900/3)=300，实际约 600 token。
  const text = '这是一条很长的中文搜索结果内容包含大量无关字段和重复数据'.repeat(20) // 600 chars
  const tokens = est([{ role: 'user', content: text } as ChatMessage])
  assert.ok(tokens > text.length / 2, `中文必须按更贵的口径计价（${tokens} token / ${text.length} 字符）`)

  // 拉丁文保持历史口径：3 字符/token，既有数值预期不变。
  const latin = est([msg('user', 900)])
  assert.equal(latin, 300)
})