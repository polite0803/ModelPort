/**
 * 探测的模态闸门 + provider 停用闸门。
 *
 * 钉的运行事实（2026-11-04，`~/.modelport/request-logs/request-logs.ndjson`）：当天
 * 100 条错误请求行里 73 条是 `kind:'probe'`，其中
 * - SiliconFlow 32/32 全失败，命中模型是 FLUX / Qwen-Image / fish-speech / CosyVoice /
 *   IndexTTS / Qwen3-Embedding / Qwen3-Reranker / Wan2.2-I2V 这类**不服务对话端点**的条目；
 * - 讯飞星火 8/8 失败，而**当时该 provider 在 store 里 `enabled:false`** ——
 *   规划层只过滤模型的启用态（`filterBatchTargets` 读 `getEffectiveModels`），
 *   从来没人看过 provider 那一格。
 *
 * 这批断言证明的是「拦在发请求之前」：被闸掉的条目既没有上游调用，也没有
 * `kind:'probe'` 的错误行。反向那条同样重要 —— **没有能力声明不等于非 chat**，
 * 缺声明的条目照旧要探（AGENTS.md 里 `undocumented 永不阻断`的同一精神）。
 */
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  NON_CHAT_TASK_TYPES,
  classifyProbeModality,
  decideProbeGate,
} from '../../src/shared/probeDisposition.ts'
import {
  CONTEXT_PROBE_LADDER,
  OUTPUT_PROBE_LADDER,
} from '../../src/shared/modelProbe.ts'
import { bootstrapStore, loadModule } from '../routes/harness.mjs'

// ── 夹具 ────────────────────────────────────────────────────────────────────

const CHAT_MODEL = 'gate-provider/zz-undeclared-chat'
const IMAGE_MODEL = 'gate-provider/zz-image-input-only'
const DISABLED_MODEL = 'gate-disabled/zz-spark-pro'

const PROVIDERS = [
  {
    id: 'gate-provider',
    name: 'Gate Provider',
    type: 'aggregate',
    aggregateId: 'gate-provider',
    authType: 'token',
    apiEndpoint: 'https://gate.invalid/v1',
    chatPath: '/chat/completions',
    headers: {},
    enabled: true,
    createdAt: 1,
    updatedAt: 2,
    supportedModels: [CHAT_MODEL, IMAGE_MODEL],
    modelMappings: {
      [CHAT_MODEL]: 'zz-undeclared-chat',
      [IMAGE_MODEL]: 'zz-image-input-only',
    },
    // 上游同步的能力标注（`declared` 置信度）：只声明了图片输入、没有 text。
    // 这是当前落库的字段里唯一能正向说明「chat 探测报文行使不了它」的形状。
    modelCapabilities: {
      [IMAGE_MODEL]: { modalities: ['image'], vision: 'yes' },
    },
  },
  {
    id: 'gate-disabled',
    name: 'Gate Disabled',
    type: 'aggregate',
    aggregateId: 'gate-disabled',
    authType: 'token',
    apiEndpoint: 'https://gate-disabled.invalid/v1',
    chatPath: '/chat/completions',
    headers: {},
    enabled: false,
    createdAt: 1,
    updatedAt: 2,
    supportedModels: [DISABLED_MODEL],
    modelMappings: { [DISABLED_MODEL]: 'zz-spark-pro' },
  },
]

const ACCOUNTS = [
  {
    id: 'gate-provider-acct',
    providerId: 'gate-provider',
    name: 'gate key',
    credentials: { apiKey: 'sk-gate' },
    status: 'active',
    createdAt: 1,
    updatedAt: 2,
  },
  {
    id: 'gate-disabled-acct',
    providerId: 'gate-disabled',
    name: 'spark key',
    credentials: { apiKey: 'sk-spark' },
    status: 'active',
    createdAt: 1,
    updatedAt: 2,
  },
]

const harness = await bootstrapStore({
  initialData: {
    providers: PROVIDERS,
    accounts: ACCOUNTS,
    config: {
      routes: {
        auto: {
          name: 'auto',
          enabled: true,
          strategy: 'fill-first',
          prefer: 'balanced',
          maxAttempts: 4,
          stickyMinutes: 20,
          poolStrategies: [],
          pinModels: [],
          includeModels: [],
          excludeModels: [],
        },
      },
      loadBalanceStrategy: 'round-robin',
      autoRouting: { enabled: true, maxAttempts: 2, stickyMinutes: 0, prefer: 'balanced', poolStrategies: [] },
    },
  },
})
after(() => harness.dispose())

