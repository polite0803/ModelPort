/**
 * Anthropic 客户端「可发现名」生成器的判据。
 *
 * 这一层证明的是**取值来源与产物形状**：路由名只能来自数据里本来就存在的 Anthropic id，
 * 每条路由必须自带钉定的候选池（否则「路由名是 claude-opus-5、池却是全目录」= 伪装），
 * 且四类冲突与「名字建不出路由」各自要报出原因而不是静默少一条。
 * 落库那一半在 `tests/store/anthropic-routes.test.ts`（真 store 建完再读回来）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  isDiscoverableForAnthropicClients,
  planAnthropicDiscovery,
} from '../../src/shared/anthropicDiscovery.ts'

const provider = (
  id: string,
  models: Array<{ displayName: string; upstreamId?: string }>,
  hasActiveAccount = true,
) => ({ id, name: id.toUpperCase(), hasActiveAccount, models })

test('带条目前缀的真实 Claude 名生成一条钉定的路由', () => {
  const plan = planAnthropicDiscovery({
    providers: [provider('llm7', [{ displayName: 'llm7/claude-opus-5' }])],
    visibleNames: ['llm7/claude-opus-5'],
    routeNames: ['auto'],
    mappingKeys: [],
  })

  assert.equal(plan.create.length, 1)
  assert.deepEqual(plan.create[0], {
    name: 'claude-opus-5',
    // 池钉在「谁真的服务这个名字」上：不钉就等于广告一个可以拿任意模型应答的名字。
    pinModels: [{ providerId: 'llm7', displayName: 'llm7/claude-opus-5' }],
    providerNames: ['LLM7'],
  })
  assert.deepEqual(plan.skipped, [])
})

test('名字本身就能被发现时不叠路由，非 Claude 模型也不虚报成缺席', () => {
  const plan = planAnthropicDiscovery({
    providers: [
      provider('llm7', [{ displayName: 'claude-sonnet-4-6' }, { displayName: 'zai/glm-5' }]),
    ],
    visibleNames: ['claude-sonnet-4-6', 'zai/glm-5'],
    routeNames: ['auto'],
    mappingKeys: [],
  })

  assert.deepEqual(plan.create, [], '已经是 Anthropic 写法的名不必再生成')
  assert.deepEqual(plan.alreadyVisible, ['claude-sonnet-4-6'])
  // `zai/glm-5` 本来就不是 Claude 模型：它不在客户端清单里是事实，不是一条需要解释的缺席。
  assert.deepEqual(plan.skipped, [])
})

test('上游 id 才是证据时用它做名字，钉的仍是网关展示名', () => {
  const plan = planAnthropicDiscovery({
    providers: [provider('agg1', [{ displayName: 'agg1/opus-flagship', upstreamId: 'claude-opus-4-8-legacy' }])],
    visibleNames: ['agg1/opus-flagship'],
    routeNames: [],
    mappingKeys: [],
  })

  assert.equal(plan.create[0].name, 'claude-opus-4-8-legacy')
  assert.deepEqual(plan.create[0].pinModels, [{ providerId: 'agg1', displayName: 'agg1/opus-flagship' }])
})

test('同一个 Anthropic id 被多家服务时合成一条路由，池里带上全部几家', () => {
  const plan = planAnthropicDiscovery({
    providers: [
      provider('llm7', [{ displayName: 'llm7/claude-opus-5' }]),
      provider('newapi', [{ displayName: 'newapi/claude-opus-5-x', upstreamId: 'claude-opus-5' }]),
    ],
    visibleNames: ['llm7/claude-opus-5', 'newapi/claude-opus-5-x'],
    routeNames: [],
    mappingKeys: [],
  })

  assert.equal(plan.create.length, 1, '跨家是路由该做的事，不该裂成两条同名')
  assert.deepEqual(plan.create[0].pinModels, [
    { providerId: 'llm7', displayName: 'llm7/claude-opus-5' },
    { providerId: 'newapi', displayName: 'newapi/claude-opus-5-x' },
  ])
  assert.deepEqual(plan.create[0].providerNames, ['LLM7', 'NEWAPI'])
})

test('四类冲突各自报原因，不静默少一条', () => {
  const plan = planAnthropicDiscovery({
    providers: [
      provider('off', [{ displayName: 'off/claude-haiku-4-5' }], false),
      provider('taken', [{ displayName: 'taken/claude-fable-1' }]),
      provider('shadow', [{ displayName: 'shadow/claude-mythos-1' }]),
      provider('mapped', [{ displayName: 'mapped/claude-sonnet-5' }]),
    ],
    // `claude-fable-1` 已被同名路由占用；`claude-mythos-1` 是目录里另一个模型的展示名。
    visibleNames: ['taken/claude-fable-1', 'shadow/claude-mythos-1', 'claude-mythos-1'],
    routeNames: ['claude-fable-1'],
    mappingKeys: ['claude-sonnet-5'],
  })

  assert.deepEqual(plan.create, [], '四种情况都不该生成')
  assert.deepEqual(
    plan.skipped.map(entry => `${entry.name}:${entry.reason}`).sort(),
    [
      'claude-fable-1:route-name-taken',
      'claude-haiku-4-5:no-active-account',
      'claude-mythos-1:already-visible',
      'claude-sonnet-5:mapping-exists',
    ],
  )
})

test('含点号的 Anthropic id 建不出路由，点名原因而不是跳过不说', () => {
  const plan = planAnthropicDiscovery({
    providers: [provider('openrouter', [{ displayName: 'openrouter/claude-opus-4.8' }])],
    visibleNames: ['openrouter/claude-opus-4.8'],
    routeNames: [],
    mappingKeys: [],
  })

  assert.deepEqual(plan.create, [], '路由名字符集是 [a-z0-9_-]{1,64}，点号进不去')
  assert.deepEqual(plan.skipped, [{ name: 'claude-opus-4.8', reason: 'name-not-routable' }])
})

test('生成一遍再跑一次是空操作（幂等，重复点不会越建越多）', () => {
  const input = {
    providers: [provider('llm7', [{ displayName: 'llm7/claude-opus-5' }])],
    visibleNames: ['llm7/claude-opus-5'],
    routeNames: ['auto'],
    mappingKeys: [],
  }
  const first = planAnthropicDiscovery(input)
  const second = planAnthropicDiscovery({
    ...input,
    routeNames: [...input.routeNames, ...first.create.map(route => route.name)],
  })

  assert.equal(first.create.length, 1)
  assert.deepEqual(second.create, [])
  assert.deepEqual(second.skipped, [{ name: 'claude-opus-5', reason: 'route-name-taken' }])
})

test('同一个名字从多家报上来时，同一个原因只记一行', () => {
  const plan = planAnthropicDiscovery({
    providers: [
      provider('a1', [{ displayName: 'a1/claude-haiku-9' }], false),
      provider('a2', [{ displayName: 'a2/claude-haiku-9' }], false),
    ],
    visibleNames: ['a1/claude-haiku-9', 'a2/claude-haiku-9'],
    routeNames: [],
    mappingKeys: [],
  })

  assert.deepEqual(plan.skipped, [{ name: 'claude-haiku-9', reason: 'no-active-account' }])
})

test('前缀判定只看发出去的那个 id，大小写不敏感', () => {
  assert.equal(isDiscoverableForAnthropicClients('Claude-Sonnet-4-6'), true)
  assert.equal(isDiscoverableForAnthropicClients('anthropic/claude-haiku-4.5'), true)
  assert.equal(isDiscoverableForAnthropicClients('llm7/claude-opus-5'), false, '带条目前缀就过不了客户端那一筛')
  assert.equal(isDiscoverableForAnthropicClients('  '), false)
})
