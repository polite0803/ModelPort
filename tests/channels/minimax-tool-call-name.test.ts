import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const VENDOR_SRC = join(ROOT, 'vendor', 'channel-pack', 'src')
const COMPAT_LLM = join(ROOT, 'src', 'main', 'channelPack', 'compat', 'dshLlm.ts')

/**
 * vendor 源码在 node --test 里**不能直接 import**（它依赖 `@deepseek-ai/dsh-llm`
 * 等虚拟模块，Node 解析不了）。这里用 esbuild 按 `scripts/build-channel-pack.mjs`
 * 的同一套别名打成一个临时 bundle 再 import —— 于是测试驱动的就是**生产用的那份
 * 源码**，而不是它的复制品。
 */
async function loadVendorBundle(t) {
  const esbuild = await import('esbuild')
  const dir = mkdtempSync(join(tmpdir(), 'channel-pack-vendor-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const outfile = join(dir, 'bundle.mjs')
  await esbuild.build({
    stdin: {
      contents: [
        `export { consumeMinimaxSse } from ${JSON.stringify(join(VENDOR_SRC, 'minimax-messages.ts'))}`,
        `export { toOpenAiSse } from ${JSON.stringify(join(VENDOR_SRC, 'openai-gateway', 'stream.ts'))}`,
      ].join('\n'),
      resolveDir: ROOT,
      loader: 'ts',
    },
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node20'],
    logLevel: 'warning',
    alias: { '@deepseek-ai/dsh-llm': COMPAT_LLM },
  })
  return await import(pathToFileURL(outfile).href)
}

/** MiniMax 的 Anthropic Messages SSE：一次工具调用。 */
const TOOL_CALL_SSE = [
  'event: message_start',
  'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_01","name":"get_stock_price","input":{}}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"code\\":\\"002837\\"}"}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":20}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
  '',
].join('\n')

function sseStream(text) {
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

/** 把网关投影出来的 SSE 文本解析回结构，便于断言。 */
function parseSseFrames(text) {
  return text
    .split('\n\n')
    .map(frame => frame.trim())
    .filter(frame => frame.startsWith('data: '))
    .map(frame => frame.slice('data: '.length))
    .filter(payload => payload !== '[DONE]')
    .map(payload => JSON.parse(payload) as Record<string, any>)
}

test('minimax 的工具调用在 OpenAI 形状的 tool_calls 里带上 function.name', async (t) => {
  const { consumeMinimaxSse, toOpenAiSse } = await loadVendorBundle(t)

  const chunks = []
  for await (const chunk of consumeMinimaxSse({ body: sseStream(TOOL_CALL_SSE) })) {
    chunks.push(chunk)
  }

  const frames = []
  for await (const frame of toOpenAiSse(
    (async function* () { yield* chunks })(),
    'chatcmpl-test',
    'minimax/model',
  )) {
    frames.push(frame)
  }

  const toolDeltas = parseSseFrames(frames.join(''))
    .flatMap(frame => frame.choices?.[0]?.delta?.tool_calls ?? [])
    .filter((call: Record<string, unknown>) => call.function?.name !== undefined)

  assert.ok(
    toolDeltas.length > 0,
    '工具调用的 delta 必须带 function.name，否则客户端回传历史时被网关判成非法调用',
  )
  assert.equal(toolDeltas[0].function.name, 'get_stock_price')
  assert.equal(toolDeltas[0].id, 'toolu_01')
})

test('minimax 的工具调用参数照常透传（name 的修复没有吞掉 arguments）', async (t) => {
  const { consumeMinimaxSse, toOpenAiSse } = await loadVendorBundle(t)

  const chunks = []
  for await (const chunk of consumeMinimaxSse({ body: sseStream(TOOL_CALL_SSE) })) {
    chunks.push(chunk)
  }

  const frames = []
  for await (const frame of toOpenAiSse(
    (async function* () { yield* chunks })(),
    'chatcmpl-test',
    'minimax/model',
  )) {
    frames.push(frame)
  }

  const argumentsText = parseSseFrames(frames.join(''))
    .flatMap(frame => frame.choices?.[0]?.delta?.tool_calls ?? [])
    .map((call: Record<string, any>) => call.function?.arguments ?? '')
    .join('')

  assert.equal(argumentsText, '{"code":"002837"}')
})

/** 思考块(0) + 工具块(1)：2026-10-31 本机 Qoder 报障的真实块序（incomplete_tool_replaced）。 */
const THINKING_THEN_TOOL_SSE = [
  'event: message_start',
  'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"let me list"}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_02","name":"mcp_list","input":{}}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{}"}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":1}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":20}}',
  '',
  'event: message_stop',
  '',
  '',
].join('\n')

test('思考块占用内部 index 0 时，tool_calls 必须重编号为密集 0（不能凭空 index:1）', async (t) => {
  const { consumeMinimaxSse, toOpenAiSse } = await loadVendorBundle(t)

  const chunks = []
  for await (const chunk of consumeMinimaxSse({ body: sseStream(THINKING_THEN_TOOL_SSE) })) {
    chunks.push(chunk)
  }

  const frames = []
  for await (const frame of toOpenAiSse(
    (async function* () { yield* chunks })(),
    'chatcmpl-test',
    'minimax/model',
  )) {
    frames.push(frame)
  }

  const toolDeltas = parseSseFrames(frames.join(''))
    .flatMap(frame => frame.choices?.[0]?.delta?.tool_calls ?? [])

  assert.ok(toolDeltas.length > 0, '必须下发 tool_calls')
  for (const call of toolDeltas) {
    assert.equal(call.index, 0, `tool_calls index 必须是密集 0，收到 ${call.index}`)
  }
  assert.equal(toolDeltas[0].function.name, 'mcp_list')
})

/** 缺必填键的工具调用：finish 判据命中 → 缓冲发弃（2026-10-31 审计补齐）。 */
const MISSING_REQUIRED_TOOL_SSE = [
  'event: message_start',
  'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_10","name":"Bash","input":{}}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"description\\":\\"列出文件\\"}"}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":20}}',
  '',
  'event: message_stop',
  '',
  '',
].join('\n')

/** 流被掐断：有工具分片但没有 message_delta（stop_reason 缺失）。 */
const TRUNCATED_TOOL_SSE = [
  'event: message_start',
  'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_11","name":"Bash","input":{}}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"command\\":\\"ls"}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0}',
  '',
  '',
].join('\n')

async function projectMinimax(t, sseText, options = {}) {
  const { consumeMinimaxSse, toOpenAiSse } = await loadVendorBundle(t)
  const chunks = []
  for await (const chunk of consumeMinimaxSse({ body: sseStream(sseText), ...options })) {
    chunks.push(chunk)
  }
  const frames = []
  for await (const frame of toOpenAiSse(
    (async function* () { yield* chunks })(),
    'chatcmpl-test',
    'minimax/model',
  )) {
    frames.push(frame)
  }
  return parseSseFrames(frames.join(''))
}

test('缺必填键的工具调用：分片缓冲发弃，客户端只见 incomplete_step 错误帧（无 tool_calls）', async (t) => {
  const frames = await projectMinimax(t, MISSING_REQUIRED_TOOL_SSE, {
    toolsRequiringArgs: new Map([['Bash', ['command']]]),
  })

  const toolDeltas = frames.flatMap(frame => frame.choices?.[0]?.delta?.tool_calls ?? [])
  assert.equal(toolDeltas.length, 0, `命中缺参判据后不得下发任何 tool_calls 分片，收到 ${JSON.stringify(toolDeltas)}`)

  // 2026-11-13 契约变更：合成 incomplete 不再冒充输出上限（`length` 会让 Codex
  // 报「max_output_tokens」并就地结束回合），改走可重试的错误帧。
  assert.equal(frames.some(frame => frame.choices?.[0]?.finish_reason != null), false)
  const error = frames.find(frame => frame.error !== undefined)
  assert.equal(error?.error?.code, 'incomplete_step', '必须以有分辨力的错误码收场让客户端重试')
})

test('流被掐断（无 stop_reason）：工具分片缓冲发弃，收场是 incomplete_step 错误帧', async (t) => {
  const frames = await projectMinimax(t, TRUNCATED_TOOL_SSE)

  const toolDeltas = frames.flatMap(frame => frame.choices?.[0]?.delta?.tool_calls ?? [])
  assert.equal(toolDeltas.length, 0, `截断流不得下发任何 tool_calls 分片，收到 ${JSON.stringify(toolDeltas)}`)

  assert.equal(frames.some(frame => frame.choices?.[0]?.finish_reason != null), false)
  assert.equal(frames.find(frame => frame.error !== undefined)?.error?.code, 'incomplete_step')
})

test('判据未命中：缓冲的分片照常原序补发（block-start → deltas → block-end）', async (t) => {
  const frames = await projectMinimax(t, MISSING_REQUIRED_TOOL_SSE, {
    toolsRequiringArgs: new Map([['Bash', ['description']]]), // description 存在 → 放行
  })

  const toolDeltas = frames.flatMap(frame => frame.choices?.[0]?.delta?.tool_calls ?? [])
  assert.ok(toolDeltas.length > 0, '判据未命中时必须下发工具分片')
  const argumentsText = toolDeltas.map(call => call.function?.arguments ?? '').join('')
  assert.equal(argumentsText, '{"description":"列出文件"}')

  const finish = frames.find(frame => frame.choices?.[0]?.finish_reason != null)
  assert.equal(finish?.choices?.[0]?.finish_reason, 'tool_calls')
})
