import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  AGGREGATE_REGISTRY,
  getAggregateEntry,
  aggregateAuthHeader,
  aggregateChatPath,
  aggregateModelName,
} from '../../src/main/providers/aggregate/registry.ts'

test('the catalogue carries the entries that can actually be wired', () => {
  assert.equal(AGGREGATE_REGISTRY.length, 102)
  // 473 transcribed, minus 7 retired upstream on 2026-10-29 (3 anthropic + 4 xai),
  // minus the withdrawn mistral_codestral entry (its single model went with it),
  // plus the Agnes CN switch (agnes-2.0-flash -> agnes-3.0-flash + agnes-2.5-flash),
  // plus the Qiniu Conatus campaign entry (qiniu/conatus-free),
  // plus the SenseNova Token Plan entry (6 models),
  // plus the 2026-10-30 freellmpool port (1 + 11 + 5 + 4 + 6 = 27 models).
  // plus the 2026-11-03 domestic entries: Baichuan, Bailian payg/Token Plan,
  // SiliconFlow CN, Spark, StepFun payg/Step Plan, Volcengine platform/Agent Plan, Yi.
  // minus 2 net on 2026-11-08: minimax-cn dropped its three retired M2.x ids and
  // gained M3.1-Flash (4 -> 2 models), per the live 404 (2069) readings.
  // plus 3 entries / 12 models on 2026-11-10: PPIO (12 transcribed from its live
  // /models), Huawei ModelArts Studio and Infini-AI (0 each - empty baselines,
  // ids arrive through modelsUrl once a key is saved).
  // plus 1 entry / 0 models on 2026-11-12: Nous Research Portal (key-only; its
  // /v1/models is an OpenRouter proxy list, so the baseline stays empty).
  // plus 9 entries / 43 models on 2026-11-12: the domestic subscription-plan batch
  // (Bailian Coding; Tencent Coding and Token; Qianfan Coding and Token; iFlytek
  // Astron Coding and Token; JD Cloud Coding and Token). Empty or single-"latest"
  // baselines are deliberate - those vendors publish model ids only in their
  // console, and inventing slugs would turn "unknown" into a wrong answer.
  assert.equal(AGGREGATE_REGISTRY.reduce((sum, entry) => sum + entry.models.length, 0), 623)

  // Browser-login account channels are retired; the responses-only relay is not wired.
  for (const excluded of ['openai', 'github_copilot', 'fleetrelay_t1']) {
    assert.equal(getAggregateEntry(excluded), undefined, `${excluded} must not be listed`)
  }
  // ... but OpenAI's key endpoint stays, over the chat wire.
  const openai = getAggregateEntry('openai_api')
  assert.ok(openai)
  assert.equal(openai!.wire, 'openai-chat')
})

test('ids and model ids are unique so display names never collide', () => {
  const ids = new Set<string>()
  for (const entry of AGGREGATE_REGISTRY) {
    assert.equal(ids.has(entry.id), false, `duplicate entry id: ${entry.id}`)
    ids.add(entry.id)

    const modelIds = new Set<string>()
    for (const model of entry.models) {
      assert.equal(modelIds.has(model.id), false, `${entry.id} repeats model ${model.id}`)
      modelIds.add(model.id)
    }
  }

  const displayNames = new Set<string>()
  for (const entry of AGGREGATE_REGISTRY) {
    for (const model of entry.models) {
      const name = aggregateModelName(entry.id, model.id)
      assert.equal(displayNames.has(name), false, `duplicate display name: ${name}`)
      displayNames.add(name)
    }
  }
})

test('only the three anthropic endpoints use the messages wire', () => {
  const anthropic = AGGREGATE_REGISTRY
    .filter(entry => entry.wire === 'anthropic-messages')
    .map(entry => entry.id)
    .sort()
  assert.deepEqual(anthropic, ['anthropic', 'glm', 'minimax-cn'])

  for (const entry of AGGREGATE_REGISTRY) {
    assert.ok(entry.wire === 'openai-chat' || entry.wire === 'anthropic-messages')
  }
})

test('auth header follows the wire, with azure as the documented exception', () => {
  const anthropic = getAggregateEntry('anthropic')!
  assert.deepEqual(aggregateAuthHeader(anthropic), { header: 'x-api-key', prefix: '' })

  const glm = getAggregateEntry('glm')!
  assert.deepEqual(aggregateAuthHeader(glm), { header: 'x-api-key', prefix: '' })

  const azure = getAggregateEntry('azure_openai')!
  assert.deepEqual(aggregateAuthHeader(azure), { header: 'api-key', prefix: '' })

  const groq = getAggregateEntry('groq')!
  assert.deepEqual(aggregateAuthHeader(groq), { header: 'Authorization', prefix: 'Bearer ' })
})

