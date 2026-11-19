import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clearVisionRelayCache,
  collectRelayImages,
  relayMarkerText,
  relayReaderChainOf,
  replaceRelayImages,
  routeDecisionNeedsVisionRelay,
} from '../../src/main/proxy/visionRelay.ts'
import { normalizeVisionRelay } from '../../src/shared/visionRelayConfig.ts'
import type { PoolStrategyCandidate } from '../../src/main/proxy/autoRouting.ts'
import type { ChatCompletionRequest } from '../../src/main/proxy/types.ts'

/**
 * 视觉读图两段式（PLAN-vision-relay）的纯逻辑判据。
 *
 * 网络部分（hop 转述）不在这里跑：本文件只验「什么时候介入、介入后请求长什么样、
 * 读图器链怎么排」——这三样错一个，线上表现就是「该转述时没转」「不该动时动了」
 * 或「转述把别的字节改了」。
 */

function decision(overrides: Partial<Parameters<typeof routeDecisionNeedsVisionRelay>[0]> = {}) {
  return {
    profile: { needsVision: true },
    candidates: [],
    missing: [],
    pinBlocked: undefined,
    ...overrides,
  } as Parameters<typeof routeDecisionNeedsVisionRelay>[0]
}

test('路由路径：只有「缺的正是 vision」才介入', () => {
  // 整池缺视觉能力 → 介入
  assert.equal(routeDecisionNeedsVisionRelay(decision({ missing: ['vision'] })), true)
  // 钉住的文本模型收不下图 → 介入
  assert.equal(
    routeDecisionNeedsVisionRelay(decision({
      pinBlocked: { displayName: 'm', scope: 'route', source: 'console', missing: ['vision'] },
    })),
    true,
  )
  // 有候选 = 有能收图的模型（硬过滤保证）→ 零介入
  assert.equal(
    routeDecisionNeedsVisionRelay(decision({ candidates: [{}, {}] as never, missing: [] })),
    false,
  )
  // 请求本身不带图 → 零介入
  assert.equal(routeDecisionNeedsVisionRelay(decision({ profile: { needsVision: false } })), false)
  // 缺的是别的能力（tools）→ 转述救不了 → 零介入
  assert.equal(routeDecisionNeedsVisionRelay(decision({ missing: ['tools'] })), false)
  assert.equal(
    routeDecisionNeedsVisionRelay(decision({
      pinBlocked: { displayName: 'm', scope: 'route', source: 'console', missing: ['tools'] },
    })),
    false,
  )
})

function requestOf(messages: ChatCompletionRequest['messages']): ChatCompletionRequest {
  return { model: 'glm-4.7-flash', messages }
}

