/**
 * CodeArts（华为云）benefit 通路失败的判据回归测试。
 *
 * 背景（2026-11-11 现网）：同一个账号上 `openpangu-2.0-flash`（不带
 * `maas_type: benefit`）正常出流，而两个 benefit-only 模型 `glm-5.3-flash` /
 * `deepseek-v4.1-flash` 都以 **HTTP 200 + SSE 内嵌错误**失败：
 * `The API does not exist or has not been published in the environment`。
 * 原实现只在 `InferHub.4004.200` 这一个码上去头重试，这句话走的是「直接抛出」
 * 分支 —— 于是既没有去头重试，又把确定性失败报成 502 `api_error`，网关按
 * 「可切换故障」把同账号同模型再投一次（现网 attempts 两条完全相同）。
 *
 * 契约：
 * 1. 带 benefit 头时的流内错误 → 去掉该头重试一次（第二次必须真的不带）；
 * 2. 抛出的文本必须带上游 `error_code`（否则 APIG 层与 InferHub 层在日志里无法区分）；
 * 3. 不带该头时的同一错误 = 该账号供不上这个模型 → 404 终态，且不再重投；
 * 4. 额度耗尽分支优先于 benefit 判据，不能被它抢走（见 llm-adapter.ts 的顺序注释）。
 *
 * ⚠️ vendor 源码不能直接 import（虚拟模块 + `.js`→`.ts` 解析），这里按
 * `scripts/build-channel-pack.mjs` 的同一套别名打成临时 bundle 再加载 ——
 * 测试驱动的是生产用的那份源码。
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

/** 现网实测的失败帧（HTTP 200 + SSE 内嵌 error_code/error_msg）。 */
const BENEFIT_ROUTE_FRAME = 'data: {"text":"[DONE]","error_code":"APIG.0604",'
  + '"error_msg":"The API does not exist or has not been published in the environment"}\n\n'

/** 额度耗尽帧：必须走 4291 分支，不得被 benefit 判据接走。 */
const QUOTA_FRAME = 'data: {"text":"[DONE]","error_code":"InferHub.4291.200",'
  + '"error_msg":"insufficient quota"}\n\n'

