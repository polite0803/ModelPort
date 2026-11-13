/**
 * 2026-11-13 实测回归：长会话第 32 轮起，Comate execute 稳定回
 * `EXCEPTION` + `exceptionMsg: "NeedCompressionException"`，旧实现把它当普通
 * 400 抛出 → 502，一次请求里两次 attempt 全灭，整条渠道形同不可用。
 *
 * 官方 CLI（`@comate/comatecli` 2.0.0）的 `isCompressionRetry` 只认这一条，处理
 * 方式是**同一轮重发**并在 payload 上加 `needCompression: true`
 * （`buildCompressionParams`），由服务端压缩历史后继续。这里验证该协议通路。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const VENDOR_SRC = join(ROOT, 'vendor', 'channel-pack', 'src')
const COMPAT = join(ROOT, 'src', 'main', 'channelPack', 'compat')

/** 与 `scripts/build-channel-pack.mjs` 同一套别名，测的是生产那份源码。 */
async function loadAdapter(t) {
  const esbuild = await import('esbuild')
  const dir = mkdtempSync(join(tmpdir(), 'comate-adapter-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const outfile = join(dir, 'bundle.mjs')
  await esbuild.build({
    stdin: {
      contents: `export { ComateAdapter } from ${JSON.stringify(join(VENDOR_SRC, 'comate-adapter.ts'))}`,
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
          if (!args.importer.startsWith(VENDOR_SRC + '/')) return undefined
          return { path: join(COMPAT, 'undici.ts') }
        })
        build.onResolve({ filter: /^\.\.\/\.\.\/\.\.\/src\/image-pricing\.js$/ }, args => {
          if (!args.importer.startsWith(VENDOR_SRC + '/')) return undefined
          return { path: join(COMPAT, 'imagePricing.ts') }
        })
      },
    }],
  })
  return await import(pathToFileURL(outfile).href)
}

function sseStream(frames) {
  const bytes = new TextEncoder().encode(frames.join(''))
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

function sseResponse(frames) {
  return new Response(sseStream(frames), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function frame(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`
}

const COMPRESSION_FRAME = frame({
  content: { type: 'EXCEPTION', detail: { exceptionMsg: 'NeedCompressionException' } },
})
const ANSWER_FRAME = frame({
  content: { type: 'ANSWER', detail: { delta: 'pong' }, end: true },
})

/** 记录 execute 的 payload，按队列回 SSE。 */
function makeFetch(executions) {
  const calls = []
  let executionIndex = 0
  let conversationSeq = 0
  const fetchImpl = async (url, init) => {
    const target = String(url)
    if (target.includes('/autowork/v2/conversation')) {
      conversationSeq += 1
      return new Response(JSON.stringify({ code: 200, data: { id: conversationSeq } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (target.includes('/autowork/v2/task')) {
      return new Response(JSON.stringify({ code: 200, data: { taskId: 22 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (target.includes('/autowork/v2/execute')) {
      calls.push(JSON.parse(init.body))
      const next = executions[Math.min(executionIndex, executions.length - 1)]
      executionIndex += 1
      return next()
    }
    throw new Error(`unexpected URL: ${target}`)
  }
  return { fetchImpl, calls }
}

function makeAdapter(ComateAdapter, fetchImpl) {
  return new ComateAdapter({
    fetchImpl,
    credentialRef: 'COMATE_ACCOUNT_TEST',
    resolveCredential: async () => ({ license: 'test-license' }),
    refresh: async () => {},
  })
}

const OPTIONS = {
  model: 'auto-free-individual',
  system: 'you are a test',
  messages: [{ role: 'user', content: 'hello' }],
  tools: [],
  reasoningEffort: 'off',
}

async function collect(adapter) {
  const chunks = []
  for await (const chunk of adapter.stream(OPTIONS)) chunks.push(chunk)
  return chunks
}

test('NeedCompressionException 会重发同一轮并带上 needCompression', async (t) => {
  const { ComateAdapter } = await loadAdapter(t)
  const { fetchImpl, calls } = makeFetch([
    () => sseResponse([COMPRESSION_FRAME]),
    () => sseResponse([ANSWER_FRAME]),
  ])
  const chunks = await collect(makeAdapter(ComateAdapter, fetchImpl))

  assert.equal(calls.length, 2, '首轮 + 压缩重发')
  assert.equal(calls[0].needCompression, undefined, '正常请求不带 needCompression')
  assert.equal(calls[1].needCompression, true, '官方 CLI 的压缩重发必须带 needCompression')
  assert.equal(calls[1].conversationId, calls[0].conversationId, '压缩重发沿用同一会话')
  assert.equal(calls[1].query, calls[0].query, '压缩重发沿用同一轮 query')

  const text = chunks
    .filter(chunk => chunk.type === 'text-delta')
    .map(chunk => chunk.text)
    .join('')
  assert.equal(text, 'pong')
  assert.ok(chunks.some(chunk => chunk.type === 'finish' && chunk.reason.kind === 'stop'))
})

test('压缩重发有上限，耗尽的连同重建一起封顶后给出可操作的错误', async (t) => {
  const { ComateAdapter } = await loadAdapter(t)
  const { fetchImpl, calls } = makeFetch([() => sseResponse([COMPRESSION_FRAME])])
  const adapter = makeAdapter(ComateAdapter, fetchImpl)

  await assert.rejects(collect(adapter), /上下文超过模型上限/)
  // 1 次原始 + 2 次压缩重发 + 2 次裁剪重建
  assert.equal(calls.length, 5, `实际 execute 次数：${calls.length}`)
  assert.equal(calls[1].needCompression, true)
  assert.equal(calls[2].needCompression, true)
  assert.equal(calls[3].needCompression, undefined, '重建会话回到普通请求')
})

test('全部工具无法映射时回失败结果继续同一轮，payload 仍指向当前会话', async (t) => {
  const { ComateAdapter } = await loadAdapter(t)
  const unknownTool = frame({
    content: {
      type: 'FUNCTION_CALL_END',
      detail: { toolUse: [{ id: 'call_1', name: 'totally_unknown_tool', input: {} }] },
    },
  })
  const { fetchImpl, calls } = makeFetch([
    () => sseResponse([unknownTool]),
    () => sseResponse([ANSWER_FRAME]),
  ])
  const chunks = await collect(makeAdapter(ComateAdapter, fetchImpl))

  assert.equal(calls.length, 2, '无法映射的调用不交给客户端，直接回结果继续')
  assert.equal(calls[1].query, '')
  assert.equal(calls[1].conversationId, calls[0].conversationId)
  assert.equal(calls[1].toolUseResults.length, 1, '把不可用原因回给 agent')
  const text = chunks
    .filter(chunk => chunk.type === 'text-delta')
    .map(chunk => chunk.text)
    .join('')
  assert.equal(text, 'pong')
})

test('已经吐出内容后再收到 EXCEPTION 不重发（避免重复输出）', async (t) => {
  const { ComateAdapter } = await loadAdapter(t)
  const partial = frame({ content: { type: 'ANSWER', detail: { delta: 'half' } } })
  const { fetchImpl, calls } = makeFetch([() => sseResponse([partial, COMPRESSION_FRAME])])
  const adapter = makeAdapter(ComateAdapter, fetchImpl)

  await assert.rejects(collect(adapter), /上下文超过模型上限/)
  assert.equal(calls.length, 1, '内容已下发，不能原样重来')
})