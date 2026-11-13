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
 * vendor 源码在 node --test 里**不能直接 import**（依赖 `@deepseek-ai/dsh-llm`
 * 虚拟模块）。与 `minimax-tool-call-name.test.ts` 同一套路：esbuild 按生产构建
 * 的同一套别名打临时 bundle 再 import —— 测的就是生产那份源码。
 */
async function loadVendorBundle(t: { after: (fn: () => void) => void }): Promise<VendorBundle> {
  const esbuild = await import('esbuild')
  const dir = mkdtempSync(join(tmpdir(), 'channel-pack-vendor-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const outfile = join(dir, 'bundle.mjs')
  await esbuild.build({
    stdin: {
      contents: [
        `export { consumeOpenAiSse, toolNamesRequiringArgs, requiredArgsToolsOption } from ${JSON.stringify(join(VENDOR_SRC, 'openai-compat.ts'))}`,
        `export { consumeMinimaxSse } from ${JSON.stringify(join(VENDOR_SRC, 'minimax-messages.ts'))}`,
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
  return await import(pathToFileURL(outfile).href) as VendorBundle
}

interface ToolDef {
  name: string
  parameters?: Record<string, unknown>
}

interface VendorBundle {
  consumeOpenAiSse: (
    response: Response,
    options: { signal?: AbortSignal },
    config: {
      label: string
      firstTokenTimeoutMs: number
      chunkTimeoutMs: number
      restoreToolName?: (name: string) => string
      toolsRequiringArgs?: ReadonlyMap<string, readonly string[]>
    },
  ) => AsyncIterable<Record<string, unknown>>
  consumeMinimaxSse: (options: {
    body: ReadableStream<Uint8Array>
    signal?: AbortSignal
    toolsRequiringArgs?: ReadonlyMap<string, readonly string[]>
  }) => AsyncIterable<Record<string, unknown>>
  toolNamesRequiringArgs: (tools: readonly ToolDef[] | undefined) => Map<string, readonly string[]>
  requiredArgsToolsOption: (tools: readonly ToolDef[] | undefined) => { toolsRequiringArgs?: ReadonlyMap<string, readonly string[]> }
}

/** harness 工具表：mcp_get 必填 toolName，mcp_list 无必填参数（与线上客户端一致）。 */
const AGENT_TOOLS: ToolDef[] = [
  {
    name: 'mcp_get',
    parameters: {
      type: 'object',
      properties: { toolName: { type: 'string' } },
      required: ['toolName'],
      additionalProperties: false,
    },
  },
  {
    name: 'mcp_list',
    parameters: { type: 'object', properties: { keyword: { type: 'string' } } },
  },
]

/** 把 SSE 帧序列包成 Response（consumeOpenAiSse 只读 body 流）。 */
function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder()
  let cursor = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (cursor < frames.length) controller.enqueue(encoder.encode(frames[cursor++]))
      else controller.close()
    },
  })
  return new Response(body)
}

/** 一次工具调用的 SSE 帧序列；argsFragment 为 undefined 表示根本没有 arguments 字段。 */
function toolCallFrames(name: string, argsFragment: string | undefined): string[] {
  const fn: Record<string, unknown> = { name }
  if (argsFragment !== undefined) fn.arguments = argsFragment
  return [
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: fn }] } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`,
    'data: [DONE]\n\n',
  ]
}

interface FinishReasonView {
  kind: string
  incompleteCause?: string
  incompleteDetail?: string
}

async function consume(
  bundle: VendorBundle,
  frames: string[],
  options: {
    tools?: readonly ToolDef[]
    restoreToolName?: (name: string) => string
  } = {},
): Promise<{ finishKind: string; reason: FinishReasonView; emittedArguments: string[] }> {
  const chunks: Array<Record<string, unknown>> = []
  for await (const chunk of bundle.consumeOpenAiSse(sseResponse(frames), {}, {
    label: 'test',
    firstTokenTimeoutMs: 5000,
    chunkTimeoutMs: 5000,
    ...options.restoreToolName !== undefined ? { restoreToolName: options.restoreToolName } : {},
    ...bundle.requiredArgsToolsOption(options.tools),
  })) {
    chunks.push(chunk)
  }
  const finish = chunks.find(chunk => chunk.type === 'finish') as { reason: FinishReasonView } | undefined
  const emittedArguments = chunks
    .filter(chunk => chunk.type === 'block-end'
      && (chunk.block as { type?: string } | undefined)?.type === 'tool-call')
    .map(chunk => (chunk.block as { arguments: string }).arguments)
  return {
    finishKind: finish?.reason.kind ?? 'none',
    reason: finish?.reason ?? { kind: 'none' },
    emittedArguments,
  }
}

test('toolNamesRequiringArgs 只收 required 非空的工具', async (t) => {
  const { toolNamesRequiringArgs } = await loadVendorBundle(t)
  assert.deepEqual([...toolNamesRequiringArgs(AGENT_TOOLS).keys()], ['mcp_get'])
  assert.deepEqual(toolNamesRequiringArgs(AGENT_TOOLS).get('mcp_get'), ['toolName'])
  // 无 required / 空 required 数组 / 缺 parameters → 不收
  assert.equal(toolNamesRequiringArgs([
    { name: 'a', parameters: { type: 'object', properties: {} } },
    { name: 'b', parameters: { type: 'object', required: [] } },
    { name: 'c' },
  ]).size, 0)
  assert.equal(toolNamesRequiringArgs(undefined).size, 0)
})

test('requiredArgsToolsOption 无必填工具时完全省略字段（判据关闭）', async (t) => {
  const { requiredArgsToolsOption } = await loadVendorBundle(t)
  assert.deepEqual(requiredArgsToolsOption(AGENT_TOOLS), { toolsRequiringArgs: new Map([['mcp_get', ['toolName']]]) })
  assert.deepEqual(requiredArgsToolsOption([{ name: 'mcp_list', parameters: { type: 'object' } }]), {})
  assert.deepEqual(requiredArgsToolsOption(undefined), {})
})

test('必填参数工具 + 空参数分片 → finish 报 max-tokens（重试，不放行 {}）', async (t) => {
  const bundle = await loadVendorBundle(t)
  const result = await consume(bundle, toolCallFrames('mcp_get', ''), { tools: AGENT_TOOLS })
  assert.equal(result.finishKind, 'max-tokens')
  // 文案要能回答「哪个工具、缺哪个键」：只有成因时，客户端与日志都无从判断
  // 是模型系统性缺陷还是单发（2026-11-13 Codex 报障）。
  assert.equal(result.reason.incompleteDetail, 'mcp_get 缺 toolName')
})

test('必填参数工具 + 完全没有 arguments 字段 → 同样报 max-tokens', async (t) => {
  const bundle = await loadVendorBundle(t)
  const result = await consume(bundle, toolCallFrames('mcp_get', undefined), { tools: AGENT_TOOLS })
  assert.equal(result.finishKind, 'max-tokens')
})

test('必填参数工具 + 显式空对象 {} → 同样报 max-tokens', async (t) => {
  const bundle = await loadVendorBundle(t)
  const result = await consume(bundle, toolCallFrames('mcp_get', '{}'), { tools: AGENT_TOOLS })
  assert.equal(result.finishKind, 'max-tokens')
  // 缓冲发弃（2026-10-31 Qoder incomplete_tool_replaced）：流式分片连同 block-end
  // 一并丢弃，残缺调用彻底不外泄，客户端只见正文 + 截断收场。
  assert.deepEqual(result.emittedArguments, [])
})

test('必填参数工具 + 部分参数缺必填键（02:23 Bash 形态）→ max-tokens，说明列出缺的键', async (t) => {
  const bundle = await loadVendorBundle(t)
  // 非空、合法 JSON，但缺 toolName —— 客户端照样报 required property
  const result = await consume(
    bundle,
    toolCallFrames('mcp_get', '{"keyword":"weather"}'),
    { tools: AGENT_TOOLS },
  )
  assert.equal(result.finishKind, 'max-tokens')
  assert.equal(result.reason.incompleteDetail, 'mcp_get 缺 toolName',
    '部分缺键与空参数是同一成因、不同形态：说明必须列出真实缺的键')
})

test('必填参数工具 + 必填键齐全（哪怕别的键缺失）→ 照常 tool-calls', async (t) => {
  const bundle = await loadVendorBundle(t)
  const result = await consume(
    bundle,
    toolCallFrames('mcp_get', '{"toolName":"mcp__weather__forecast"}'),
    { tools: AGENT_TOOLS },
  )
  assert.equal(result.finishKind, 'tool-calls')
  // 合法调用照常下发（缓冲只是延迟到 finish 定性，不发弃）
  assert.deepEqual(result.emittedArguments, ['{"toolName":"mcp__weather__forecast"}'])
})

test('同一 call id 跨多个 wire index 的分片必须合并为一个调用（Qoder invalid_tool_call_id）', async (t) => {
  const bundle = await loadVendorBundle(t)
  // cline reflection 上游实测形态：同一个 id 在 index 0 交付执行后，index 1/2
  // 又带着同一个 id 冒出参数延续分片。按 index 建块会输出多个同 id 调用。
  const frames = [
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-abc', type: 'function', function: { name: 'mcp_get', arguments: '{"toolNa' } }] } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: 'call-abc', function: { arguments: 'me":"mcp__weather' } }] } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 2, id: 'call-abc', function: { arguments: '__forecast"}' } }] } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`,
    'data: [DONE]\n\n',
  ]
  const result = await consume(bundle, frames, { tools: AGENT_TOOLS })
  assert.equal(result.finishKind, 'tool-calls')
  assert.deepEqual(result.emittedArguments, ['{"toolName":"mcp__weather__forecast"}'])
})

