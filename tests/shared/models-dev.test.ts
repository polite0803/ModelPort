import { test } from 'node:test'
import assert from 'node:assert/strict'

import { listModelsDevModels, planSyncModelIds, readModelsDevProvider } from '../../src/shared/modelsDev.ts'

/** models.dev 的形状：两层对象键控，和 openai-list 的 `data: []` 不是一类东西。 */
function catalogue(): Record<string, unknown> {
  return {
    deepseek: {
      id: 'deepseek',
      env: ['DEEPSEEK_API_KEY'],
      api: 'https://api.deepseek.com',
      name: 'DeepSeek',
      doc: 'https://api-docs.deepseek.com',
      models: {
        'deepseek-v4-pro': {
          id: 'deepseek-v4-pro',
          name: 'DeepSeek V4 Pro',
          tool_call: true,
          limit: { context: 1048576, output: 1048576 },
        },
        'deepseek-embed': {
          id: 'deepseek-embed',
          name: 'DeepSeek Embed',
          type: 'embedding',
        },
        'deepseek-ocr': {
          id: 'deepseek-ocr',
          name: 'DeepSeek OCR',
          type: 'image',
        },
        'deepseek-unnamed': { id: 'deepseek-unnamed' },
      },
    },
    'no-models': { id: 'no-models', name: 'Broken', env: [], doc: '' },
  }
}

test('reads one provider slice into its models', () => {
  const provider = readModelsDevProvider(catalogue(), 'deepseek')
  assert.ok(provider)
  assert.equal(provider!.name, 'DeepSeek')
  assert.equal(provider!.api, 'https://api.deepseek.com')

  const models = listModelsDevModels(catalogue(), 'deepseek')
  assert.deepEqual(
    models.map(model => model.actualModelId),
    ['deepseek-v4-pro', 'deepseek-unnamed'],
    'embedding / image rows are not chat models and must not be exposed as one'
  )
  assert.equal(models[0].displayName, 'DeepSeek V4 Pro')
  assert.equal(
    models[1].displayName,
    'deepseek-unnamed',
    'a row without a name falls back to its id instead of becoming an empty label'
  )
})

test('a provider outside the catalogue is empty, not an error', () => {
  assert.deepEqual(listModelsDevModels(catalogue(), 'not-in-catalogue'), [])
  assert.equal(readModelsDevProvider(catalogue(), 'not-in-catalogue'), null)
})

test('a catalogue id that models.dev spells differently still finds its slice', () => {
  // Cloudflare 的 OpenAI 兼容面没有 GET /models（405），同步只能靠这层回退；
  // 而 models.dev 的键叫 cloudflare-workers-ai。映射按命名空间实测，不按名字相似猜。
  const payload = {
    'cloudflare-workers-ai': {
      id: 'cloudflare-workers-ai',
      name: 'Cloudflare Workers AI',
      models: { '@cf/meta/llama-3.2-1b-instruct': { id: '@cf/meta/llama-3.2-1b-instruct', name: 'Llama 3.2 1B' } },
    },
  }
  assert.deepEqual(
    listModelsDevModels(payload, 'cloudflare').map(model => model.actualModelId),
    ['@cf/meta/llama-3.2-1b-instruct']
  )
  assert.equal(readModelsDevProvider(payload, 'cloudflare')?.name, 'Cloudflare Workers AI')
})

test('a malformed payload is reported as such, never as "no models"', () => {
  // 与 readModelList 同一条纪律：形状不认识就说形状不认识，
  // 否则上游改版会表现成"这家没有模型"，用户会去换 Key。
  for (const payload of [null, undefined, 'text', 42, []]) {
    assert.equal(readModelsDevProvider(payload, 'deepseek'), null)
  }
  // provider 存在但 models 不是对象：也算形状错误。
  assert.equal(readModelsDevProvider(catalogue(), 'no-models'), null)
})

test('every non-chat model kind is excluded by kind, not by name guessing', () => {
  const payload = {
    mixed: {
      id: 'mixed',
      name: 'Mixed',
      models: {
        chat: { id: 'chat', name: 'Chat' },
        withType: { id: 'withType', name: 'With type', type: 'chat' },
        embed: { id: 'embed', type: 'embedding' },
        rerank: { id: 'rerank', type: 'reranking' },
        transcribe: { id: 'transcribe', type: 'transcription' },
        image: { id: 'image', type: 'image' },
        video: { id: 'video', type: 'video' },
      },
    },
  }

  assert.deepEqual(
    listModelsDevModels(payload, 'mixed').map(model => model.actualModelId),
    ['chat', 'withType']
  )
})

test('upstream wins when it answered, and models.dev is only a fallback', () => {
  // 上游答了 → 用上游，即便 models.dev 里有更多模型：第三方目录漏掉的新模型
  // 不该被它"更全"的清单顶掉，也不该因为它更短而删掉上游报的。
  const upstream = planSyncModelIds({
    upstream: [{ displayName: 'A', actualModelId: 'a' }],
    modelsDev: [{ displayName: 'A', actualModelId: 'a' }, { displayName: 'B', actualModelId: 'b' }],
  })
  assert.equal(upstream.source, 'upstream')
  assert.deepEqual(upstream.ids, ['a'])
})

test('models.dev answers only when the upstream probe failed', () => {
  const fallback = planSyncModelIds({
    upstream: null,
    modelsDev: [{ displayName: 'A', actualModelId: 'a' }, { displayName: 'a', actualModelId: 'a' }],
  })
  assert.equal(fallback.source, 'models.dev')
  assert.deepEqual(fallback.ids, ['a'], 'duplicate ids collapse to one entry')
})

test('an upstream answer that is empty never downgrades to models.dev', () => {
  // 探测成功但零模型 = 上游明确说"没有"，这时偷偷换成 models.dev 的清单
  // 就是在替上游撒谎。降级只服务"读不到"，不服务"读到了但是没有"。
  const empty = planSyncModelIds({ upstream: [], modelsDev: [{ displayName: 'A', actualModelId: 'a' }] })
  assert.equal(empty.source, 'upstream')
  assert.deepEqual(empty.ids, [])
})

test('no answer from either side stays empty and keeps the typed failure', () => {
  const none = planSyncModelIds({ upstream: null, modelsDev: null })
  assert.equal(none.source, 'none')
  assert.deepEqual(none.ids, [])
})

test('both sides are normalized: blanks dropped, order preserved', () => {
  const plan = planSyncModelIds({
    upstream: null,
    modelsDev: [
      { displayName: 'A', actualModelId: ' a ' },
      { displayName: 'B', actualModelId: '' },
      { displayName: 'C', actualModelId: 'c' },
    ],
  })
  assert.deepEqual(plan.ids, ['a', 'c'])
})
