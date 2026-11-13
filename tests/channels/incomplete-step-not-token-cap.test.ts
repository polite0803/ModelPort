/**
 * 「本步不完整」不是「输出 token 上限」（用户报障 2026-11-13：codex-deepseek 路由
 * 总是触发客户端 `Incomplete response returned, reason: max_output_tokens`）。
 *
 * 缺陷链：渠道包把七种与输出上限无关的条件（工具参数残缺、必填参数空、无名调用
 * 被丢、连接被掐断、正文被停止串掐断、思考循环…）一律折成 DSH `max-tokens`；
 * 投影层把它写成 `finish_reason:'length'`；Responses 侧翻成
 * `incomplete/max_output_tokens`；Codex 就地结束回合，报一句与事实无关的上限。
 * 折叠在 DSH 里成立（harness 会重跑该步），但 ModelPort 没有 harness。
 *
 * 本测试钉住修复后的契约，两侧都用生产源码：
 * - 适配器侧：合成 incomplete 必须带成因标签，真实上限**不带**；
 * - 投影侧：带标签 → 错误帧（code=incomplete_step），不带 → 仍是 length；
 * - 错误帧路径仍然只有一个 [DONE]，且绝不写成 assistant 正文。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { INCOMPLETE_STEP_CODE } from '../../src/main/proxy/streamOutcomePolicy.ts'

const ROOT = process.cwd()
const VENDOR_SRC = join(ROOT, 'vendor', 'channel-pack', 'src')
const COMPAT_LLM = join(ROOT, 'src', 'main', 'channelPack', 'compat', 'dshLlm.ts')

/** 与 openai-compat-empty-required-args.test.ts 同一套 esbuild 基建。 */
async function loadVendorBundle(t: { after: (fn: () => void) => void }) {
  const esbuild = await import('esbuild')
  const dir = mkdtempSync(join(tmpdir(), 'channel-pack-vendor-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const outfile = join(dir, 'bundle.mjs')
  await esbuild.build({
    stdin: {
      contents: [
        `export { consumeOpenAiSse, requiredArgsToolsOption } from ${JSON.stringify(join(VENDOR_SRC, 'openai-compat.ts'))}`,
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

const frame = (value: unknown): string => `data: ${JSON.stringify(value)}\n\n`
const delta = (payload: Record<string, unknown>, finish: string | null = null): string =>
  frame({ choices: [{ index: 0, delta: payload, finish_reason: finish }] })

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder()
  let cursor = 0
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (cursor < frames.length) controller.enqueue(encoder.encode(frames[cursor++]))
      else controller.close()
    },
  }))
}

const TOOLS_REQUIRING_ARGS = {
  toolsRequiringArgs: new Map([['exec_command', ['cmd']]]),
}

/** 跑一遍真实适配器，取 finish chunk 的 reason（含成因标签）。 */
async function consumeFinish(
  bundle: any,
  frames: string[],
  config: Record<string, unknown> = {},
): Promise<{ kind: string; incompleteCause?: string; incompleteDetail?: string }> {
  let reason: { kind: string; incompleteCause?: string; incompleteDetail?: string } = { kind: 'none' }
  for await (const chunk of bundle.consumeOpenAiSse(sseResponse(frames), {}, {
    label: 'test',
    firstTokenTimeoutMs: 5000,
    chunkTimeoutMs: 5000,
    ...config,
  })) {
    if ((chunk as any).type === 'finish') reason = (chunk as any).reason
  }
  return reason
}

/** 把 DSH chunk 序列投影成 wire 帧（生产用的那份 toOpenAiSse）。 */
async function project(bundle: any, chunks: unknown[]): Promise<{ text: string; frames: any[] }> {
  const parts: string[] = []
  for await (const part of bundle.toOpenAiSse(
    (async function* () { yield* chunks })(),
    'chatcmpl-test',
    'loomy/mimo-v2.5',
  )) {
    parts.push(part)
  }
  const text = parts.join('')
  const frames = text.split('\n\n')
    .map(f => f.trim())
    .filter(f => f.startsWith('data: '))
    .map(f => f.slice(6))
    .filter(p => p !== '[DONE]')
    .map(p => JSON.parse(p))
  return { text, frames }
}

const toolCallDelta = (name: string | undefined, args: string): string =>
  delta({
    tool_calls: [{
      index: 0,
      id: 'call_1',
      type: 'function',
      function: { ...(name === undefined ? {} : { name }), arguments: args },
    }],
  })

test('上游真报 length：不带成因标签，投影仍是 finish_reason=length', async (t) => {
  const bundle = await loadVendorBundle(t)
  const reason = await consumeFinish(bundle, [
    delta({ content: '半句话' }),
    delta({}, 'length'),
    'data: [DONE]\n\n',
  ])
  assert.equal(reason.kind, 'max-tokens')
  assert.equal(reason.incompleteCause, undefined, '真实上限不是合成 incomplete，不得带标签')

  const { frames } = await project(bundle, [
    { type: 'text-delta', index: 0, text: '半句话' },
    { type: 'finish', reason },
  ])
  assert.equal(frames.at(-1)?.choices?.[0]?.finish_reason, 'length')
  assert.equal(frames.some(f => f.error !== undefined), false, '真实上限绝不改成错误帧')
})

test('工具参数 JSON 残缺：成因 tool-args-truncated，投影成 incomplete_step 错误帧', async (t) => {
  const bundle = await loadVendorBundle(t)
  const reason = await consumeFinish(bundle, [
    toolCallDelta('exec_command', '{"cmd":"ls -'),
    delta({}, 'tool_calls'),
    'data: [DONE]\n\n',
  ])
  assert.equal(reason.kind, 'max-tokens')
  assert.equal(reason.incompleteCause, 'tool-args-truncated')

  const { text, frames } = await project(bundle, [
    { type: 'text-delta', index: 0, text: '我来看一下目录。' },
    { type: 'finish', reason },
  ])
  const error = frames.find(f => f.error !== undefined)
  assert.ok(error, '合成 incomplete 必须以错误帧浮现，而不是 finish_reason=length')
  // 码必须与网关判据同源：两侧各写一份字面量就是静默漂移的开始。
  assert.equal(error.error.code, INCOMPLETE_STEP_CODE)
  assert.match(error.error.message, /参数 JSON 残缺/)
  assert.equal(frames.some(f => f.choices?.[0]?.finish_reason === 'length'), false)
  assert.equal(text.split('data: [DONE]').length - 1, 1, '错误帧路径仍然只有一个 [DONE]')
  assert.equal(error.choices.length, 0, '失败不是正文：choices 必须为空')
})

test('必填参数工具收到空参数：成因 tool-args-empty，文案点名工具与缺键', async (t) => {
  const bundle = await loadVendorBundle(t)
  const reason = await consumeFinish(bundle, [
    toolCallDelta('exec_command', '{}'),
    delta({}, 'tool_calls'),
    'data: [DONE]\n\n',
  ], TOOLS_REQUIRING_ARGS)
  assert.equal(reason.kind, 'max-tokens')
  assert.equal(reason.incompleteCause, 'tool-args-empty')
  assert.equal(reason.incompleteDetail, 'exec_command 缺 cmd',
    '补充说明要指出是哪个工具、缺哪个键 —— 只有成因时既认不出工具也认不出形态')

  // 投影层：文案必须与判据同源。这条判据同时覆盖「空参数」与「缺任一必填键」，
  // 只说「收到空参数」会把部分缺键误述成空（2026-11-13 Codex 报障原文）。
  const { frames } = await project(bundle, [{ type: 'finish', reason }])
  const error = frames.find(f => f.error !== undefined)
  assert.equal(error?.error?.code, INCOMPLETE_STEP_CODE)
  assert.match(error.error.message, /缺必填字段/)
  assert.match(error.error.message, /exec_command 缺 cmd/)
})

test('部分参数缺必填键：同一成因，补充说明列出真实缺的键', async (t) => {
  const bundle = await loadVendorBundle(t)
  const reason = await consumeFinish(bundle, [
    toolCallDelta('exec_command', '{"workdir":"/tmp"}'),
    delta({}, 'tool_calls'),
    'data: [DONE]\n\n',
  ], TOOLS_REQUIRING_ARGS)
  assert.equal(reason.incompleteCause, 'tool-args-empty')
  assert.equal(reason.incompleteDetail, 'exec_command 缺 cmd')
})

test('连接被掐断（无 finish_reason 也无 [DONE]）：成因 stream-cut', async (t) => {
  const bundle = await loadVendorBundle(t)
  const reason = await consumeFinish(bundle, [
    delta({ content: '先确认当前 shell 位置' }),
  ])
  assert.equal(reason.kind, 'max-tokens')
  assert.equal(reason.incompleteCause, 'stream-cut')

  const { frames } = await project(bundle, [{ type: 'finish', reason }])
  assert.equal(frames.find(f => f.error !== undefined)?.error?.code, INCOMPLETE_STEP_CODE)
})

test('有工具分片但上游没宣告结束：成因 incomplete-tools', async (t) => {
  const bundle = await loadVendorBundle(t)
  const reason = await consumeFinish(bundle, [
    toolCallDelta('exec_command', '{"cmd":"ls"}'),
    'data: [DONE]\n\n',
  ])
  assert.equal(reason.kind, 'max-tokens')
  assert.equal(reason.incompleteCause, 'incomplete-tools')
})

test('无名调用被丢且无可用调用留下：成因 tool-call-unnamed', async (t) => {
  const bundle = await loadVendorBundle(t)
  const reason = await consumeFinish(bundle, [
    toolCallDelta(undefined, '{"cmd":"ls"}'),
    delta({}, 'stop'),
    'data: [DONE]\n\n',
  ])
  assert.equal(reason.kind, 'max-tokens')
  assert.equal(reason.incompleteCause, 'tool-call-unnamed')
})

test('正常收尾不受影响：stop / tool-calls 原样投影，无错误帧', async (t) => {
  const bundle = await loadVendorBundle(t)
  const stop = await consumeFinish(bundle, [
    delta({ content: '做完了。' }),
    delta({}, 'stop'),
    'data: [DONE]\n\n',
  ])
  assert.equal(stop.kind, 'stop')
  assert.equal(stop.incompleteCause, undefined)

  const { frames } = await project(bundle, [
    { type: 'text-delta', index: 0, text: '做完了。' },
    { type: 'finish', reason: stop },
  ])
  assert.equal(frames.at(-1)?.choices?.[0]?.finish_reason, 'stop')
  assert.equal(frames.some(f => f.error !== undefined), false)
})