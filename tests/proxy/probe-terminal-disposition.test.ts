/**
 * 确定性失败的终局结论（带 TTL）与它同 `inconclusive` 的区分。
 *
 * 钉的运行事实（2026-11-04 同一份日志）：SiliconFlow 的
 * `Model does not exist. Please check it carefully.`（errorCode 20012）、ModelScope 的
 * 403 邮箱未验证、讯飞星火的 500 `AppIdNoAuthError`/11200、阿里云百炼的
 * 400「The product is not activated」—— 每一家都是 100% 全失败、每轮重探。
 * 而 BazaarLink 的 429 `free_daily_limit` 是**真·额度限制**：它每天自然重置，
 * 终局化就等于永久静音，所以它必须留在 `inconclusive` 那一侧。
 *
 * 这批断言同时钉住 AGENTS.md 的方向性闸门：终局只回答「现在能不能服务」，
 * 一格窗口数字都不产生 —— 过期行、`inconclusive`、终局三种都不进解析链。
 */
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  classifyProbeTerminal,
  probeTerminalFresh,
  PROBE_TERMINAL_TTL_MS,
  decideProbeGate,
} from '../../src/shared/probeDisposition.ts'
import {
  indexProbeRows,
  probeRowKey,
  probeRowToLayer,
  probeTerminalOf,
  sanitizeProbeSidecar,
  type ModelProbeRow,
} from '../../src/shared/modelProbe.ts'
import { bootstrapStore, loadModule } from '../routes/harness.mjs'

const DAY_MS = 24 * 60 * 60 * 1000

// ── 上游原文（逐字取自当天的请求日志）────────────────────────────────────────

const SILICONFLOW_TEXT = 'Model does not exist. Please check it carefully.'
const MODELSCOPE_TEXT =
  'For account security, please complete your profile via email verification. ' +
  'ModelScope Magicubes is only available to verified accounts. ' +
  'Please refer to https://modelscope.cn/my/settings/account'
const SPARK_TEXT =
  '{"code":11200,"message":"AppIdNoAuthError, domain.pro-128k, tokens.total","sid":"spark-x"}'
const BAILIAN_TEXT = 'The product is not activated, please confirm that you have activated products'
const BAZAAR_TEXT = 'free_daily_limit: you have used all free requests for today'

// ── 纯判据 ──────────────────────────────────────────────────────────────────

test('四类确定性回答各归其终局，主语是账号的那两类才升账号级', () => {
  const silicon = classifyProbeTerminal({ status: 400, errorText: SILICONFLOW_TEXT })
  assert.equal(silicon?.reason, 'model-not-supplied')
  assert.equal(silicon?.scope, 'model', '同一家的其它模型还得能探，只有这条目被宣布不提供')

  const modelscope = classifyProbeTerminal({ status: 403, errorText: MODELSCOPE_TEXT })
  assert.equal(modelscope?.reason, 'account-unverified')
  assert.equal(modelscope?.scope, 'account', '上游说的是这个账号本身')

  const spark = classifyProbeTerminal({ status: 500, errorText: SPARK_TEXT })
  assert.equal(spark?.reason, 'app-not-authorized', '500 也可以是确定性的授权缺失')
  assert.equal(spark?.scope, 'model', 'domain.pro-128k 是按域授权的，不许静音整家')

  const bailian = classifyProbeTerminal({ status: 400, errorText: BAILIAN_TEXT })
  assert.equal(bailian?.reason, 'product-not-activated')
  assert.equal(bailian?.scope, 'model', '「那个产品没开通」只说那个产品')

  const balance = classifyProbeTerminal({ status: 402, errorText: 'Insufficient balance' })
  assert.equal(balance?.reason, 'insufficient-balance')
  assert.equal(balance?.scope, 'account')

  // 证据是原话，不是小写化之后的兜底文案
  assert.equal(classifyProbeTerminal({ status: 400, errorText: SILICONFLOW_TEXT })?.evidence, SILICONFLOW_TEXT)
})

