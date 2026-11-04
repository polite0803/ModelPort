/**
 * 探测读数参与选路与对外广告的判据。
 *
 * 这批断言存在的理由：六层解析链落地时，探测 sidecar 只被标注面板与「还要不要探测」
 * 读到，`src/main/proxy/` 整个目录不 import 它 —— 也就是说实测证据完全不参与选号。
 * 下面每一条都在钉「这一层现在真的进了路由」，撤掉接线就会红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  advertisedContextTokens,
  capabilityOfCandidate,
  hardFilterFailure,
  profileRequest,
  resolveCapabilityDetail,
  type CapabilityLayers,
  type RankCandidate,
} from '../../src/main/proxy/autoRouting.ts'
import { indexProbeRows, probeRowKey, probeRowToLayer, type ModelProbeRow } from '../../src/shared/modelProbe.ts'

const autoRouterSource = readFileSync('src/main/proxy/autoRouter.ts', 'utf-8')

const NOW = 1_800_000_000_000
const AS_OF = new Date(NOW - 60_000).toISOString()

/** 估算后约 4 万 token 的请求体（`estimateTokens` 按每个中日韩字符 1 token）。 */
function longRequest() {
  return {
    model: 'auto',
    messages: [{ role: 'user' as const, content: '中'.repeat(40_000) }],
  }
}

function capabilityOf(layers: CapabilityLayers, displayName = 'probe-only-model') {
  // providerId 用目录里不存在的名字：既没有内置静态表也没有供应商兜底，
  // 读数只能来自这里传进去的层。
  return resolveCapabilityDetail('probe-test-provider', displayName, layers)
}

test('探测单独提供窗口时参与上下文硬过滤（没这一层就拦不住）', () => {
  const profile = profileRequest(longRequest() as never)
  assert.ok(profile.estimatedTokens > 32_768, '夹具得真的超过被测窗口')

  const probed = capabilityOf({ probe: { contextTokens: 32_768 } })
  assert.equal(hardFilterFailure(profile, probed), 'context', '实测下界 32K 装不下 40K 请求就该淘汰')

  const unprobed = capabilityOf({})
  assert.equal(hardFilterFailure(profile, unprobed), undefined, '窗口未知不是超限的证据，不该淘汰')
})

test('探测压过家族规则（实测优先于按名字推的类比）', () => {
  const capability = capabilityOf({ probe: { contextTokens: 32_768 } }, 'gpt-oss-120b')
  assert.equal(capability.contextTokens, 32_768, '家族规则给的 131072 不该盖住实测值')
  assert.equal(capability.sources.contextTokens, 'probe')
})

test('标准库采用仍排在探测之前（与解析链同一顺序）', () => {
  const capability = capabilityOf({
    catalog: { contextTokens: 64_000 },
    probe: { contextTokens: 32_768 },
  })
  assert.equal(capability.contextTokens, 64_000)
  assert.equal(capability.sources.contextTokens, 'catalog')
})

test('对外广告接受实测下界，仍拒绝单点声明类来源', () => {
  assert.equal(
    advertisedContextTokens(capabilityOf({ probe: { contextTokens: 32_768 } })),
    32_768,
    '实测下界只会低报不会高报，可以承诺给客户端'
  )
  assert.equal(
    advertisedContextTokens(capabilityOf({ catalog: { contextTokens: 64_000 } })),
    undefined,
    '标准库快照是第三方单点声明，不对外'
  )
  assert.equal(
    advertisedContextTokens(capabilityOf({}, 'gpt-oss-120b')),
    undefined,
    '家族规则不对外'
  )
  assert.equal(
    advertisedContextTokens(capabilityOf({ manual: { contextTokens: 128_000 } })),
    128_000,
    '人工标记是用户对客户端的承诺'
  )
})

test('过期与非实测的行不会变成路由可用的层', () => {
  const base: ModelProbeRow = {
    providerId: 'probe-test-provider',
    displayName: 'probe-only-model',
    actualModelId: 'probe-only-model',
    asOf: AS_OF,
    contextTokens: 32_768,
    contextStatus: 'measured',
  }
  assert.ok(probeRowToLayer(base, NOW)?.hint.contextTokens === 32_768, '新鲜且 measured 的行才成层')

  const stale = { ...base, asOf: new Date(NOW - 400 * 24 * 60 * 60 * 1000).toISOString() }
  assert.equal(probeRowToLayer(stale, NOW), undefined, '过期行不参与，也不给一个陈旧下界')

  const inconclusive = { ...base, contextStatus: 'inconclusive' as const }
  assert.equal(probeRowToLayer(inconclusive, NOW)?.hint.contextTokens, undefined, '无结论不写任何上限')
})