const runner = await loadModule('main/providers/modelProbeRunner.ts')
const batchRunner = await loadModule('main/providers/modelCatalogBatchRunner.ts')
const probeStore = await loadModule('main/providers/modelProbeStore.ts')
const forwarder = await loadModule('main/proxy/forwarder.ts')

/** 假 forwarder：记录每一次上游调用，一律回一个「能探」的失败（400 无终局语义）。 */
let upstreamCalls: Array<{ model: string; scope: unknown }> = []

beforeEach(() => {
  upstreamCalls = []
  forwarder.requestForwarder.forwardChatCompletion = async (request: any) => {
    upstreamCalls.push({ model: request.model, scope: request.max_tokens })
    return {
      success: false,
      status: 400,
      error: 'temperature: field not supported',
      latency: 3,
    }
  }
})

function probeErrorRows(providerId: string): any[] {
  return harness.storeManager
    .getRequestLogs(500)
    .filter((row: any) => row.kind === 'probe' && row.status === 'error' && row.providerId === providerId)
}

// ── 判据本身 ────────────────────────────────────────────────────────────────

test('正向声明的非 chat 模态被判为不可由探测行使', () => {
  // 图像生成：输入文本、输出只有图片
  assert.equal(
    classifyProbeModality({ outputModalities: ['image'] }),
    'non-chat',
    'FLUX / Qwen-Image 这一类：探测报文拿不到文本补全',
  )
  // TTS / realtime-audio：输出音频
  assert.equal(classifyProbeModality({ outputModalities: ['audio'] }), 'non-chat')
  // 视频
  assert.equal(classifyProbeModality({ outputModalities: ['video'] }), 'non-chat')
  // 任务类型声明（models.dev 的 `type`、LiteLLM 的 `mode`）
  assert.equal(classifyProbeModality({ taskType: 'embedding' }), 'non-chat')
  assert.equal(classifyProbeModality({ taskType: 'Rerank' }), 'non-chat', '大小写不参与判据')
  assert.equal(classifyProbeModality({ taskType: 'realtime-audio' }), 'non-chat')
  assert.equal(classifyProbeModality({ taskType: 'audio_tts' }), 'non-chat')
  // 输入侧：一条纯文本 user 消息无法行使「不接受文本输入」的条目
  assert.equal(classifyProbeModality({ inputModalities: ['image'] }), 'non-chat')
  assert.equal(classifyProbeModality({ inputModalities: ['audio'] }), 'non-chat')
})

test('缺席与文本类声明一律放行：没有声明 ≠ 非 chat', () => {
  // 这一条是「宁可多探一次」的钉子：把缺席判成 non-chat 会让所有没标注的模型永远测不到。
  assert.equal(classifyProbeModality({}), 'probeable', '什么都没声明就是未知')
  assert.equal(classifyProbeModality({ inputModalities: [] }), 'probeable', '空数组不是「只能图像」')
  assert.equal(classifyProbeModality({ outputModalities: [] }), 'probeable')
  assert.equal(classifyProbeModality({ taskType: '' }), 'probeable')
  assert.equal(classifyProbeModality({ taskType: 'chat' }), 'probeable')
  assert.equal(classifyProbeModality({ taskType: 'vision' }), 'probeable')
  assert.equal(classifyProbeModality({ inputModalities: ['text'] }), 'probeable')
  assert.equal(classifyProbeModality({ inputModalities: ['text', 'image', 'video'] }), 'probeable')
  // 输出侧带文本就还是能问出话来，即使同时输出图片
  assert.equal(classifyProbeModality({ outputModalities: ['text', 'image'] }), 'probeable')
})

