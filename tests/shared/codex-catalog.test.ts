/**
 * catalog 的逐字段改写（`shared/codexCatalog.ts`）。
 *
 * 只改两格：`context_window` 与 `input_modalities`。后者取池内**交集**——广告「支持
 * 图片」就必须每个候选都支持，否则客户端的附图请求会落到纯文本模型上被 503，而它
 * 只看到一句失败。这里覆盖三条不变式：有读数才写、没读数不动、已是目标值不动。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { rewriteCatalog, type CatalogAdvertisement } from '../../src/shared/codexCatalog.ts'

const doc = (models: unknown[]) => JSON.stringify({ models }, null, 2) + '\n'

test('vision=true 写成 text+image；false 写成 text；两种都只动这一格', () => {
  const raw = doc([
    { slug: 'daily', context_window: 200000, input_modalities: ['text'], comp_hash: 'abc' },
    { slug: 'codex', context_window: 400000, input_modalities: ['text', 'image'] },
  ])
  const advertised = new Map<string, CatalogAdvertisement>([
    ['daily', { vision: true }],
    ['codex', { vision: false }],
  ])
  const result = rewriteCatalog(raw, advertised)
  assert.ok(result)
  const parsed = JSON.parse(result!.content)
  assert.deepEqual(parsed.models[0].input_modalities, ['text', 'image'])
  assert.deepEqual(parsed.models[1].input_modalities, ['text'])
  assert.equal(parsed.models[0].context_window, 200000, '没给窗口就不动窗口')
  assert.equal(parsed.models[0].comp_hash, 'abc')
})

test('vision=undefined（空池）时保持原值，不改成 text', () => {
  const raw = doc([{ slug: 'daily', input_modalities: ['text', 'image'] }])
  assert.equal(rewriteCatalog(raw, new Map([['daily', {}]])), null)
})

test('已是目标模态时是空操作', () => {
  const raw = doc([{ slug: 'daily', input_modalities: ['text', 'image'] }])
  assert.equal(rewriteCatalog(raw, new Map([['daily', { vision: true }]])), null)
})

test('窗口与模态一次改完，changes 两条', () => {
  const raw = doc([{ slug: 'daily', context_window: 200000, input_modalities: ['text'] }])
  const result = rewriteCatalog(raw, new Map([['daily', { contextWindow: 400000, vision: true }]]))
  assert.ok(result)
  assert.deepEqual(result!.changes.map(c => c.field).sort(), ['context_window', 'input_modalities'])
})

test('网关不服务的 slug 不动', () => {
  const raw = doc([{ slug: 'official-x', input_modalities: ['text'] }])
  assert.equal(rewriteCatalog(raw, new Map([['daily', { vision: true }]])), null)
})