test('探测索引按 (供应商, 模型) 建键，同键后写覆盖前写', () => {
  const first: ModelProbeRow = {
    providerId: 'p',
    displayName: 'm',
    actualModelId: 'm-upstream',
    asOf: AS_OF,
    contextTokens: 8_192,
  }
  const second: ModelProbeRow = { ...first, contextTokens: 65_536 }
  const index = indexProbeRows([first, second])
  assert.equal(index.size, 1)
  assert.equal(index.get(probeRowKey(first))?.contextTokens, 65_536)
})

/**
 * 真消费路径：候选对象上带的 `probeHint` 必须被拆进层并参与合并与广告。
 * 上面那批是从纯函数手喂 `layers`，撤掉 `capabilityLayersOf` 里那一行不会红 ——
 * 这一条就是钉那一行的（撤掉它，两条一起红）。
 */
test('候选上的 probeHint 经 capabilityOfCandidate 进入能力与广告', () => {
  const candidate = {
    providerId: 'probe-test-provider',
    displayName: 'probe-only-model',
    probeHint: { contextTokens: 32_768 },
  } as RankCandidate

  const capability = capabilityOfCandidate(candidate)
  assert.equal(capability.contextTokens, 32_768)
  assert.equal(capability.sources.contextTokens, 'probe')
  assert.equal(advertisedContextTokens(capability), 32_768, '/v1/models 的下界要读得到这一层')
})

/**
 * `autoRouter` 侧的接线（探测表 → 层 → 候选）。这个模块 import 了 storeManager，
 * 单测里起不来，所以按仓里既有做法用源码字面量钉（同 `auto-bandit.test.ts`）。
 * 破坏样本：把 `probeIndex` 换成别的表、或删掉 `probeHint` 那一行，本条即红。
 */
test('autoRouter 每决策读一次探测表并把层挂上候选', () => {
  assert.match(
    autoRouterSource,
    /const probeIndex = indexProbeRows\(getProbeRowsSync\(\)\)/,
    '探测表必须与 marks / adoptions 同一个「每决策一次」口径读入'
  )
  assert.match(
    autoRouterSource,
    /probeRowToLayer\(probeRow, nowMs\)\?\.hint/,
    '行要先过新鲜性与 measured 判据，不能把陈旧读数直接当能力'
  )
  assert.match(
    autoRouterSource,
    /\.\.\.\(hints\.probe === undefined \? \{\} : \{ probeHint: hints\.probe \}\)/,
    '探测层要真的落到候选的 probeHint 上'
  )
  const callSite = autoRouterSource.match(/capabilityHintsFor\([\s\S]*?\)/g) ?? []
  assert.ok(
    callSite.some(site => /probeIndex,/.test(site) && /now/.test(site)),
    '调用点得把这张表和本次决策的时刻一起传进去'
  )
})

/**
 * 出向那一格：响应头只能读**过了来源闸门**的读数。
 *
 * `AutoRouteDecision` 上现在并排两个数 —— `contextWindow`（含推定值，给日志与界面）
 * 与 `advertisedContextWindow`（只留误差朝安全方向的来源，给客户端）。接线写反成前
 * 者，等于把家族规则猜值从新门放出去，正是 11-03 撤掉 64000 猜值要防的那类事，
 * 所以钉字面量而不是只测数值。
 */
test('出向头读的是过闸门的读数，不是日志那个', () => {
  assert.match(
    autoRouterSource,
    /advertisedContextTokens\(servedCapability\)/,
    'decision 上的 advertisedContextWindow 必须由闸门函数算出来'
  )
  const chatSource = readFileSync('src/main/proxy/routes/chat.ts', 'utf-8')
  const completionsSource = readFileSync('src/main/proxy/routes/completions.ts', 'utf-8')
  for (const [name, source] of [
    ['chat.ts', chatSource],
    ['completions.ts', completionsSource],
  ] as const) {
    assert.match(
      source,
      /ctx\.set\('X-ModelPort-Context-Window', String\(autoDecision\??\.advertisedContextWindow\)\)/,
      `${name} 要把这个头绑在 advertisedContextWindow 上`
    )
    assert.doesNotMatch(
      source,
      /X-ModelPort-Context-Window', String\(autoDecision\??\.contextWindow\)/,
      `${name} 不许把未过闸门的 contextWindow 当承诺发给客户端`
    )
  }
})

/** 回环的 anthropic / responses 两道靠前缀复制带走头，这里钉那条规则还在。 */
test('回环两条道自动带走这个头', () => {
  const copier = readFileSync('src/main/proxy/utils/inboundLoopback.ts', 'utf-8')
  assert.match(copier, /startsWith\('x-modelport-'\)/, '复制判据仍按 x-modelport- 前缀')
  for (const file of ['messages.ts', 'responses.ts']) {
    assert.match(
      readFileSync(`src/main/proxy/routes/${file}`, 'utf-8'),
      /copyModelPortHeaders\(ctx, response\)/,
      `${file} 得真的把内层头复制出去`
    )
  }
})
