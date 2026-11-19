/**
 * CodeArts 图片通路的序列化契约。
 *
 * 背景（2026-11-18 现网）：路由 `stable` 钉住 `CodeArts / GLM-5.3-Flash` 后，
 * 带截图的会话每一轮都拿到 503 `no_available_model`（`missing: ['vision']`）。
 * 宿主侧的判据没错 —— 这条渠道的适配器当时把非文本块整块丢掉，图片到不了
 * 上游。直连探测（1×1 纯红 PNG 的 `image_url` 块）证明**端点本身接受图片**，
 * 因此本适配器补上读取与序列化，并把 `glm-5.3-flash` 播报成多模态。
 *
 * 本文件钉死三件事：
 * 1. 没有图片时走原来的纯文本路径（线上字节不变）；
 * 2. 有图片时 user 消息升级为 `[{text}, {image_url}]`；字节读取失败留下
 *    `[image unavailable]` 占位符，而不是静默丢图；
 * 3. 工具结果内嵌的图片（截图类工具）提升为独立的 user 消息 ——
 *    `role:'tool'` 的 content 只能是字符串。
 *
 * ⚠️ vendor 源码不能直接 import（虚拟模块 + `.js`→`.ts` 解析），这里按
 * `scripts/build-channel-pack.mjs` 的同一套别名打成临时 bundle 再加载。
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

const IMAGE_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

async function loadSerializer(t) {
  const esbuild = await import('esbuild')
  const dir = mkdtempSync(join(tmpdir(), 'codearts-image-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const outfile = join(dir, 'bundle.mjs')
  await esbuild.build({
    stdin: {
      contents: `export { serializeMessages } from ${JSON.stringify(join(VENDOR_SRC, 'llm-adapter.ts'))}`,
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

const imageBlock = (attachmentId) => ({ type: 'image', attachment: { attachmentId } })

test('无图片：user 消息保持纯文本（线上字节不变）', async t => {
  const { serializeMessages } = await loadSerializer(t)
  const wire = serializeMessages([
    { role: 'user', content: [{ type: 'text', text: 'hello' }] },
  ])
  assert.deepEqual(wire, [{ role: 'user', content: 'hello' }])
})

test('有图片：user 消息升级为多模态 parts', async t => {
  const { serializeMessages } = await loadSerializer(t)
  const wire = serializeMessages([
    {
      role: 'user',
      content: [
        { type: 'text', text: '这图里是什么' },
        imageBlock('img-1'),
      ],
    },
  ], new Map([['img-1', IMAGE_URL]]))

  assert.deepEqual(wire, [{
    role: 'user',
    content: [
      { type: 'text', text: '这图里是什么' },
      { type: 'image_url', image_url: { url: IMAGE_URL } },
    ],
  }])
})

test('字节读取失败：留下占位符，不静默丢图', async t => {
  const { serializeMessages } = await loadSerializer(t)
  // 空 Map（不是 undefined）：图片存在但一张都没读到。
  const wire = serializeMessages([
    { role: 'user', content: [imageBlock('img-1')] },
  ], new Map())

  assert.deepEqual(wire, [{
    role: 'user',
    content: [{ type: 'text', text: '[image unavailable]' }],
  }])
})

test('工具结果内嵌图片：提升为独立的 user 消息，tool 消息只留文本', async t => {
  const { serializeMessages } = await loadSerializer(t)
  const wire = serializeMessages([
    { role: 'user', content: '截个图看看' },
    {
      role: 'assistant',
      content: [{ type: 'tool-call', id: 'call-1', name: 'screenshot', arguments: '{}' }],
    },
    {
      role: 'user',
      content: [{
        type: 'tool-result',
        toolCallId: 'call-1',
        content: [
          { type: 'text', text: 'captured' },
          imageBlock('img-2'),
        ],
      }],
    },
  ], new Map([['img-2', IMAGE_URL]]))

  assert.equal(wire[0].role, 'user')
  assert.equal(wire[0].content, '截个图看看')
  assert.equal(wire[1].role, 'assistant')
  assert.equal(wire[1].reasoning_content, '')
  assert.equal(wire[1].tool_calls[0].id, 'call-1')

  const toolMessage = wire.find(message => message.role === 'tool')
  assert.equal(toolMessage.content, 'captured')

  const lifted = wire.filter(message => message.role === 'user').at(-1)
  assert.deepEqual(lifted.content, [
    { type: 'text', text: 'Attached image(s) from tool result:' },
    { type: 'image_url', image_url: { url: IMAGE_URL } },
  ])
})