test('chat path follows the wire', () => {
  assert.equal(aggregateChatPath(getAggregateEntry('anthropic')!), '/messages')
  assert.equal(aggregateChatPath(getAggregateEntry('groq')!), '/chat/completions')
})

test('kilo is key-less and every entry needing a key says where to get one', () => {
  const kilo = getAggregateEntry('kilo')!
  assert.equal(kilo.authKind, 'none')
  assert.equal(kilo.baseUrl, 'https://api.kilo.ai/api/gateway')
  assert.ok(kilo.models.some(model => model.id === 'kilo-auto/free'))

  for (const entry of AGGREGATE_REGISTRY) {
    if (entry.authKind !== 'apiKey') continue
    assert.ok(entry.authUrl, `${entry.id} must link to its key page`)
  }
})

/**
 * 2026-10-30 从 freellmpool（0xzr/freellmpool, MIT）移植的五家。去重后只进了
 * 它有而本目录没有的供应商；免验证的两家自动开通，其余三家要 key。
 */
test('the freellmpool port: keyless pair auto-provisions, keyed trio does not', () => {
  const pollinations = getAggregateEntry('pollinations')!
  assert.equal(pollinations.authKind, 'none')
  assert.equal(pollinations.autoProvision, true)
  assert.equal(pollinations.baseUrl, 'https://text.pollinations.ai/openai')
  // 同一后端的别名不进基线，免得自动路由一后端多路重复扇出。
  assert.deepEqual(pollinations.models.map(m => m.id), ['openai-fast'])
  assert.equal(pollinations.modelsUrl, 'https://text.pollinations.ai/openai/models')

  const ovh = getAggregateEntry('ovh')!
  assert.equal(ovh.authKind, 'none')
  assert.equal(ovh.autoProvision, true)
  assert.equal(ovh.baseUrl, 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1')
  assert.ok(ovh.models.some(model => model.id === 'gpt-oss-120b'))
  // 上游停用/仅 pin 的行不进基线。
  assert.ok(!ovh.models.some(model => model.id === 'Qwen3-32B'))
  assert.ok(!ovh.models.some(model => model.id === 'Qwen3.8-27B'))

  for (const id of ['requesty', 'aion', 'modelscope']) {
    const entry = getAggregateEntry(id)!
    assert.equal(entry.authKind, 'apiKey', `${id} needs a key`)
    assert.notEqual(entry.autoProvision, true, `${id} must not auto-provision`)
    assert.ok(entry.authUrl && entry.envVar, `${id} must say where to get its key`)
  }
  assert.equal(getAggregateEntry('requesty')!.baseUrl, 'https://router.requesty.ai/v1')
  assert.equal(getAggregateEntry('aion')!.baseUrl, 'https://api.aionlabs.ai/v1')
  assert.equal(getAggregateEntry('modelscope')!.baseUrl, 'https://api-inference.modelscope.cn/v1')
})

test('entries without a usable default endpoint stay visible with a null baseUrl', () => {
  for (const id of ['azure_openai']) {
    const entry = getAggregateEntry(id)!
    assert.equal(entry.baseUrl, null)
  }
  // Placeholders are not expanded; the UI has to ask the user for a real baseUrl.
  for (const id of ['vertex', 'vertex-partner']) {
    assert.equal(getAggregateEntry(id)!.authKind, 'unsupported')
  }
})

/**
 * 上游已退役的模型不许被"重新转录"回来。它们仍会解析成 200（有的直接重定向到另一个模型），
 * 所以只有这份名单能挡住"看着能用、其实拿不到你要的模型"。
 */
test('models retired upstream stay out of the catalogue', () => {
  const retired: Array<[string, string]> = [
    ['anthropic', 'claude-sonnet-4-20250514'],
    ['anthropic', 'claude-opus-4-20250514'],
    ['anthropic', 'claude-3-5-sonnet-20241022'],
    ['xai', 'grok-4-fast-reasoning'],
    ['xai', 'grok-code-fast-1'],
    ['xai', 'grok-3'],
    ['xai', 'grok-4'],
  ]

  for (const [entryId, modelId] of retired) {
    const entry = getAggregateEntry(entryId)
    assert.ok(entry, `${entryId} must still be listed; only its dead models are removed`)
    assert.ok(
      !entry!.models.some(model => model.id === modelId),
      `${entryId}/${modelId} is retired upstream and must not be re-added`
    )
  }

  // 反向对照：删过头会把整家的活模型一起带走，这里钉住两家仍在服务的 id。
  for (const modelId of ['grok-4.6', 'grok-4.5']) {
    assert.ok(getAggregateEntry('xai')!.models.some(model => model.id === modelId), `xai/${modelId} still serves`)
  }
  assert.equal(getAggregateEntry('anthropic')!.models.length, 0, 'the anthropic entry is intentionally model-less')
})

test('domestic payg and subscription endpoints stay separate entries', () => {
  // 套餐端点与按量端点的 Base URL、Key 互不相通，合并成一条会让用户把 Key 填进错误的计费域。
  assert.equal(getAggregateEntry('bailian')!.baseUrl, 'https://dashscope.aliyuncs.com/compatible-mode/v1')
  assert.equal(
    getAggregateEntry('bailian_token_plan')!.baseUrl,
    'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
  )
  assert.notEqual(getAggregateEntry('bailian')!.id, getAggregateEntry('bailian_token_plan')!.id)

  assert.equal(
    getAggregateEntry('volcengine_ark_platform')!.baseUrl,
    'https://ark.cn-beijing.volces.com/api/v3'
  )
  assert.equal(
    getAggregateEntry('volcengine-ark')!.baseUrl,
    'https://ark.cn-beijing.volces.com/api/coding/v3'
  )
  assert.equal(
    getAggregateEntry('volcengine_ark_agent_plan')!.baseUrl,
    'https://ark.cn-beijing.volces.com/api/plan/v3'
  )

  assert.equal(getAggregateEntry('stepfun')!.baseUrl, 'https://api.stepfun.com/v1')
  assert.equal(getAggregateEntry('stepfun_step_plan')!.baseUrl, 'https://api.stepfun.com/step_plan/v1')

  for (const id of ['baichuan', 'spark', 'yi', 'siliconflow_cn']) {
    const entry = getAggregateEntry(id)!
    assert.equal(entry.authKind, 'apiKey', `${id} needs a key`)
    assert.ok(entry.authUrl, `${id} must link to its key page`)
    assert.ok(entry.models.length > 0, `${id} must ship at least one model id`)
  }
})

test('the withdrawn codestral entry is gone, but its model stays reachable via mistral', () => {
  assert.equal(getAggregateEntry('mistral_codestral'), undefined,
    'codestral.mistral.ai is not in Mistral’s published docs; the entry was withdrawn on 2026-10-29')
  assert.ok(
    getAggregateEntry('mistral')!.models.some(model => model.id === 'codestral-latest'),
    'withdrawing the duplicate entry must not take codestral-latest away from the mistral entry'
  )
})

/**
 * 2026-11-10 新增的三家，端点都用无凭据请求实测过（403/400/401 只能证明
 * "路径存在、缺 Authorization"，不能证明模型可用）。华为与无问芯穹故意不写
 * 基线模型：它们的 id 需要 Key 才拿得到，编一个假 slug 只会换来请求时 404。
 */
test('the 2026-11-10 endpoints keep their probed base URLs and empty baselines', () => {
  const ppio = getAggregateEntry('ppio')!
  assert.equal(ppio.baseUrl, 'https://api.ppio.com/openai')
  assert.equal(ppio.modelsUrl, 'https://api.ppio.com/openai/models')
  assert.ok(ppio.models.length > 0, 'PPIO has a live /models list, so its baseline must not be empty')
  assert.ok(ppio.models.some(model => model.id === 'deepseek/deepseek-v4-pro'))

  for (const [id, baseUrl, modelsUrl] of [
    ['huawei_maas', 'https://api.modelarts-maas.com/v1', 'https://api.modelarts-maas.com/v1/models'],
    ['infini_ai', 'https://cloud.infini-ai.com/maas/v1', 'https://cloud.infini-ai.com/maas/v1/models'],
  ]) {
    const entry = getAggregateEntry(id)!
    assert.equal(entry.baseUrl, baseUrl, `${id} base URL`)
    assert.equal(entry.modelsUrl, modelsUrl, `${id} discovery endpoint`)
    assert.equal(entry.models.length, 0, `${id} must not ship invented model ids`)
    assert.equal(entry.authKind, 'apiKey')
    assert.ok(entry.authUrl, `${id} must say where to get its key`)
  }
})

/**
 * 2026-11-12 收录的 Nous Portal：**只有 Key 能通**，且基线故意为空。
 *
 * 免 Key 档在本应用不可达（匿名铸造的两个端点均 403，需要上游部署密钥），
 * 而 `inference-api.nousresearch.com/v1/models` 是 OpenRouter 代理清单——
 * 照它取一个 id 发 chat 得到 400 "Unknown model"。把那批 slug 转录进来，
 * 等于给每个请求准备一个 404。
 */
test('Nous Portal stays key-only with an empty baseline', () => {
  const nous = getAggregateEntry('nous_portal')!
  assert.equal(nous.authKind, 'apiKey')
  assert.equal(nous.category, 'apikey')
  assert.equal(nous.baseUrl, 'https://inference-api.nousresearch.com/v1')
  assert.equal(nous.modelsUrl, 'https://inference-api.nousresearch.com/v1/models')
  assert.equal(nous.models.length, 0, 'must not transcribe the proxied OpenRouter list')
  assert.ok(nous.authUrl, 'a key-only entry must say where to get its key')
  assert.notEqual(nous.autoProvision, true, 'key-only entries are never auto-provisioned')
})