test('必填参数工具 + 合法参数 → 照常报 tool-calls', async (t) => {
  const bundle = await loadVendorBundle(t)
  const result = await consume(
    bundle,
    toolCallFrames('mcp_get', '{"toolName":"mcp__weather__forecast"}'),
    { tools: AGENT_TOOLS },
  )
  assert.equal(result.finishKind, 'tool-calls')
})

test('无必填参数的工具（mcp_list）空参数是合法的 → 照常报 tool-calls', async (t) => {
  const bundle = await loadVendorBundle(t)
  const result = await consume(bundle, toolCallFrames('mcp_list', ''), { tools: AGENT_TOOLS })
  assert.equal(result.finishKind, 'tool-calls')
})

test('fail-open：未传工具集合时判据关闭，空参数照常放行', async (t) => {
  const bundle = await loadVendorBundle(t)
  const result = await consume(bundle, toolCallFrames('mcp_get', ''))
  assert.equal(result.finishKind, 'tool-calls')
})

test('残缺参数（无法解析的 JSON）仍走既有 isTruncatedArguments 判据 → max-tokens', async (t) => {
  const bundle = await loadVendorBundle(t)
  const result = await consume(bundle, toolCallFrames('mcp_get', '{"toolName":'), { tools: AGENT_TOOLS })
  assert.equal(result.finishKind, 'max-tokens')
})

