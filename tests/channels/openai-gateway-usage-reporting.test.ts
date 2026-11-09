/**
 * 缓存明细必须区分「没报」与「报了 0」（用户报障 2026-11-09：TRAE 命中率恒为 0%）。
 *
 * 缺陷链：适配器读不到缓存字段时缺省 `cacheReadTokens` → `toOpenAiUsage` 的
 * `count()` 把缺省折成 0 → 两个出口无条件发 `{cached_tokens: 0}` → 宿主
 * `readUsageFromBody` 把显式 0 读成「报了且零命中」→ 账本把 TRAE 全部请求
 * 计成 0% 命中。而 TRAE 到底有没有缓存，我们从来没有测量过。
 *
 * 本测试钉住修复后的契约：
 * - 上游没报 → 两个出口都**不发** details 对象 → 宿主 `cacheReadReported` 缺省；
 * - 上游显式报 0 → 发 `{cached_tokens: 0}` → 宿主读成「报了且零命中」；
 * - 上游报了正数 → 发真值，且加回口径（inputTokens 含缓存）不回退。
 *
 * 单元层直接 import `usage.ts`（它只有 type-only 依赖，node 原生剥 TS 即可）；
 * 线路层与 openai-gateway-first-fragment.test.ts 同一套 esbuild 基建，
 * 驱动的就是生产用的那份源码；最后把发出的 wire JSON 喂给宿主的
 * `readUsageFromBody`，证明仪表盘那一端读到的正是「未上报」而不是 0。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { toOpenAiUsage } from '../../vendor/channel-pack/src/openai-gateway/usage.ts'
import { readCachedInput, uncachedInput } from '../../vendor/channel-pack/src/usage-cache.ts'
import { readUsageFromBody } from '../../src/main/proxy/quota/usage.ts'

const ROOT = process.cwd()
const VENDOR_SRC = join(ROOT, 'vendor', 'channel-pack', 'src')
const COMPAT_LLM = join(ROOT, 'src', 'main', 'channelPack', 'compat', 'dshLlm.ts')

test('toOpenAiUsage：缺省 cacheReadTokens 时 cacheReported 为 false，绝不折成已上报', () => {
  const normalized = toOpenAiUsage({ inputTokens: 1000, outputTokens: 20 })
  assert.equal(normalized.cacheReported, false)
  assert.equal(normalized.cachedTokens, 0)
  assert.equal(normalized.inputTokens, 1000, '没报缓存时总输入不加回任何东西')
  assert.equal(normalized.totalTokens, 1020)
})

test('toOpenAiUsage：显式 0 也算已上报（0 是断言，缺省才是事实）', () => {
  const normalized = toOpenAiUsage({ inputTokens: 1000, outputTokens: 20, cacheReadTokens: 0 })
  assert.equal(normalized.cacheReported, true)
  assert.equal(normalized.cachedTokens, 0)
  assert.equal(normalized.inputTokens, 1000)
})

test('toOpenAiUsage：正数命中保持加回口径（2026-10-04 Codex 少算缺陷不回退）', () => {
  const normalized = toOpenAiUsage({ inputTokens: 200, outputTokens: 20, cacheReadTokens: 800, cacheWriteTokens: 10 })
  assert.equal(normalized.cacheReported, true)
  assert.equal(normalized.cachedTokens, 800)
  assert.equal(normalized.inputTokens, 1010, '未命中 200 + 命中 800 + 写入 10')
  assert.equal(normalized.totalTokens, 1030)
})

test('TRAE 路径端到端：SOLO 显式报 0 → 宿主读成「已上报、零命中」', () => {
  // 原始帧取自 2026-11-09 取证（PLAN §9.10）：`cache_read_input_tokens: 0` 每轮都在。
  const raw = { prompt_tokens: 1000, completion_tokens: 20, cache_read_input_tokens: 0, cluster: 'normal_context' }
  const reading = readCachedInput(raw)
  assert.equal(reading.cachedReported, true, '字段出现且为 0 是上游的断言，不是缺省')
  // 与 trae-adapter.ts 的 token_usage 分支同形。
  const normalized = toOpenAiUsage({
    inputTokens: uncachedInput(raw.prompt_tokens, reading),
    outputTokens: raw.completion_tokens,
    ...reading.cachedTokens !== undefined ? { cacheReadTokens: reading.cachedTokens } : {},
  })
  assert.equal(normalized.cacheReported, true, '显式 0 必须带着「已上报」走完整条链')
  assert.equal(normalized.cachedTokens, 0)
  assert.equal(normalized.inputTokens, 1000)
  const host = readUsageFromBody({
    usage: {
      prompt_tokens: normalized.inputTokens,
      completion_tokens: normalized.outputTokens,
      prompt_tokens_details: { cached_tokens: normalized.cachedTokens },
    },
  })
  assert.ok(host)
  assert.equal(host.cacheReadReported, true)
  assert.equal(host.cacheReadTokens, undefined, '0 命中不落数值，只落 reported 标志')
  assert.equal(host.promptTokens, 1000)
})

test('TRAE 路径端到端：Anthropic 并列口径只减不减（无缓存时不双扣）', () => {
  const raw = { input_tokens: 400, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 }
  const reading = readCachedInput(raw)
  const normalized = toOpenAiUsage({
    inputTokens: uncachedInput(400, reading),
    outputTokens: 20,
    cacheReadTokens: reading.cachedTokens,
  })
  assert.equal(normalized.cachedTokens, 900)
  assert.equal(normalized.inputTokens, 1300, '并列口径：未命中 400 + 命中 900')
  assert.equal(normalized.cacheReported, true)
})

/** 与 first-fragment 同一套基建：esbuild 按生产别名打包 vendor 源码再 import。 */
async function loadVendorBundle(t) {
  const esbuild = await import('esbuild')
  const dir = mkdtempSync(join(tmpdir(), 'channel-pack-usage-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const outfile = join(dir, 'bundle.mjs')
  await esbuild.build({
    stdin: {
      contents: [
        `export { toOpenAiSse, collectOpenAiCompletion } from ${JSON.stringify(join(VENDOR_SRC, 'openai-gateway', 'stream.ts'))}`,
        `export { collectResponsesResult, toResponsesSse } from ${JSON.stringify(join(VENDOR_SRC, 'openai-gateway', 'responses.ts'))}`,
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

function chunksWithUsage(usage) {
  return (async function* () {
    yield { type: 'text-delta', index: 0, text: '你好' }
    yield { type: 'usage', usage }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })()
}

function parseSseFrames(text) {
  return text
    .split('\n\n')
    .map(frame => frame.trim())
    .filter(frame => frame.startsWith('data: '))
    .map(frame => frame.slice('data: '.length))
    .filter(payload => payload !== '[DONE]')
    .map(payload => JSON.parse(payload))
}

/** Responses 的帧带 `event: <type>` 前缀行，data 行在帧内部。 */
function parseResponsesEvents(text) {
  return text
    .split('\n\n')
    .map(frame => frame.split('\n').find(line => line.startsWith('data: ')))
    .filter(payload => payload !== undefined)
    .map(payload => JSON.parse(payload.slice('data: '.length)))
}

/**
 * 三种上游形状 × 四个出口 × 宿主读取，全排列钉死。
 * `reported` 是宿主侧期望的 `cacheReadReported`：缺省 = 没报，0 与正数 = 报了。
 */
const CASES = [
  { name: '上游没报（TRAE 形状）', usage: { inputTokens: 1000, outputTokens: 20 }, details: undefined, cached: undefined, reported: undefined },
  { name: '上游显式报 0', usage: { inputTokens: 1000, outputTokens: 20, cacheReadTokens: 0 }, details: 0, cached: undefined, reported: true },
  { name: '上游报了命中', usage: { inputTokens: 200, outputTokens: 20, cacheReadTokens: 800 }, details: 800, cached: 800, reported: true },
]

for (const c of CASES) {
  test(`四个出口同一判据：${c.name}`, async (t) => {
    const { toOpenAiSse, collectOpenAiCompletion, collectResponsesResult, toResponsesSse } = await loadVendorBundle(t)

    // Chat 流式：usage 帧（choices: []）。
    const sseFrames = []
    for await (const frame of toOpenAiSse(chunksWithUsage(c.usage), 'chatcmpl-usage-test', 'trae/test-model')) {
      sseFrames.push(frame)
    }
    const chatUsage = parseSseFrames(sseFrames.join('')).find(frame => frame.usage !== undefined)?.usage
    assert.ok(chatUsage, '流末必须带 usage 帧')
    assert.equal(chatUsage.prompt_tokens, 1000)
    if (c.details === undefined) {
      assert.equal('prompt_tokens_details' in chatUsage, false, '没报就不发 details，发 0 会被宿主读成「报了且零命中」')
      assert.equal('prompt_cache_hit_tokens' in chatUsage, false)
    } else {
      assert.equal(chatUsage.prompt_tokens_details.cached_tokens, c.details)
    }

    // Chat 非流式。
    const completion = await collectOpenAiCompletion(chunksWithUsage(c.usage), 'chatcmpl-usage-test', 'trae/test-model')
    const completionUsage = completion.usage
    assert.equal(completionUsage.prompt_tokens, 1000)
    assert.equal('prompt_tokens_details' in completionUsage, c.details !== undefined)
    if (c.details !== undefined) assert.equal(completionUsage.prompt_tokens_details.cached_tokens, c.details)

    // Responses 非流式。
    const response = await collectResponsesResult(chunksWithUsage(c.usage), 'resp-usage-test', 'trae/test-model', { model: 'trae/test-model' })
    const responseUsage = response.usage
    assert.equal(responseUsage.input_tokens, 1000)
    assert.equal('input_tokens_details' in responseUsage, c.details !== undefined)
    if (c.details !== undefined) assert.equal(responseUsage.input_tokens_details.cached_tokens, c.details)

    // Responses 流式：response.completed 事件里的 usage。
    const responseFrames = []
    for await (const frame of toResponsesSse(chunksWithUsage(c.usage), 'resp-usage-test', 'trae/test-model', { model: 'trae/test-model' })) {
      responseFrames.push(frame)
    }
    const completed = parseResponsesEvents(responseFrames.join('')).find(event => event.type === 'response.completed')
    assert.ok(completed, '流必须以 response.completed 收尾')
    const completedUsage = completed.response.usage
    assert.equal('input_tokens_details' in completedUsage, c.details !== undefined)
    if (c.details !== undefined) assert.equal(completedUsage.input_tokens_details.cached_tokens, c.details)

    // 宿主消费端：把发出的 wire JSON 原样喂给账本读取函数。
    for (const wire of [chatUsage, completionUsage]) {
      const reading = readUsageFromBody({ usage: wire })
      assert.ok(reading)
      assert.equal(reading.cacheReadReported, c.reported, `Chat wire → cacheReadReported 应为 ${String(c.reported)}`)
      assert.equal(reading.cacheReadTokens, c.cached)
      assert.equal(reading.promptTokens, 1000)
    }
  })
}