test('图片收集：当轮 + 历史 + 工具结果全部收；file/video 部件判不可转述', () => {
  const req = requestOf([
    { role: 'user', content: [
      { type: 'text', text: 'look' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ] },
    { role: 'assistant', content: 'ok' },
    { role: 'tool', content: [
      { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
    ] },
  ])
  const images = collectRelayImages(req)
  assert.ok(images !== null)
  assert.equal(images.length, 2)
  assert.deepEqual(images[0], { messageIndex: 0, partIndex: 1, url: 'data:image/png;base64,AAAA' })
  assert.deepEqual(images[1], { messageIndex: 2, partIndex: 0, url: 'https://example.com/a.png' })

  // 读图器转述不了 file/video：整条 hop 放弃，绝不半转述
  assert.equal(collectRelayImages(requestOf([
    { role: 'user', content: [{ type: 'file', file: { url: 'x' } } as never] },
  ])), null)

  // 没有图片 → 不介入
  assert.equal(collectRelayImages(requestOf([{ role: 'user', content: 'hi' }])), null)
})

test('替换标记自解释且不带行为指令', () => {
  assert.equal(
    relayMarkerText('zai_api/glm-4.6v-flash', 'A red square.'),
    '[Image relayed via zai_api/glm-4.6v-flash: A red square.]',
  )
})

test('替换：图片部件变标记，其余字节原样；signal 保留；不改入参', () => {
  const signal = new AbortController().signal
  const req: ChatCompletionRequest = {
    model: 'glm-4.7-flash',
    requestId: 'req_1',
    messages: [
      { role: 'user', content: [
        { type: 'text', text: 'what color' },
        { type: 'image_url', image_url: { url: 'u1' } },
        { type: 'image_url', image_url: { url: 'u2' } },
      ] },
      { role: 'assistant', content: 'thinking' },
    ],
  }
  Object.defineProperty(req, 'signal', { value: signal, enumerable: false, configurable: true })
  const images = collectRelayImages(req)!
  const next = replaceRelayImages(req, images, new Map([
    ['u1', { description: 'red', reader: 'r' }],
    ['u2', { description: 'blue', reader: 'r' }],
  ]))

  // 新对象，入参未被修改
  assert.notEqual(next, req)
  assert.equal((req.messages[0]!.content as unknown[]).length, 3)
  assert.equal((req.messages[0]!.content as { type: string }[])[1]!.type, 'image_url')

  const parts = next.messages[0]!.content as { type: string; text?: string }[]
  assert.deepEqual(parts[0], { type: 'text', text: 'what color' })
  assert.deepEqual(parts[1], { type: 'text', text: relayMarkerText('r', 'red') })
  assert.deepEqual(parts[2], { type: 'text', text: relayMarkerText('r', 'blue') })
  // 无图的消息原样（同一引用）
  assert.equal(next.messages[1], req.messages[1])
  // requestId 与不可枚举 signal 都要跟上
  assert.equal(next.requestId, 'req_1')
  assert.equal(next.signal, signal)
  assert.equal(Object.keys(next).includes('signal'), false)
})

function candidate(overrides: Partial<PoolStrategyCandidate>): PoolStrategyCandidate {
  return {
    providerId: 'p',
    providerName: 'P',
    displayName: 'm',
    actualModelId: 'm',
    accountId: 'a1',
    providerType: 'aggregate',
    costBucket: 'free',
    thirdPartyHint: { vision: 'yes' },
    ...overrides,
  } as PoolStrategyCandidate
}

test('读图器链：免费 + vision 才算；套餐内剔除；同模型去重；官方优先、元路由最后', () => {
  const official = candidate({ providerId: 'zai_api', displayName: 'zai_api/glm-4.6v-flash', actualModelId: 'glm-4.6v-flash' })
  const catalogue = candidate({ providerId: 'zenmux', displayName: 'zenmux/deepseek/deepseek-v4-flash-free', actualModelId: 'deepseek/deepseek-v4-flash-free' })
  const meta = candidate({ providerId: 'open_router', displayName: 'open_router/openrouter/free', actualModelId: 'openrouter/free' })
  const included = candidate({ providerId: 'glm-cn', displayName: 'glm-cn/glm-4.6v', actualModelId: 'glm-4.6v', costClass: 'included' })
  const paid = candidate({ providerId: 'zai_api', displayName: 'zai_api/glm-4.6v', actualModelId: 'glm-4.6v', costBucket: 'above-base', costClass: 'priced' })
  const noVision = candidate({ providerId: 'zai_api', displayName: 'zai_api/glm-4.7-flash', actualModelId: 'glm-4.7-flash', thirdPartyHint: { modalities: ['text'] } })
  const secondAccountSameModel = candidate({ providerId: 'zai_api', displayName: 'zai_api/glm-4.6v-flash', actualModelId: 'glm-4.6v-flash', accountId: 'a2' })

  const chain = relayReaderChainOf([meta, included, paid, noVision, catalogue, secondAccountSameModel, official])
  // 两条都是官方免费证据（同 rank），稳定排序保持池序；元路由恒在最后
  assert.deepEqual(chain.map(reader => reader.displayName), [
    'zenmux/deepseek/deepseek-v4-flash-free',
    'zai_api/glm-4.6v-flash',
    'open_router/openrouter/free',
  ])
  // 同模型只留一个账号
  assert.equal(chain.filter(reader => reader.displayName === 'zai_api/glm-4.6v-flash').length, 1)
  // 套餐内 / 付费 / 非视觉都不得进链
  assert.equal(chain.some(reader => reader.displayName === 'glm-cn/glm-4.6v'), false)
  assert.equal(chain.some(reader => reader.displayName === 'zai_api/glm-4.6v'), false)
  assert.equal(chain.some(reader => reader.displayName === 'zai_api/glm-4.7-flash'), false)
})

test('显式读图器：点名优先、必须是 vision=yes、失败不换家', () => {
  const official = candidate({ providerId: 'zai_api', displayName: 'zai_api/glm-4.6v-flash', actualModelId: 'glm-4.6v-flash' })
  const paid = candidate({ providerId: 'zai_api', displayName: 'zai_api/glm-4.6v', actualModelId: 'glm-4.6v', costBucket: 'above-base', costClass: 'priced' })
  // 显式点名付费视觉模型：用户自己的选择，允许
  assert.deepEqual(
    relayReaderChainOf([official, paid], 'zai_api/glm-4.6v').map(reader => reader.displayName),
    ['zai_api/glm-4.6v'],
  )
  // 点名不存在/非视觉 → 空链（不静默换家）
  assert.deepEqual(relayReaderChainOf([official, paid], 'zai_api/glm-4.7-flash'), [])
})

test('配置归一：坏值回落默认，真值只能是布尔 true', () => {
  assert.equal(normalizeVisionRelay(undefined), undefined)
  assert.deepEqual(normalizeVisionRelay({}), { enabled: false, maxImageBytes: 8 * 1024 * 1024 })
  assert.deepEqual(normalizeVisionRelay({ enabled: 'yes' }), { enabled: false, maxImageBytes: 8 * 1024 * 1024 })
  assert.deepEqual(
    normalizeVisionRelay({ enabled: true, reader: '  zai_api/glm-4.6v-flash  ', maxImageBytes: -1 }),
    { enabled: true, reader: 'zai_api/glm-4.6v-flash', maxImageBytes: 8 * 1024 * 1024 },
  )
  clearVisionRelayCache()
})