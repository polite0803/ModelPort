import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  readArkAgentPlanModels,
  signVolcengineV4,
  volcengineAccessKeyFromEnv,
} from '../../src/main/providers/aggregate/volcenginePlanCatalog.ts'
import { bootstrapStore, loadModule } from '../routes/harness.mjs'

test('readArkAgentPlanModels maps Datas[].ModelID and dedups', () => {
  const rows = readArkAgentPlanModels({
    Datas: [
      { ModelID: 'deepseek-v4.1-flash', ModelName: 'DeepSeek V4.1 Flash' },
      { ModelID: 'deepseek-v4.1-flash' },
      { ModelID: 'glm-5.3' },
      { ModelID: '  ' },
      null,
    ],
  })
  assert.deepEqual(rows, [
    { actualModelId: 'deepseek-v4.1-flash', displayName: 'DeepSeek V4.1 Flash' },
    { actualModelId: 'glm-5.3', displayName: 'glm-5.3' },
  ])
})

test('readArkAgentPlanModels: bad shape is null, explicit empty array is []', () => {
  assert.equal(readArkAgentPlanModels(null), null)
  assert.equal(readArkAgentPlanModels([]), null)
  assert.equal(readArkAgentPlanModels({}), null)
  assert.equal(readArkAgentPlanModels({ Datas: 'nope' }), null)
  assert.deepEqual(readArkAgentPlanModels({ Datas: [] }), [])
})

test('signVolcengineV4 produces a stable V4 Authorization header', () => {
  const now = new Date('2026-11-15T08:00:00Z')
  const input = {
    accessKeyId: 'AKTEST',
    secretAccessKey: 'SKTEST',
    method: 'POST',
    path: '/',
    query: { Action: 'ListArkAgentPlanModel', Version: '2024-01-01' },
    body: '{"Edition":"personal"}',
    now,
  }
  const a = signVolcengineV4(input)
  const b = signVolcengineV4(input)
  assert.equal(a.Authorization, b.Authorization)
  assert.equal(a['X-Date'], '20261115T080000Z')
  assert.match(a.Authorization, /^HMAC-SHA256 Credential=AKTEST\/20261115\/cn-beijing\/ark\/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=[0-9a-f]{64}$/)
  const other = signVolcengineV4({ ...input, secretAccessKey: 'DIFFERENT' })
  assert.notEqual(other.Authorization, a.Authorization)
})

test('volcengineAccessKeyFromEnv reads standard and legacy pairs', () => {
  const saved = { ...process.env }
  try {
    delete process.env.VOLCENGINE_ACCESS_KEY_ID
    delete process.env.VOLCENGINE_SECRET_ACCESS_KEY
    delete process.env.VOLC_ACCESSKEY
    delete process.env.VOLC_SECRETKEY
    assert.equal(volcengineAccessKeyFromEnv(), null)
    process.env.VOLC_ACCESSKEY = 'ak'
    process.env.VOLC_SECRETKEY = 'sk'
    assert.deepEqual(volcengineAccessKeyFromEnv(), { accessKeyId: 'ak', secretAccessKey: 'sk' })
    process.env.VOLCENGINE_ACCESS_KEY_ID = 'ak2'
    process.env.VOLCENGINE_SECRET_ACCESS_KEY = 'sk2'
    assert.deepEqual(volcengineAccessKeyFromEnv(), { accessKeyId: 'ak2', secretAccessKey: 'sk2' })
  } finally {
    process.env = saved
  }
})

/* ------------------------------------------------------------------ */
/* 管理器层：控制台填入的 IAM AK/SK 密封落账号凭据，与聊天 Key 分离      */
/* ------------------------------------------------------------------ */

const harness = await bootstrapStore({})
const { aggregateProviderManager } = await loadModule('main/providers/aggregate/manager.ts')
const { getAggregateEntry } = await loadModule('main/providers/aggregate/registry.ts')
const PLAN_ID = 'volcengine_ark_agent_plan'
const planFirstModel = getAggregateEntry(PLAN_ID)!.models[0].id

after(() => harness.dispose())

test('console AK/SK are sealed into account credentials and reported by detail', () => {
  assert.equal(aggregateProviderManager.detail(PLAN_ID)!.planCatalogConfigured, false)

  aggregateProviderManager.save({
    id: PLAN_ID,
    apiKeys: ['ark-plan-chat-key'],
    models: [planFirstModel],
    planAccessKeyId: 'AKCONSOLE',
    planSecretAccessKey: 'SKCONSOLE',
  })

  const stored = harness.storeManager.getAccountsByProviderId(PLAN_ID, true)
  assert.equal(stored.length, 1)
  assert.equal(stored[0].credentials.apiKey, 'ark-plan-chat-key')
  assert.equal(stored[0].credentials.accessKeyId, 'AKCONSOLE')
  assert.equal(stored[0].credentials.secretAccessKey, 'SKCONSOLE')
  assert.equal(aggregateProviderManager.detail(PLAN_ID)!.planCatalogConfigured, true)
})

test('a plain save without AK/SK keeps the stored pair (no silent wipe)', () => {
  aggregateProviderManager.save({
    id: PLAN_ID,
    apiKeys: ['ark-plan-chat-key-2'],
    models: [planFirstModel],
  })
  const stored = harness.storeManager.getAccountsByProviderId(PLAN_ID, true)
  assert.ok(stored.some(account => account.credentials.accessKeyId === 'AKCONSOLE'
    && account.credentials.secretAccessKey === 'SKCONSOLE'))
  assert.equal(aggregateProviderManager.detail(PLAN_ID)!.planCatalogConfigured, true)
})