test('任务类型判据与 models.dev 那份不许分叉', () => {
  const source = readFileSync('src/shared/modelsDev.ts', 'utf-8')
  const declared = source.match(/const NON_CHAT_TYPE = new Set\(\[([^\]]*)\]\)/)
  assert.ok(declared, 'models.dev 那份非 chat 类型集合还得在原地')
  const types = [...(declared as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  assert.ok(types.length > 0)
  for (const type of types) {
    assert.ok(
      NON_CHAT_TASK_TYPES.includes(type),
      `models.dev 把 ${type} 当成非 chat，探测闸门必须同样认它`,
    )
    assert.equal(classifyProbeModality({ taskType: type }), 'non-chat')
  }
})

test('闸门顺序：provider 停用最先说，其次模态，终局最后', () => {
  const terminal = {
    reason: 'model-not-supplied' as const,
    scope: 'model' as const,
    evidence: 'model does not exist',
    asOf: new Date().toISOString(),
  }
  const disabled = decideProbeGate({ providerEnabled: false, modality: 'probeable', terminal })
  assert.ok(!disabled.probe && disabled.reason === 'provider-disabled')
  const modality = decideProbeGate({ providerEnabled: true, modality: 'non-chat', terminal })
  assert.ok(!modality.probe && modality.reason === 'non-chat-modality')
  const lastly = decideProbeGate({ providerEnabled: true, modality: 'probeable', terminal })
  assert.ok(!lastly.probe && lastly.reason === 'terminal-model')
  // provider 那一格缺席（读不到记录）按启用放行：闸门只认识别出来的停用。
  assert.equal(decideProbeGate({ modality: 'probeable' }).probe, true)
})

// ── 真路径：一条上游请求都不发 ──────────────────────────────────────────────

test('声明为非 chat 输入的条目：零上游调用、零探测错误行', async () => {
  const result = await runner.runModelCapabilityProbe({
    providerId: 'gate-provider',
    displayName: IMAGE_MODEL,
    scope: 'context',
    origin: 'batch',
  })

  assert.equal(result.status, 'skipped', '被闸门拦下不是探测失败，是一次没做的事')
  assert.equal(result.requests, 0)
  assert.equal(upstreamCalls.length, 0, '一条上游请求都不许发')
  assert.equal(probeErrorRows('gate-provider').length, 0, '连一行 kind:probe 都不该出现')
  assert.match(result.reason ?? '', /non-chat-modality/, '被拦的原因要写清楚')
})

test('没有任何能力声明的条目照旧被探（缺声明 ≠ 非 chat）', async () => {
  const result = await runner.runModelCapabilityProbe({
    providerId: 'gate-provider',
    displayName: CHAT_MODEL,
    scope: 'context',
    origin: 'batch',
  })

  assert.equal(result.status, 'inconclusive', '这一条真的发出去了，只是上游回了个非终局的 400')
  assert.ok(upstreamCalls.length > 0, '第一档就得真的打上去')
})

test('enabled:false 的 provider 整体不被探测', async () => {
  // 今天 spark 那 8 次的回归：模型在服务列表里、路由也引用它，但整家已经关了。
  assert.equal(
    harness.storeManager.getProviderById('gate-disabled')?.enabled,
    false,
    '夹具得真的是停用状态',
  )

  const result = await runner.runModelCapabilityProbe({
    providerId: 'gate-disabled',
    displayName: DISABLED_MODEL,
    scope: 'context',
    origin: 'batch',
  })

  assert.equal(result.status, 'skipped')
  assert.equal(upstreamCalls.length, 0)
  assert.equal(probeErrorRows('gate-disabled').length, 0)
  assert.match(result.reason ?? '', /provider-disabled/)
})

test('手动探测同样不被停用 provider 放行，但缓存不是它拦的', async () => {
  // origin 缺席 = manual。停用仍然不发请求：那条路径压根没有可服务的账号。
  const result = await runner.runModelCapabilityProbe({
    providerId: 'gate-disabled',
    displayName: DISABLED_MODEL,
    scope: 'context',
  })
  assert.equal(result.status, 'skipped')
  assert.equal(upstreamCalls.length, 0)
})

// ── 规划层 ──────────────────────────────────────────────────────────────────

test('批量预演里被闸掉的条目不占任何上游请求', async () => {
  await probeStore.primeModelProbeCache()
  const estimate = await batchRunner.estimateCatalogBatch()

  assert.ok(estimate.models >= 3, '三个模型都该进队列，闸门是摘探测 scope 不是删行')
  assert.equal(
    estimate.probeModels,
    1,
    '只有那个没声明的条目留下探测计划；停用 provider 与 non-chat 条目都被摘干净',
  )
  // 留下的那一份 = 无推定值时扫全档：上下文 8 档 + 输出 6 档。
  assert.equal(CONTEXT_PROBE_LADDER.length, 8)
  assert.equal(OUTPUT_PROBE_LADDER.length, 6)
  assert.equal(
    estimate.requests,
    CONTEXT_PROBE_LADDER.length + OUTPUT_PROBE_LADDER.length,
    '预演的条数必须只剩那一个条目的量：被闸掉的条目一条都不许算进去',
  )
})
