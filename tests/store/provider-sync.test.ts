import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { syncBuiltinProvider } from '../../src/main/store/providerSync.ts'
import type { BuiltinProviderConfig, Provider } from '../../src/main/store/types.ts'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

/**
 * 合成的随包配置。
 *
 * 这组判据原本拿 opencode 的内置配置当载体，那个供应商已于 2026-11-01 退役；
 * `syncBuiltinProvider` 与具体供应商无关，所以载体换成夹具，判据本身一条不减。
 */
const shipped: BuiltinProviderConfig = {
  id: 'fixture',
  name: 'Fixture',
  type: 'builtin',
  authType: 'token',
  apiEndpoint: 'https://shipped.example/v1',
  chatPath: '/chat/completions',
  headers: { 'X-Shipped': 'yes' },
  enabled: true,
  description: 'shipped description',
  supportedModels: ['Fixture-One', 'Fixture-Two'],
  modelMappings: { 'Fixture-One': 'fixture-one', 'Fixture-Two': 'fixture-two' },
  credentialFields: [],
  modelsFetch: { url: 'https://shipped.example/models', reader: 'auto' },
}

function stored(overrides: Partial<Provider>): Provider {
  return {
    id: 'fixture',
    name: 'Fixture',
    type: 'builtin',
    authType: 'token',
    apiEndpoint: 'https://stale.example',
    headers: {},
    enabled: true,
    createdAt: 1,
    updatedAt: 2,
    supportedModels: ['Old-Model'],
    modelMappings: { 'Old-Model': 'old-model' },
    ...overrides,
  }
}

test('a record with a stale or missing type is repaired and gets the shipped fields', () => {
  for (const type of ['custom', undefined] as const) {
    const fixed = syncBuiltinProvider(stored({ type } as Partial<Provider>), shipped)
    assert.equal(fixed.type, 'builtin')
    assert.equal(fixed.apiEndpoint, shipped.apiEndpoint)
    assert.deepEqual(fixed.supportedModels, shipped.supportedModels)
    assert.equal(fixed.supportsModelFetch, true, `声明了 modelsFetch 就该可在线更新 (type=${type})`)
  }
})

test('user-owned fields survive the repair', () => {
  const fixed = syncBuiltinProvider(stored({ name: 'My Fixture', enabled: false, createdAt: 7 }), shipped)
  assert.equal(fixed.name, 'My Fixture')
  assert.equal(fixed.enabled, false)
  assert.equal(fixed.createdAt, 7)
})

test('a provider without modelsFetch is marked unsupported rather than inheriting a stale flag', () => {
  const fixed = syncBuiltinProvider(
    stored({ supportedModels: ['Stale'], supportsModelFetch: true }),
    { ...shipped, modelsFetch: undefined },
  )
  assert.equal(fixed.supportsModelFetch, false)
  assert.deepEqual(fixed.supportedModels, shipped.supportedModels)
})

test('在线更新标记只认 modelsFetch：本机运行时那一档已退役', () => {
  // 判据钉的是「runtimeModels 这个概念没有被偷偷加回来」。加回来时这条会红，
  // 逼着改动同时把清单来源、状态检查、endpoint 豁免那三处一起补回来。
  const syncSource = readFileSync(join(root, 'src/main/store/providerSync.ts'), 'utf8')
  const typeSource = readFileSync(join(root, 'src/main/store/types.ts'), 'utf8')
  const modelListSource = readFileSync(join(root, 'src/main/providers/modelListSource.ts'), 'utf8')

  assert.match(syncSource, /supportsModelFetch: Boolean\(config\.modelsFetch\)/)
  assert.doesNotMatch(syncSource, /runtimeModels/)
  assert.doesNotMatch(typeSource, /runtimeModels\?:/)
  assert.doesNotMatch(modelListSource, /'runtime'/)
})
