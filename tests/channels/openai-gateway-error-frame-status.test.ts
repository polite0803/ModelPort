/**
 * 渠道包在建流阶段（首块之前）失败时，SSE 错误帧必须带上游**真实状态码**。
 *
 * ## 被证明的缺陷（真实流量，2026-11-12 用户报障「Codex 接 codex 路由 503」）
 *
 * cline 的 `:batch` 变体在 chat 端点上逐发 404 `model not supported`。适配器把
 * `{ status: 404 }` 交给 `LlmError`，`failureToOpenAiError()` 也算出了 404，但
 * 非流式出口（`collectOpenAiCompletion`）与流式出口（`toOpenAiSse`）只有一侧把
 * 这个数写进错误对象：流式那侧漏写，宿主只能按文案判成 502 账号故障。
 * 于是 `maxAttempts: 3` 的路由被三条 `:batch` 候选吃满，链在第 7 家收手，
 * 后面 1145 个候选一个没试到，客户端拿到 `503 no_available_model`。
 *
 * 同文件里流**已发出**之后的错误帧本来就带 `status`（见 stream.ts 的注释），
 * 本测试钉的是同一口径必须覆盖建流阶段那一发。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const VENDOR_SRC = join(ROOT, 'vendor', 'channel-pack', 'src')
const COMPAT_LLM = join(ROOT, 'src', 'main', 'channelPack', 'compat', 'dshLlm.ts')

/** 与 openai-gateway-first-fragment.test.ts 同一套基建：驱动生产用的那份 vendor 源码。 */
async function loadVendorBundle(t: { after: (fn: () => unknown) => void }): Promise<{
  toOpenAiSse: (chunks: AsyncIterable<unknown>, requestId: string, model: string) => AsyncIterable<string>
}> {
  const esbuild = await import('esbuild')
  const dir = mkdtempSync(join(tmpdir(), 'channel-pack-error-frame-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const outfile = join(dir, 'bundle.mjs')
  await esbuild.build({
    stdin: {
      contents: `export { toOpenAiSse } from ${JSON.stringify(join(VENDOR_SRC, 'openai-gateway', 'stream.ts'))}`,
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

function errorFrameOf(frames: string[]): Record<string, any> {
  const payload = frames
    .join('')
    .split('\n\n')
    .map(frame => frame.trim())
    .find(frame => frame.startsWith('data: ') && frame.includes('"error"'))
  assert.ok(payload, '错误必须以一帧 data 载荷浮现')
  return JSON.parse(payload.slice('data: '.length)) as Record<string, any>
}

async function projectFailure(
  t: { after: (fn: () => unknown) => void },
  error: Error,
): Promise<{ frames: string[]; frame: Record<string, any> }> {
  const { toOpenAiSse } = await loadVendorBundle(t)
  const frames: string[] = []
  for await (const frame of toOpenAiSse(
    (async function* (): AsyncGenerator<unknown> { throw error })(),
    'chatcmpl-test',
    'cline/anthropic/claude-opus-5:batch',
  )) {
    frames.push(frame)
  }
  return { frames, frame: errorFrameOf(frames) }
}

test('建流阶段的 404 进错误帧：status 是上游那个 404，不是宿主兜底的 502', async (t) => {
  const upstream404 = Object.assign(new Error('cline: model not supported'), {
    code: 'HTTP_404',
    status: 404,
  })
  const { frames, frame } = await projectFailure(t, upstream404)

  assert.equal(frame.error.message, 'cline: model not supported')
  assert.equal(frame.error.code, 'HTTP_404')
  assert.equal(frame.error.status, 404, '换家循环读的就是这个数')
  assert.equal(frames.join('').split('[DONE]').length - 1, 1, '一条流只有一个 [DONE]')
})

test('只有 failure.status（顶层没有 status）也取到状态码 —— 与真包 LlmFailure 同形', async (t) => {
  const nestedOnly = Object.assign(new Error('cline: model not supported'), {
    code: 'HTTP_404',
    failure: { status: 404 },
  })
  const { frame } = await projectFailure(t, nestedOnly)
  assert.equal(frame.error.status, 404)
})

test('读不到状态码的失败仍按 502 兜底，不发明一个数', async (t) => {
  const { frame } = await projectFailure(t, Object.assign(new Error('cline: boom'), { code: 'SERVER' }))
  assert.equal(frame.error.status, 502)
})
