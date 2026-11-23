import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const VENDOR_SRC = join(ROOT, 'vendor', 'channel-pack', 'src')

/**
 * 图片附件引用契约（1.8.39 `no_available_model (vision required)` 与
 * `minimax: 图片未能内联` 的联合回归钉）。
 *
 * 链路：worker 的 `attachments.saveImage` 产出图片引用 → vendor 适配器按
 * `attachment.attachmentId` 收集/内联。两端字段名必须一致，断一处即全线失败。
 */

test('worker 附件桥 saveImage 必须返回 attachmentId（vendor 按 attachmentId 键控）', () => {
  const worker = readFileSync(join(ROOT, 'src/main/channelPack/worker.ts'), 'utf-8')
  const start = worker.indexOf('async saveImage(')
  assert.ok(start >= 0, 'worker 必须实现 saveImage')
  const body = worker.slice(start, worker.indexOf('async readImage('))
  assert.ok(
    /return\s*\{\s*attachmentId:\s*id/.test(body),
    'saveImage 返回对象必须含 attachmentId 字段（collectImages 按 attachment.attachmentId 收集）',
  )
})

test('vendor collectImages 按 attachmentId 收集图片引用（契约锚点不变）', () => {
  const compat = readFileSync(join(VENDOR_SRC, 'openai-compat.ts'), 'utf-8')
  assert.ok(
    compat.includes("block.attachment?.attachmentId === 'string'".replace(" === 'string'", '')),
    'collectImages 的收集键必须仍是 attachment.attachmentId',
  )
})

test('buddy listAllModels 必须上抛 supportsImage（与 inputModalitiesFor 同源）', () => {
  const adapter = readFileSync(join(VENDOR_SRC, 'buddy-adapter.ts'), 'utf-8')
  const start = adapter.indexOf('listAllModels():')
  assert.ok(start >= 0, 'buddy 适配器必须实现 listAllModels')
  const body = adapter.slice(start, adapter.indexOf('staticFallbackModels():', start))
  assert.ok(
    body.includes('supportsImage'),
    'listAllModels 返回条目必须带 supportsImage，否则宿主把全部 buddy 模型记成视觉未知，' +
      'auto 路由的 vision 硬过滤会判空池（no_available_model (vision required)）',
  )
  assert.ok(
    body.includes('inputModalitiesFor'),
    'supportsImage 的判据必须与 listModels 的 inputModalitiesFor 同一份，不许另造第二套',
  )
})