test('wire 名经 restoreToolName 还原后比对（opencode 改名表形态）', async (t) => {
  const bundle = await loadVendorBundle(t)
  // wire 侧别名 a1，还原后是必填参数工具 mcp_get
  const result = await consume(bundle, toolCallFrames('a1', ''), {
    tools: AGENT_TOOLS,
    restoreToolName: (name: string) => (name === 'a1' ? 'mcp_get' : name),
  })
  assert.equal(result.finishKind, 'max-tokens')
  assert.equal(result.reason.incompleteDetail, 'mcp_get 缺 toolName',
    '说明里的工具名用调用方名称，与 required 集合同一口径')
})

// ── MiniMax（Anthropic Messages 形状，自走 consumeMinimaxSse 组装） ──

function minimaxToolUseFrames(name: string, argsJson?: string): string[] {
  const frames = [
    `data: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 1 } } })}\n\n`,
    `data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name, input: {} } })}\n\n`,
  ]
  if (argsJson !== undefined) {
    frames.push(`data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: argsJson } })}\n\n`)
  }
  frames.push(
    `data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`,
    `data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 1 } })}\n\n`,
    `data: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
  )
  return frames
}

async function consumeMinimax(
  bundle: VendorBundle,
  frames: string[],
  tools?: readonly ToolDef[],
): Promise<{ finishKind: string; reason: FinishReasonView }> {
  let reason: FinishReasonView = { kind: 'none' }
  for await (const chunk of bundle.consumeMinimaxSse({
    body: sseResponse(frames).body as ReadableStream<Uint8Array>,
    ...bundle.requiredArgsToolsOption(tools),
  })) {
    if (chunk.type === 'finish') reason = (chunk.reason as FinishReasonView)
  }
  return { finishKind: reason.kind, reason }
}

test('minimax：必填参数工具 + 零参数 → finish 由 tool-calls 升级为 max-tokens', async (t) => {
  const bundle = await loadVendorBundle(t)
  const result = await consumeMinimax(bundle, minimaxToolUseFrames('mcp_get'), AGENT_TOOLS)
  assert.equal(result.finishKind, 'max-tokens')
  assert.equal(result.reason.incompleteCause, 'tool-args-empty')
  assert.equal(result.reason.incompleteDetail, 'mcp_get 缺 toolName')
})

test('minimax：无必填参数的工具（mcp_list）空参数照常 tool-calls', async (t) => {
  const bundle = await loadVendorBundle(t)
  const result = await consumeMinimax(bundle, minimaxToolUseFrames('mcp_list'), AGENT_TOOLS)
  assert.equal(result.finishKind, 'tool-calls')
})

test('minimax：必填参数工具 + 部分参数缺必填键 → max-tokens，说明列出缺的键', async (t) => {
  const bundle = await loadVendorBundle(t)
  const result = await consumeMinimax(
    bundle,
    minimaxToolUseFrames('mcp_get', '{"keyword":"weather"}'),
    AGENT_TOOLS,
  )
  assert.equal(result.finishKind, 'max-tokens')
  assert.equal(result.reason.incompleteDetail, 'mcp_get 缺 toolName')
})

test('minimax：fail-open 未传集合时空参数照常放行', async (t) => {
  const bundle = await loadVendorBundle(t)
  const result = await consumeMinimax(bundle, minimaxToolUseFrames('mcp_get'))
  assert.equal(result.finishKind, 'tool-calls')
})

// ── {action, params} 包装层解包（2026-10-31 Qoder 团队任务报障）────────────

test('包装层参数（action=工具名）→ 解包放行，必填键判据看解包后参数', async (t) => {
  const bundle = await loadVendorBundle(t)
  const result = await consume(bundle, toolCallFrames(
    'mcp_get',
    '{"action":"mcp_get","params":{"toolName":"weather"}}',
  ), { tools: AGENT_TOOLS })
  assert.equal(result.finishKind, 'tool-calls')
  assert.deepEqual(result.emittedArguments, ['{"toolName":"weather"}'])
})

test('包装层 action 与工具名不一致 → 不解包，仍按原文判缺必填', async (t) => {
  const bundle = await loadVendorBundle(t)
  const result = await consume(bundle, toolCallFrames(
    'mcp_get',
    '{"action":"other_tool","params":{"toolName":"weather"}}',
  ), { tools: AGENT_TOOLS })
  assert.equal(result.finishKind, 'max-tokens')
})

test('顶层多于两个键 → 疑似真实包装 schema，不解包', async (t) => {
  const bundle = await loadVendorBundle(t)
  const result = await consume(bundle, toolCallFrames(
    'mcp_get',
    '{"action":"mcp_get","params":{"toolName":"weather"},"extra":1}',
  ), { tools: AGENT_TOOLS })
  assert.equal(result.finishKind, 'max-tokens')
})

test('平铺参数原样透传，解包不改一字', async (t) => {
  const bundle = await loadVendorBundle(t)
  const result = await consume(bundle, toolCallFrames('mcp_get', '{"toolName":"weather"}'), { tools: AGENT_TOOLS })
  assert.equal(result.finishKind, 'tool-calls')
  assert.deepEqual(result.emittedArguments, ['{"toolName":"weather"}'])
})