async function loadAdapter(t) {
  const esbuild = await import('esbuild')
  const dir = mkdtempSync(join(tmpdir(), 'codearts-benefit-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const outfile = join(dir, 'bundle.mjs')
  await esbuild.build({
    stdin: {
      contents: `export { CodeArtsAdapter } from ${JSON.stringify(join(VENDOR_SRC, 'llm-adapter.ts'))}`,
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
    // 与构建脚本同构的两条越界解析（vendor 原样保留上游写法，替身在本仓库）：
    // `undici` 与 `../../../src/image-pricing.js`。少一条就构建失败。
    plugins: [{
      name: 'channel-pack-compat',
      setup(build) {
        build.onResolve({ filter: /^undici$/ }, (args) => {
          if (!args.importer.startsWith(VENDOR_SRC)) return undefined
          return { path: join(COMPAT, 'undici.ts') }
        })
        build.onResolve({ filter: /^\.\.\/\.\.\/\.\.\/src\/image-pricing\.js$/ }, (args) => {
          if (!args.importer.startsWith(VENDOR_SRC)) return undefined
          return { path: join(COMPAT, 'imagePricing.ts') }
        })
      },
    }],
    banner: {
      js: [
        "import { createRequire as __createRequire } from 'node:module'",
        'const require = __createRequire(import.meta.url)',
      ].join('\n'),
    },
  })
  return await import(pathToFileURL(outfile).href)
}

/**
 * 空缓存目录：`isCodeArtsBenefitModel` 优先读 `~/.cache/deveco` 的远端集合，
 * 那会让本测试随开发机状态漂移。指到空目录 ⇒ 只走静态兜底集合
 * （`glm-5.3-flash` / `deepseek-v4.1-flash` = benefit，其余不是）。
 */
function isolateBenefitCache(t) {
  const previous = process.env.DSH_CODEARTS_CACHE_DIR
  const dir = mkdtempSync(join(tmpdir(), 'codearts-cache-'))
  process.env.DSH_CODEARTS_CACHE_DIR = dir
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_CODEARTS_CACHE_DIR
    else process.env.DSH_CODEARTS_CACHE_DIR = previous
    rmSync(dir, { recursive: true, force: true })
  })
}

function sseResponse(text) {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

/** 用固定帧应答的适配器；`seen` 收集每次出站请求（按次序）。 */
function makeAdapter({ CodeArtsAdapter }, seen, frame) {
  const credential = {
    access_key_id: 'AK-test',
    secret_access_key: 'SK-test',
    security_token: 'ST-test',
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  }
  return new CodeArtsAdapter({
    credentialRef: { id: 'codearts-test', provider: 'codearts' },
    resolveCredential: async () => credential,
    refresh: async () => {},
    fetchImpl: async (_url, init) => {
      seen.push(new Headers(init?.headers))
      return sseResponse(frame)
    },
  })
}

async function runStream(adapter, model) {
  try {
    for await (const _chunk of adapter.stream({
      model,
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      // 只为把错误逼出来：帧里没有正文块，不会产出任何 chunk。
    }
  } catch (error) {
    return error
  }
  return undefined
}

test('benefit 模型的流内错误：去掉 maas_type 头重试一次', async (t) => {
  isolateBenefitCache(t)
  const mod = await loadAdapter(t)
  const seen = []
  const adapter = makeAdapter(mod, seen, BENEFIT_ROUTE_FRAME)

  const error = await runStream(adapter, 'glm-5.3-flash')

  assert.equal(seen.length, 2, '带 benefit 头失败后必须去头重试一次')
  assert.equal(seen[0].get('maas_type'), 'benefit', 'benefit 模型的第一次请求必须带 maas_type: benefit')
  assert.equal(seen[1].get('maas_type'), null, '重试必须去掉该头（这正是该账号能出流的那条通路）')
  assert.ok(error, '两次都失败时必须抛出')
})

test('抛出的文本带上游 error_code，且终态是 404 而不是 502', async (t) => {
  isolateBenefitCache(t)
  const mod = await loadAdapter(t)
  const seen = []
  const adapter = makeAdapter(mod, seen, BENEFIT_ROUTE_FRAME)

  const error = await runStream(adapter, 'deepseek-v4.1-flash')

  assert.match(String(error?.message), /APIG\.0604/, '必须保留上游 error_code：丢掉就把 APIG 层与 InferHub 层压成同一句散文')
  assert.match(String(error?.message), /does not exist or has not been published/, '上游原文要能到日志')
  assert.equal(error?.status, 404, '该账号供不上这个模型 = 404 终态；200/502 会让网关按可切换故障白重投并惩罚账号')
})

test('非 benefit 模型不带该头，失败即终态、不重投', async (t) => {
  isolateBenefitCache(t)
  const mod = await loadAdapter(t)
  const seen = []
  const adapter = makeAdapter(mod, seen, BENEFIT_ROUTE_FRAME)

  const error = await runStream(adapter, 'openpangu-2.0-flash')

  assert.equal(seen.length, 1, '没带 benefit 头就没有「去头重试」这回事')
  assert.equal(seen[0].get('maas_type'), null, '非 benefit 模型不得带 maas_type: benefit')
  assert.equal(error?.status, 404)
})

test('额度耗尽（4291）优先于 benefit 判据，不被去头重试抢走', async (t) => {
  isolateBenefitCache(t)
  const mod = await loadAdapter(t)
  const seen = []
  const adapter = makeAdapter(mod, seen, QUOTA_FRAME)

  const error = await runStream(adapter, 'glm-5.3-flash')

  assert.equal(seen.length, 1, '额度是按自然日结算的确定性失败，重试只会白烧一次往返')
  assert.equal(error?.code, 'QUOTA_EXCEEDED', '必须仍按额度分支报出，而不是被 benefit 判据降级成 INVALID_REQUEST')
})
