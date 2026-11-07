import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  readUsageFromBody,
  readUsageFromSse,
  estimateTokens,
  readOrEstimateUsage,
  sseDeltaText,
  usageInputText,
} from '../../src/main/proxy/quota/usage.ts'

test('non-stream usage is read only when the upstream actually reports it', () => {
  const usage = readUsageFromBody({ usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 } })
  assert.deepEqual(usage, { promptTokens: 120, completionTokens: 30, totalTokens: 150 })

  assert.equal(readUsageFromBody({ choices: [] }), null, 'absent usage must stay absent')
  assert.equal(readUsageFromBody(null), null)
  assert.equal(
    readUsageFromBody({ usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }),
    null,
    'an all-zero block is the fabricated shape, not a measurement'
  )
})

test('total is derived when the upstream omits it but reports the parts', () => {
  const usage = readUsageFromBody({ usage: { prompt_tokens: 40, completion_tokens: 8 } })
  assert.equal(usage?.totalTokens, 48)
})

test('streaming usage is taken from the last chunk that carries it', () => {
  const raw = [
    'data: {"choices":[{"delta":{"content":"he"}}]}',
    '',
    'data: {"choices":[{"delta":{"content":"llo"}}]}',
    '',
    'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18}}',
    '',
    'data: [DONE]',
    '',
  ].join('\n')

  assert.deepEqual(readUsageFromSse(raw), { promptTokens: 11, completionTokens: 7, totalTokens: 18 })
  assert.equal(readUsageFromSse('data: {"choices":[]}\n\ndata: [DONE]\n'), null)
  assert.deepEqual(
    readUsageFromSse('data: not-json\n\ndata: {"usage":{"prompt_tokens":5,"completion_tokens":5,"total_tokens":10}}\n'),
    { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
    'a malformed frame must not stop the scan from reaching a good one'
  )
})

test('the estimate never masquerades as an upstream reading', () => {
  assert.equal(estimateTokens(''), 0)
  assert.equal(estimateTokens('abcd'), 1)
  assert.equal(estimateTokens('abcde'), 2, 'rounding is ceil, not floor')

  const estimated = readOrEstimateUsage('a'.repeat(40), 'b'.repeat(8))
  assert.equal(estimated.source, 'estimated')
  assert.equal(estimated.promptTokens, 10)
  assert.equal(estimated.completionTokens, 2)
  assert.equal(estimated.totalTokens, 12)

  const upstream = readOrEstimateUsage('a'.repeat(40), 'b'.repeat(8), {
    usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
  })
  assert.equal(upstream.source, 'upstream')
  assert.equal(upstream.totalTokens, 7, 'a reported figure always beats the estimate')
})

test('the estimate bills what the model wrote, not the SSE framing', () => {
  // 这条测试是那次实测失真的围栏：一帧 `data: {…,"delta":{"content":"X"}}` 约
  // 150–260 个字符换 1 个 token。估算过去直接吃原始 SSE，output 虚高 40–65 倍，
  // 于是账本把 `smart` / `pace` 负载均衡的排序输入也一起弄错了（TRAE 上一个
  // 声明窗口只有 200K 的模型，算出平均 503,769 token/请求）。
  const frame = (content: string): string =>
    `data: ${JSON.stringify({
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      created: 1_730_000_000,
      model: 'some-model',
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
    })}\n\n`
  const raw = frame('hello') + frame(' world')

  const reading = readOrEstimateUsage('x'.repeat(40), raw)
  assert.equal(reading.source, 'estimated')
  assert.equal(reading.completionTokens, 3, '11 characters of actual model text, ceil(/4)')
  assert.ok(
    reading.completionTokens < estimateTokens(raw) / 10,
    'frame bytes must never be counted as model output',
  )
})

test('SSE without model text estimates zero output; non-SSE passes through', () => {
  // 只有 usage/错误帧 = 模型没写正文，估成 0 是对的；把帧壳算进去才是错。
  assert.equal(sseDeltaText('data: {"choices":[],"usage":{"total_tokens":5}}\n\ndata: [DONE]\n\n'), '')
  // 非流式路径传进来的是纯正文。不含 `data:` 行时**必须**原样返回，否则这条
  // 路径的 output 会被整段抹成 0（比虚高更糟：它把"答了"记成"没答"）。
  assert.equal(sseDeltaText('plain answer text'), 'plain answer text')
  // 工具调用参数是真实的 output token，漏它就是低估。
  const call = 'data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"read_file","arguments":"{\\"p\\":\\"a\\"}"}}]}}]}\n\n'
  const extracted = sseDeltaText(call)
  assert.ok(extracted.includes('{"p":"a"}') && extracted.includes('read_file'), extracted)
})

test('the input estimate includes tool schemas, not only messages', () => {
  // agent 客户端（DSH / Codex 这类）每轮都带全量 tools，那往往是 input 里最大的
  // 一块。旧写法 `JSON.stringify(request.messages)` 漏掉它，于是"每轮重放的代价"
  // 被系统性低估 —— 而那个数字正是判断要不要做压缩的依据。
  const request = {
    messages: [{ role: 'user', content: 'hi' }],
    tools: [{ type: 'function', function: { name: 'x', description: 'd'.repeat(400) } }],
  }
  assert.ok(
    estimateTokens(usageInputText(request)) > estimateTokens(JSON.stringify(request.messages)),
    'tools must enter the input estimate',
  )
  assert.equal(estimateTokens(usageInputText({})), 0, 'an empty request is zero, not a guess')
})

test('cache reads are read through, and stay absent when unreported', () => {
  const withCache = readUsageFromBody({
    usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, prompt_tokens_details: { cached_tokens: 80 } },
  })
  assert.equal(withCache?.cacheReadTokens, 80)
  // 平铺写法（部分网关）也要认。
  assert.equal(
    readUsageFromBody({ usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, prompt_cache_hit_tokens: 70 } })
      ?.cacheReadTokens,
    70,
  )
  // ⚠️ 核心：上游没报就**整个字段缺省**，绝不写 0。`0` 是一个断言（"这轮没命中"），
  // 缺省才是事实（"这轮没告诉我们"）。绝大多数渠道不报 usage，也就都不报命中；
  // 把它们记成 0 会让仪表盘宣称"缓存完全没用上"，而我们并没有这个测量。
  assert.equal(
    'cacheReadTokens' in (readUsageFromBody({ usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } }) ?? {}),
    false,
  )
  assert.equal(
    readUsageFromBody({
      usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, prompt_tokens_details: { cached_tokens: 0 } },
    })?.cacheReadTokens,
    undefined,
  )
  // 但「报了 0」与「没报」必须可分：分模型命中率的分母只收前者。
  assert.equal(
    readUsageFromBody({
      usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, prompt_tokens_details: { cached_tokens: 0 } },
    })?.cacheReadReported,
    true,
  )
  assert.equal(
    readUsageFromBody({ usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })
      ?.cacheReadReported,
    undefined,
  )
})