test('429 的每日免费额度永不终局：它会自己重置', () => {
  // 这条是区分度的钉子 —— 把 `free_daily_limit` 当终局，明天它就再也探不到了。
  assert.equal(classifyProbeTerminal({ status: 429, errorText: BAZAAR_TEXT }), undefined)
  assert.equal(classifyProbeTerminal({ status: 429, errorText: 'insufficient balance' }), undefined)
  assert.equal(classifyProbeTerminal({ status: 408, errorText: SILICONFLOW_TEXT }), undefined)
  assert.equal(classifyProbeTerminal({ status: 524, errorText: SILICONFLOW_TEXT }), undefined)
  // 时序性的另外两种：压根没发出去 / 上游没回话
  assert.equal(
    classifyProbeTerminal({ status: 400, errorText: SILICONFLOW_TEXT, localAdmissionRejected: true }),
    undefined,
  )
  assert.equal(classifyProbeTerminal({ status: 400, errorText: SILICONFLOW_TEXT, timedOut: true }), undefined)
  assert.equal(classifyProbeTerminal({ errorText: SILICONFLOW_TEXT }), undefined, '没有状态码 = 没有回答')
  // 裸 400/403/500 的话术不在名单上就不是终局：参数写错、鉴权失败都会变。
  assert.equal(classifyProbeTerminal({ status: 400, errorText: 'temperature: field not supported' }), undefined)
  assert.equal(classifyProbeTerminal({ status: 401, errorText: 'Invalid API key' }), undefined)
  assert.equal(classifyProbeTerminal({ status: 500, errorText: 'Internal Server Error' }), undefined)
  // 404 也说「不提供那个模型」，但要原文真的这么写
  assert.equal(classifyProbeTerminal({ status: 404, errorText: SILICONFLOW_TEXT })?.reason, 'model-not-supplied')
  assert.equal(classifyProbeTerminal({ status: 404, errorText: 'route not found' }), undefined)
})

test('终局的 TTL 与探测读数的 TTL 是两把钟', () => {
  const now = 1_800_000_000_000
  assert.ok(probeTerminalFresh(new Date(now - PROBE_TERMINAL_TTL_MS + 60_000).toISOString(), now))
  assert.ok(!probeTerminalFresh(new Date(now - PROBE_TERMINAL_TTL_MS - 60_000).toISOString(), now))
  assert.ok(!probeTerminalFresh('not-a-date', now), '坏时间按过期处理，不给一个永久的不探结论')
  assert.ok(!probeTerminalFresh(new Date(now + 60 * 60_000).toISOString(), now), '时钟倒退不算新鲜')

  const row = decideProbeGate({
    providerEnabled: true,
    terminal: {
      reason: 'model-not-supplied',
      scope: 'model',
      evidence: SILICONFLOW_TEXT,
      asOf: new Date(now - 8 * DAY_MS).toISOString(),
    },
  })
  assert.ok(row.probe, '过期终局不该继续拦探测')
})

test('落盘的终局记录形状不对就当作没有，带终局的行不再吃「无状态也算 measured」', () => {
  assert.equal(sanitizeProbeSidecar({ rows: [{ providerId: 'p', displayName: 'm', actualModelId: 'm', asOf: 'x', terminal: { reason: 'nope' } }] }).rows[0]?.terminal, undefined)
  const rows = sanitizeProbeSidecar({
    rows: [
      {
        providerId: 'p',
        displayName: 'm',
        actualModelId: 'm',
        asOf: new Date().toISOString(),
        contextTokens: 32_768,
        terminal: {
          reason: 'model-not-supplied',
          scope: 'model',
          evidence: SILICONFLOW_TEXT,
          asOf: new Date().toISOString(),
        },
      },
    ],
  }).rows
  assert.equal(rows.length, 1)
  assert.equal(rows[0].terminal?.reason, 'model-not-supplied')
  // `contextStatus` 缺席的老写法 + 新鲜终局 = 数字读不进来。
  assert.equal(rows[0].contextTokens, undefined, '磁盘上的终局行不许夹带窗口数字')
})

