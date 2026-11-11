import { after, test } from 'node:test'
import assert from 'node:assert/strict'

const { bootstrapStore } = await import('../routes/harness.mjs')

import { RETIRED_PROVIDER_IDS } from '../../src/shared/types.ts'
import { isRetiredProviderId, retiredProviderIds } from '../../src/main/providers/providerRetirement.ts'

/**
 * 退役名单与现役 id 的重名（2026-11-11 用户报告「更新后 DeepSeek 的 Key 丢了」）。
 *
 * 1.5 退役的网页登录集成占用的名字，后来被聚合目录和账号渠道原样重用；凭据账号又都按
 * `providerId = 这个名字` 落进同一张 `accounts` 表。启动清理原先只按名单判，于是每次
 * 网关启动（自更新必然带一次重启）都把用户配好的 Key 连同每模型开关一起当孤儿删掉。
 */
const LIVE_COLLISION_NAMES = ['deepseek', 'glm', 'kimi', 'minimax', 'zai']
const STILL_RETIRED_NAMES = ['mimo', 'qwen', 'qwen-ai']

const provider = (id: string, name: string, type: 'aggregate' | 'account') => ({
  id,
  name,
  type,
  authType: 'token',
  apiEndpoint: type === 'aggregate' ? `https://${id}.example/v1` : `channel://${id}`,
  chatPath: '/chat/completions',
  headers: {},
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
  supportedModels: [`${id}/model-one`],
  modelMappings: { [`${id}/model-one`]: 'model-one' },
})

const account = (id: string, providerId: string, credentials: Record<string, string>) => ({
  id,
  providerId,
  name: `${id} account`,
  credentials,
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
})

const INITIAL_DATA = {
  providers: [
    provider('deepseek', 'DeepSeek', 'aggregate'),
    provider('minimax', 'MiniMax', 'account'),
    provider('mimo', 'MiMo', 'account'),
  ],
  accounts: [
    account('acct-ds', 'deepseek', { apiKey: 'sk-ds-keep-me' }),
    account('acct-mm', 'minimax', { accessToken: 'channel-token-keep-me' }),
    account('acct-mimo', 'mimo', { cookie: 'legacy-web-page-cookie' }),
    account('acct-ovh', 'ovh', { apiKey: 'sk-unrelated-control' }),
  ],
  userModelOverrides: {
    deepseek: { addedModels: [], excludedModels: ['deepseek/deepseek-chat'] },
    mimo: { addedModels: [], excludedModels: ['mimo/model-one'] },
  },
  logs: [],
  requestLogs: [],
  statistics: {},
  tokenUsage: {},
  config: {},
}

const harness = await bootstrapStore({ initialData: INITIAL_DATA })
const storeManager = harness.storeManager as any

function diskAccounts(): Array<{ id: string; providerId: string; credentials: Record<string, string> }> {
  return harness.dataFile().accounts || []
}

test('判据只把「名单里且无任何现役定义」的名字算作退役', () => {
  assert.deepEqual(retiredProviderIds(), STILL_RETIRED_NAMES)
  for (const name of LIVE_COLLISION_NAMES) {
    assert.equal(isRetiredProviderId(name), false, `${name} 仍在目录/渠道里服役，不许按退役名单判死`)
  }
  // 名单本身不许悄悄变：新增或移除名字都要重新对账到这两组里。
  assert.deepEqual(
    [...RETIRED_PROVIDER_IDS].sort(),
    [...LIVE_COLLISION_NAMES, ...STILL_RETIRED_NAMES].sort(),
  )
})

test('聚合 DeepSeek 的 Key 跨启动存活，值一个字节没变', () => {
  const row = diskAccounts().find(a => a.id === 'acct-ds')
  assert.ok(row, '配好的 API Key 账号不许在启动清理里被当孤儿删掉')
  assert.equal(row.credentials.apiKey, 'sk-ds-keep-me')
  assert.equal(
    (harness.dataFile().providers || []).some((p: { id: string }) => p.id === 'deepseek'),
    true,
    '供应商记录本来就没被删（界面因此显示「已配置但 0 把 Key」）',
  )
})

test('账号渠道的凭据同样存活，因为渠道 id 也重用了退役名字', () => {
  const row = diskAccounts().find(a => a.id === 'acct-mm')
  assert.ok(row, 'minimax 既是退役网页集成的名字，也是现役渠道 id')
  assert.equal(row.credentials.accessToken, 'channel-token-keep-me')
})

test('没有任何现役定义的名字照旧被清干净，判据不是空转', () => {
  const ids = diskAccounts().map(a => a.id)
  assert.equal(ids.includes('acct-mimo'), false, '真退役的账号必须仍然被删，否则这条门没有电')
  assert.equal('mimo' in (harness.dataFile().userModelOverrides || {}), false)
  // 与退役无关的条目不许被顺手波及。
  assert.ok(ids.includes('acct-ovh'), '同表里的无关账号原样保留')
})

test('每模型开关：重名条目的存活，真退役条目的整删', () => {
  const overrides = harness.dataFile().userModelOverrides || {}
  assert.deepEqual(overrides.deepseek, { addedModels: [], excludedModels: ['deepseek/deepseek-chat'] })
  assert.equal('mimo' in overrides, false)
})

test('重启第二次跑同一段启动同步，账号表不再变（幂等）', async () => {
  const before = diskAccounts().map(a => a.id).sort()
  await storeManager.initializeDefaultProviders()
  assert.deepEqual(diskAccounts().map(a => a.id).sort(), before, '重启不许再删任何东西')
})

after(() => harness.dispose())
