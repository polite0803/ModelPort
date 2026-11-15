/**
 * buddy 适配器两条修复的行为证明（2026-11-15 报障：buddy/hy4free 缓存命中率低）。
 *
 * 用 esbuild 按生产别名打包真实 `buddy-adapter.ts`，以 fake fetch 驱动 `stream()`：
 * - **方向 1**：捕获出站请求体，断言 `prompt_cache_key` 按会话隔离、跨轮稳定，
 *   显式 `sessionId` 仍可覆盖；
 * - **方向 2**：收集产出的 usage chunk，断言显式 0 命中发 `cacheReadTokens:0`、
 *   没报缓存时缺省（不伪造 0）、正数命中按子集减；并把 buddy 的实际产出喂给
 *   网关序列化 + 宿主读取，证明零命中请求最终计入命中率分母。
 *
 * 不注入 fetchRemoteModels / accountPool：ensureRemoteModels 直接返回、账号匹配
 * 跳过，stream() 走最小 happy path（200 → consumeSse）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { toOpenAiUsage } from '../../vendor/channel-pack/src/openai-gateway/usage.ts'
import { readUsageFromBody } from '../../src/main/proxy/quota/usage.ts'

const ROOT = process.cwd()
const VENDOR = join(ROOT, 'vendor', 'channel-pack')
const VENDOR_SRC = join(VENDOR, 'src')
const COMPAT = join(ROOT, 'src', 'main', 'channelPack', 'compat')

// 与 scripts/build-channel-pack.mjs 同一套 alias/桩：buddy-adapter 传递依赖
// account-pool / channel-pack-store / llm-register-compat，它们 import 的
// `@deepseek-ai/*` 契约包与越界的 image-pricing 都要解析到 compat 替身。
async function loadAdapter(t) {
  const esbuild = await import('esbuild')
  const dir = mkdtempSync(join(tmpdir(), 'buddy-cache-key-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const outfile = join(dir, 'bundle.mjs')
  await esbuild.build({
    stdin: {
      contents: `export { BuddyAdapter } from ${JSON.stringify(join(VENDOR_SRC, 'buddy-adapter.ts'))}`,
      resolveDir: ROOT,
      loader: 'ts',
    },
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node20'],
    logLevel: 'warning',
    alias: {
      '@deepseek-ai/dsh-llm': join(COMPAT, 'dshLlm.ts'),
      '@deepseek-ai/dsh-credentials': join(COMPAT, 'dshCredentials.ts'),
      '@deepseek-ai/cordis': join(COMPAT, 'cordis.ts'),
      '@deepseek-ai/schemastery': join(COMPAT, 'schemastery.ts'),
      '@deepseek-ai/dsh-agent': join(COMPAT, 'dshAgent.ts'),
    },
    plugins: [{
      name: 'channel-pack-compat',
      setup(build) {
        build.onResolve({ filter: /^undici$/ }, args => {
          if (!args.importer.startsWith(VENDOR + '/')) return undefined
          return { path: join(COMPAT, 'undici.ts') }
        })
        build.onResolve({ filter: /^\.\.\/\.\.\/\.\.\/src\/image-pricing\.js$/ }, args => {
          if (!args.importer.startsWith(VENDOR + '/')) return undefined
          return { path: join(COMPAT, 'imagePricing.ts') }
        })
      },
    }],
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
  })
  return (await import(pathToFileURL(outfile).href)).BuddyAdapter
}

function textMessage(role, text) {
  return { role, content: [{ type: 'text', text }] }
}

function sseResponse(usage) {
  const frames = [
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], ...(usage === undefined ? {} : { usage }) })}\n\n`,
    'data: [DONE]\n\n',
  ]
  return new Response(frames.join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function makeAdapter(BuddyAdapter, { usage, sessionId, capture }) {
  const fetchImpl = async (_url, init) => {
    capture.push(JSON.parse(init.body))
    return sseResponse(usage)
  }
  return new BuddyAdapter({
    credentialRef: 'BUDDY_ACCESS_TOKEN',
    ...(sessionId === undefined ? {} : { sessionId }),
    resolveCredential: async () => ({ access_token: 'test-token', expires_at: String(Date.now() + 3_600_000) }),
    refresh: async () => {},
    fetchImpl,
  })
}

async function run(adapter, messages) {
  const chunks = []
  for await (const chunk of adapter.stream({ model: 'hy4free', messages })) chunks.push(chunk)
  return chunks
}

const NO_CACHE_USAGE = { prompt_tokens: 1000, completion_tokens: 20 }

test('方向1：prompt_cache_key 按会话隔离、跨轮稳定', async (t) => {
  const BuddyAdapter = await loadAdapter(t)
  const capture = []
  const adapter = makeAdapter(BuddyAdapter, { usage: NO_CACHE_USAGE, capture })
  const sys = textMessage('system', 'SYS')
  await run(adapter, [sys, textMessage('user', 'TASK_A')])
  // 同一会话追加历史（首条 user 不变）→ key 必须不变。
  await run(adapter, [sys, textMessage('user', 'TASK_A'), textMessage('user', 'follow-up')])
  // 另一段会话（首条 user 不同）→ key 必须不同。
  await run(adapter, [sys, textMessage('user', 'TASK_B')])
  const [a1, a2, b1] = capture.map(body => body.prompt_cache_key)
  assert.match(a1, /^[0-9a-f]{32}$/, 'key 形状与旧实现一致（32 位十六进制）')
  assert.equal(a1, a2, '同一会话跨轮复用同一 key，缓存前缀才能累积')
  assert.notEqual(a1, b1, '两条并发会话必须落到不同命名空间，否则互相驱逐')
})

test('方向1：显式 sessionId 覆盖派生值', async (t) => {
  const BuddyAdapter = await loadAdapter(t)
  const capture = []
  const adapter = makeAdapter(BuddyAdapter, { usage: NO_CACHE_USAGE, sessionId: 'pinned-key', capture })
  await run(adapter, [textMessage('user', 'TASK_A')])
  assert.equal(capture[0].prompt_cache_key, 'pinned-key')
})

test('方向2：显式 0 命中 → 发 cacheReadTokens:0（不折成缺省）', async (t) => {
  const BuddyAdapter = await loadAdapter(t)
  const capture = []
  const adapter = makeAdapter(BuddyAdapter, {
    usage: { prompt_tokens: 1000, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } },
    capture,
  })
  const chunks = await run(adapter, [textMessage('user', 'TASK_A')])
  const usage = chunks.find(chunk => chunk.type === 'usage')?.usage
  assert.ok(usage, '流末必须产出 usage chunk')
  assert.equal(usage.cacheReadTokens, 0, '显式 0 是上游断言，必须原样发出')
  assert.equal(usage.inputTokens, 1000)
  assert.equal(usage.outputTokens, 20)
})

test('方向2：没报缓存 → cacheReadTokens 缺省（不伪造 0）', async (t) => {
  const BuddyAdapter = await loadAdapter(t)
  const capture = []
  const adapter = makeAdapter(BuddyAdapter, { usage: NO_CACHE_USAGE, capture })
  const chunks = await run(adapter, [textMessage('user', 'TASK_A')])
  const usage = chunks.find(chunk => chunk.type === 'usage')?.usage
  assert.ok(usage)
  assert.equal('cacheReadTokens' in usage, false, '上游没报就缺省，绝不能补 0')
  assert.equal(usage.inputTokens, 1000)
})

test('方向2：正数命中 → inputTokens 减命中、cacheReadTokens 单列', async (t) => {
  const BuddyAdapter = await loadAdapter(t)
  const capture = []
  const adapter = makeAdapter(BuddyAdapter, {
    usage: { prompt_tokens: 1000, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 800 } },
    capture,
  })
  const chunks = await run(adapter, [textMessage('user', 'TASK_A')])
  const usage = chunks.find(chunk => chunk.type === 'usage')?.usage
  assert.ok(usage)
  assert.equal(usage.cacheReadTokens, 800)
  assert.equal(usage.inputTokens, 200, '子集口径：未命中 1000 - 命中 800')
})

test('方向2 端到端：buddy 显式 0 → 宿主 cacheReadReported=true（计入分母）', async (t) => {
  const BuddyAdapter = await loadAdapter(t)
  const capture = []
  const adapter = makeAdapter(BuddyAdapter, {
    usage: { prompt_tokens: 1000, completion_tokens: 20, prompt_cache_hit_tokens: 0 },
    capture,
  })
  const chunks = await run(adapter, [textMessage('user', 'TASK_A')])
  const usage = chunks.find(chunk => chunk.type === 'usage')?.usage
  assert.ok(usage)
  // buddy 产出 → 网关 OpenAI 口径 → 宿主账本读取，与生产链路同形。
  const normalized = toOpenAiUsage(usage)
  assert.equal(normalized.cacheReported, true)
  const host = readUsageFromBody({
    usage: {
      prompt_tokens: normalized.inputTokens,
      completion_tokens: normalized.outputTokens,
      prompt_tokens_details: { cached_tokens: normalized.cachedTokens },
    },
  })
  assert.ok(host)
  assert.equal(host.cacheReadReported, true, '零命中请求必须进命中率分母，而不是被当成「没报」排除')
  assert.equal(host.cacheReadTokens, undefined, '0 命中不落数值，只落 reported 标志')
})