// ── 真路径 ──────────────────────────────────────────────────────────────────

const FLUX = 'term-silicon/zz-nomatch-flux-pro'
const SILICON_CHAT = 'term-silicon/zz-nomatch-chat'
const MS_A = 'term-modelscope/zz-nomatch-ea-29b'
const MS_B = 'term-modelscope/zz-nomatch-intern-s1'

const harness = await bootstrapStore({
  initialData: {
    providers: [
      {
        id: 'term-silicon',
        name: 'SiliconFlow',
        type: 'aggregate',
        aggregateId: 'term-silicon',
        authType: 'token',
        apiEndpoint: 'https://api.siliconflow.invalid/v1',
        chatPath: '/chat/completions',
        headers: {},
        enabled: true,
        createdAt: 1,
        updatedAt: 2,
        supportedModels: [FLUX, SILICON_CHAT],
        modelMappings: { [FLUX]: 'zz-nomatch-flux-pro', [SILICON_CHAT]: 'zz-nomatch-chat' },
      },
      {
        id: 'term-modelscope',
        name: 'ModelScope API Inference',
        type: 'aggregate',
        aggregateId: 'term-modelscope',
        authType: 'token',
        apiEndpoint: 'https://api.modelscope.invalid/v1',
        chatPath: '/chat/completions',
        headers: {},
        enabled: true,
        createdAt: 1,
        updatedAt: 2,
        supportedModels: [MS_A, MS_B],
        modelMappings: { [MS_A]: 'zz-nomatch-ea-29b', [MS_B]: 'zz-nomatch-intern-s1' },
      },
    ],
    accounts: [
      {
        id: 'term-silicon-acct',
        providerId: 'term-silicon',
        name: 'sf key',
        credentials: { apiKey: 'sk-sf' },
        status: 'active',
        createdAt: 1,
        updatedAt: 2,
      },
      {
        id: 'term-ms-acct',
        providerId: 'term-modelscope',
        name: 'ms key',
        credentials: { apiKey: 'sk-ms' },
        status: 'active',
        createdAt: 1,
        updatedAt: 2,
      },
    ],
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

let upstreamCalls: string[] = []
let upstreamReply: () => any = () => ({ success: false, status: 400, error: SILICONFLOW_TEXT, latency: 3 })

beforeEach(async () => {
  upstreamCalls = []
  upstreamReply = () => ({ success: false, status: 400, error: SILICONFLOW_TEXT, latency: 3 })
  forwarder.requestForwarder.forwardChatCompletion = async (request: any) => {
    upstreamCalls.push(request.model)
    return upstreamReply()
  }
  // 每条用例都从**空探测缓存**开始：终局是跨用例的状态，不清就会互相盖。
  await probeStore.writeModelProbeRows([])
})

async function rowOf(providerId: string, displayName: string): Promise<ModelProbeRow | undefined> {
  await probeStore.primeModelProbeCache()
  return indexProbeRows(probeStore.getProbeRowsSync()).get(probeRowKey({ providerId, displayName }))
}

const probe = (
  providerId: string,
  displayName: string,
  extra: { scope?: string; origin?: string } = {},
): Promise<any> =>
  runner.runModelCapabilityProbe({
    providerId,
    displayName,
    scope: extra.scope ?? 'context',
    origin: extra.origin ?? 'batch',
  })

test('第一次探测换来终局结论：落进行内，状态仍是 inconclusive', async () => {
  const result = await probe('term-silicon', FLUX)

  assert.equal(upstreamCalls.length, 1, '阶梯第一档就被挡回来，之后不再往上试')
  assert.equal(result.status, 'inconclusive', '终局不是测量结果，读数状态一个都不改')
  assert.equal(result.reason ?? '', 'HTTP 400：Model does not exist. Please check it carefully.')

  const row = await rowOf('term-silicon', FLUX)
  assert.equal(row?.contextStatus, 'inconclusive', 'inconclusive 与终局的区分就靠这两格并存')
  assert.equal(row?.terminal?.reason, 'model-not-supplied')
  assert.equal(row?.terminal?.scope, 'model')
  assert.equal(row?.terminal?.evidence, SILICONFLOW_TEXT, '证据留的是上游原话，不是小写化后的兜底文案')
  assert.equal(row?.contextTokens, undefined, '终局一行都不许带窗口数字')
})

test('TTL 内规划层直接跳过：第二条请求根本不发', async () => {
  await probe('term-silicon', FLUX)
  upstreamCalls = []

  const second = await probe('term-silicon', FLUX)
  assert.equal(second.status, 'skipped')
  assert.equal(upstreamCalls.length, 0, '这一条就是那 32 次的回归钉子')
  assert.match(second.reason ?? '', /terminal-model/)

  const estimate = await batchRunner.estimateCatalogBatch()
  assert.equal(
    estimate.probeModels,
    3,
    '四个条目里只有拿到终局的 FLUX 被摘下计划，其余三个还没有结论',
  )
  // 无推定值时扫全档：上下文 8 + 输出 6 = 14 条/条目。
  assert.equal(estimate.requests, 3 * 14, '被终局摘掉的那一条一条请求都不许算进预演')
})

test('手动重探立即作废终局，并真的重新发请求', async () => {
  await probe('term-silicon', FLUX)
  assert.ok((await rowOf('term-silicon', FLUX))?.terminal !== undefined, '先有一个终局在')

  upstreamCalls = []
  const manual = await probe('term-silicon', FLUX, { origin: 'manual' })
  assert.equal(upstreamCalls.length, 1, '用户点了一下就是重问，缓存不能吞掉它')
  assert.equal(manual.status, 'inconclusive')

  // 这一轮仍然确定地失败 → 结论重新武装，asOf 往前推。
  const row = await rowOf('term-silicon', FLUX)
  assert.equal(row?.terminal?.reason, 'model-not-supplied')
})

test('手动重探换回一次成功回答时，旧终局被推翻', async () => {
  await probe('term-silicon', FLUX)
  const armed = await rowOf('term-silicon', FLUX)
  assert.ok(armed?.terminal !== undefined)

  upstreamCalls = []
  upstreamReply = () => ({ success: false, status: 429, error: BAZAAR_TEXT, latency: 3 })
  await probe('term-silicon', FLUX, { origin: 'manual' })
  assert.equal((await rowOf('term-silicon', FLUX))?.terminal, undefined, '限流既不确立也不推翻，但手动那一次已经把缓存作废')

  upstreamCalls = []
  const again = await probe('term-silicon', FLUX, { origin: 'batch' })
  assert.ok(again.status === 'inconclusive' || again.status === 'deferred')
  assert.ok(upstreamCalls.length > 0, '没有终局了，规划层就该重新问')
})

test('429 free_daily_limit 不进终局缓存：下一轮照探', async () => {
  upstreamReply = () => ({ success: false, status: 429, error: BAZAAR_TEXT, latency: 3 })

  const first = await probe('term-silicon', SILICON_CHAT)
  assert.equal(first.status, 'inconclusive')
  const row = await rowOf('term-silicon', SILICON_CHAT)
  assert.equal(row?.terminal, undefined, '会自然重置的额度不是「这条目不提供」')
  assert.equal(row?.contextStatus, 'inconclusive')

  upstreamCalls = []
  const second = await probe('term-silicon', SILICON_CHAT)
  assert.ok(upstreamCalls.length > 0, '明天还有免费额度，所以今天必须还愿意问一次')
  assert.notEqual(second.status, 'skipped')
})

test('账号级终局把同 provider 的其它条目一起摘下计划，但别家不受影响', async () => {
  upstreamReply = () => ({ success: false, status: 403, error: MODELSCOPE_TEXT, latency: 3 })

  const first = await probe('term-modelscope', MS_A)
  assert.equal(upstreamCalls.length, 1)
  const rowA = await rowOf('term-modelscope', MS_A)
  assert.equal(rowA?.terminal?.scope, 'account')

  upstreamCalls = []
  const second = await probe('term-modelscope', MS_B)
  assert.equal(second.status, 'skipped', '同一个账号的邮箱验证状态与那个模型无关')
  assert.equal(upstreamCalls.length, 0)
  assert.match(second.reason ?? '', /terminal-account/)

  // 别家不吃这条账号级结论：把回包换回「这条目不提供」，term-silicon 照常探。
  upstreamReply = () => ({ success: false, status: 400, error: SILICONFLOW_TEXT, latency: 3 })
  upstreamCalls = []
  const elsewhere = await probe('term-silicon', SILICON_CHAT, { scope: 'output' })
  assert.ok(elsewhere.status !== 'skipped' || upstreamCalls.length > 0)

  // 规划层同样吃到账号级结论：ModelScope 两个模型都不再占预演的请求，
  // 而 term-silicon 的 FLUX 仍在计划里（账号级结论不许跨 provider 外溢）。
  const estimate = await batchRunner.estimateCatalogBatch()
  assert.equal(
    estimate.probeModels,
    1,
    'ModelScope 两个模型被同一条账号级结论摘下；term-silicon 只有刚拿到 model 级终局的那条被摘下',
  )
  assert.equal(estimate.requests, 14)
})

test('终局行折不出任何窗口数字，即使同一行曾经测出过区间', async () => {
  const asOf = new Date(Date.now() - 60_000).toISOString()
  const terminalRow: ModelProbeRow = {
    providerId: 'term-silicon',
    displayName: FLUX,
    actualModelId: 'black-forest-labs/FLUX-1.1-pro',
    asOf,
    contextStatus: 'inconclusive',
    terminal: {
      reason: 'model-not-supplied',
      scope: 'model',
      evidence: SILICONFLOW_TEXT,
      asOf,
    },
  }
  assert.equal(probeRowToLayer(terminalRow), undefined, '一次终局收口的探测不产生任何层')

  const legacy = { ...terminalRow, contextTokens: 32_768, maxOutputTokens: 4_096 }
  const folded = probeRowToLayer(legacy)
  assert.equal(folded?.hint.contextTokens, undefined, '老写法（没有状态）+ 新鲜终局 = 数字折不出来')
  assert.equal(folded?.hint.maxOutputTokens, undefined)

  // 同一行如果显式标过 measured，那次读数是另一回事，不该被终局抹掉。
  const measured = {
    ...terminalRow,
    contextTokens: 32_768,
    contextStatus: 'measured' as const,
  }
  assert.equal(probeRowToLayer(measured)?.hint.contextTokens, 32_768, '终局只说能不能服务，不推翻已有的测量')

  assert.equal(probeTerminalOf(terminalRow)?.reason, 'model-not-supplied')
  assert.equal(probeTerminalOf({ ...terminalRow, terminal: undefined }), undefined)
})

test('清除探测结论的那一步只清终局，不动已有读数', async () => {
  await probe('term-silicon', FLUX)
  const row = await rowOf('term-silicon', FLUX)
  assert.ok(row?.terminal !== undefined)
  const stamped = { ...row!, contextTokens: 8_192, contextStatus: 'measured' as const }
  await probeStore.recordModelProbe(stamped)

  await probeStore.clearModelProbeTerminal('term-silicon', FLUX)
  const cleared = await rowOf('term-silicon', FLUX)
  assert.equal(cleared?.terminal, undefined, '清除之后规划层重新愿意问')
  assert.equal(cleared?.contextTokens, 8_192, '清除的是结论，不是测量')
  assert.equal(probeRowToLayer(cleared!)?.hint.contextTokens, 8_192)
})

test('终局过期后规划层重新发请求', async () => {
  await probe('term-silicon', SILICON_CHAT)
  const row = await rowOf('term-silicon', SILICON_CHAT)
  const stale: ModelProbeRow = {
    ...row!,
    terminal: { ...row!.terminal!, asOf: new Date(Date.now() - 8 * DAY_MS).toISOString() },
  }
  await probeStore.recordModelProbe(stale)

  upstreamCalls = []
  const result = await probe('term-silicon', SILICON_CHAT)
  assert.ok(upstreamCalls.length > 0, '7 天之外必须重新问一次')
  assert.notEqual(result.status, 'skipped')
})

/**
 * 整条「全部补齐」链的收口证明：预演与执行读的是同一道闸门。
 *
 * 上面那几条证的是 `estimateCatalogBatch`（计划层）与单模型入口（执行层各自一段），
 * 这一条把 `startCatalogBatch → processRow` 也拉进来 —— 撤掉 `processRow` 里那一次
 * `applyProbeGate`，只有这条会红。
 */
test('批量任务整条链不碰上游：四个条目都带着新鲜终局', async () => {
  const asOf = new Date().toISOString()
  const terminalOf = (evidence: string, scope: 'model' | 'account') => ({
    reason: 'model-not-supplied' as const,
    scope,
    evidence,
    asOf,
  })
  await probeStore.writeModelProbeRows([
    { providerId: 'term-silicon', displayName: FLUX, actualModelId: 'zz-nomatch-flux-pro', asOf,
      contextStatus: 'inconclusive' as const, terminal: terminalOf(SILICONFLOW_TEXT, 'model') },
    { providerId: 'term-silicon', displayName: SILICON_CHAT, actualModelId: 'zz-nomatch-chat', asOf,
      contextStatus: 'inconclusive' as const, terminal: terminalOf(SILICONFLOW_TEXT, 'model') },
    { providerId: 'term-modelscope', displayName: MS_A, actualModelId: 'zz-nomatch-ea-29b', asOf,
      contextStatus: 'inconclusive' as const, terminal: terminalOf(MODELSCOPE_TEXT, 'account') },
    { providerId: 'term-modelscope', displayName: MS_B, actualModelId: 'zz-nomatch-intern-s1', asOf,
      contextStatus: 'inconclusive' as const },
  ])
  upstreamCalls = []

  const started = await batchRunner.startCatalogBatch({ probe: true })
  assert.equal(started.success, true, started.error)
  const jobId = started.jobId as string

  let snapshot: any = started.snapshot
  for (let attempt = 0; attempt < 200; attempt += 1) {
    snapshot = batchRunner.getCatalogBatchJobs().find((job: any) => job.jobId === jobId) ?? snapshot
    if (snapshot && snapshot.status !== 'running') break
    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  assert.ok(snapshot, '任务记录得查得到')
  assert.equal(snapshot!.status, 'done', `批量任务该干净收尾，实际停在 ${snapshot!.status}/${snapshot!.lastError ?? ''}`)
  assert.equal(upstreamCalls.length, 0, '四个条目全都被终局/账号级结论摘下，一条上游请求都不许发')
  assert.equal(snapshot!.requestsSent, 0)
  assert.equal(snapshot!.failed, 0, '被闸掉不是失败：它们不该再进当天那 73 条错误行')
  assert.equal(snapshot!.processedModels, 4, '四个条目都要被处理过（只是没探测）')
  assert.equal(snapshot!.success, 4, '摘掉探测之后这一行是「做完了」，不是「跳过了」')
})

after(() => {
  batchRunner.shutdownCatalogBatchJobs()
})
