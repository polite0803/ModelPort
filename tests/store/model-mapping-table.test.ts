/**
 * 全局别名表只留用户条目。
 *
 * 聚合成与账号渠道同步过去会把每个模型写成一行全局映射（`<entry>/<model>` →
 * `<model>`、`渠道名 / 展示名` → `<channel>/<内部 id>`），且每轮整表重写。这一层
 * 证明两件事：这些机器接线行在读侧被摘回供应商账本，而用户自己写的别名（含同名的
 * 不同目标）原样保留；以及接线撤走后，路由仍能从目录推导出同一个「归属供应商」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeModelMappingsWithDefaults } from '../../src/main/store/types.ts'
import { derivePreferredProvider } from '../../src/main/store/modelServing.ts'
import type { ModelMapping } from '../../src/main/store/types.ts'

type LedgerProvider = { id: string; type: 'aggregate' | 'account' | 'custom'; modelMappings?: Record<string, string> }

const row = (requestModel: string, actualModel: string, preferredProviderId?: string): ModelMapping => ({
  requestModel,
  actualModel,
  preferredProviderId,
})

const PROVIDERS: LedgerProvider[] = [
  { id: 'ovh', type: 'aggregate', modelMappings: { 'ovh/deepseek-chat': 'deepseek-chat' } },
  { id: 'trae', type: 'account', modelMappings: { 'Trae / DeepSeek-Flash': 'trae/qmodel_38max' } },
  { id: 'mine', type: 'custom' },
]

test('the sync-written wiring rows are not user data and are dropped', () => {
  const table = {
    'ovh/deepseek-chat': row('ovh/deepseek-chat', 'deepseek-chat', 'ovh'),
    'Trae / DeepSeek-Flash': row('Trae / DeepSeek-Flash', 'trae/qmodel_38max', 'trae'),
  }

  assert.deepEqual(normalizeModelMappingsWithDefaults(table, PROVIDERS), {})
})

test('a user alias survives: unpinned rename, pinned retarget, and same-name pin', () => {
  const table = {
    // 纯改名：没有钉定，任何一家都按这个名字的目录/账本解析
    fast: row('fast', 'gpt-4o-mini'),
    // 用户把一个目录名改指到另一个目标（账本里同名键的值不同）
    'ovh/deepseek-chat': row('ovh/deepseek-chat', 'deepseek-v3.1', 'ovh'),
    // 只有钉定、名字不在任何账本里
    'my-model': row('my-model', 'anything', 'mine'),
  }

  assert.deepEqual(normalizeModelMappingsWithDefaults(table, PROVIDERS), table)
})

test('a pin whose provider no longer exists is dropped instead of staying a dead target', () => {
  const table = {
    ghost: row('ghost', 'anything', 'deleted-provider'),
    kept: row('kept', 'anything', 'trae'),
  }

  assert.deepEqual(Object.keys(normalizeModelMappingsWithDefaults(table, PROVIDERS)), ['kept'])
})

test('with no providers to judge against, nothing is mass-dropped except retired owners', () => {
  const table = {
    ghost: row('ghost', 'anything', 'deleted-provider'),
    legacy: row('legacy', 'anything', 'kimi'),
  }

  assert.deepEqual(Object.keys(normalizeModelMappingsWithDefaults(table, [])), ['ghost'])
  assert.deepEqual(Object.keys(normalizeModelMappingsWithDefaults(table)), ['ghost'])
})

test('derivePreferredProvider pins the owner a machine row used to carry', () => {
  // 聚合前缀：只有该条目的同步会产出这个形状的名字
  assert.equal(derivePreferredProvider('ovh/deepseek-chat', PROVIDERS), 'ovh')
  // 账号渠道的展示名：账本里有同名键
  assert.equal(derivePreferredProvider('Trae / DeepSeek-Flash', PROVIDERS), 'trae')
  // 裸名既不是聚合前缀也不在任何账本里 —— 没有归属，别凭空钉一家
  assert.equal(derivePreferredProvider('gpt-4o', PROVIDERS), undefined)
  // 前缀是账号渠道 id 而不是聚合条目：那不是同步会写的形状
  assert.equal(derivePreferredProvider('trae/unknown', PROVIDERS), undefined)
})