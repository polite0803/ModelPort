import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeModelRoutes,
  resolvePoolRoute,
  resolveRouteRequest,
  routePoolBreakMessage,
  validateRoutesForWrite,
} from '../../src/main/store/modelRoutes.ts'
import type { ModelRoute } from '../../src/shared/types.ts'

/**
 * 池引用（`basedOnRoute`）的判据层：一个客户端入口名要复用另一条路由的池，
 * 复用的是「怎么选」，不是「它是谁」。这一层钉的就是这条边界。
 */

const base = (name: string, extra: Partial<ModelRoute> = {}): ModelRoute => ({
  name,
  enabled: true,
  strategy: 'round-robin',
  prefer: 'balanced',
  maxAttempts: 3,
  stickyMinutes: 30,
  poolStrategies: [],
  includeModels: [],
  excludeModels: [],
  pinModels: [],
  ...extra,
})

const tableOf = (...routes: ModelRoute[]): Record<string, ModelRoute> =>
  normalizeModelRoutes(Object.fromEntries(routes.map(route => [route.name, route])), {
    fallbackStrategy: 'round-robin',
  })

test('引用只借选择行为，名字仍是本路由', () => {
  const table = tableOf(
    base('stable', {
      poolStrategies: [{ id: 'vision-capable', operator: 'and' }],
      pinModels: [{ providerId: 'p1', displayName: 'Big/Vision' }],
      maxAttempts: 5,
    }),
    base('claude-opus-5', { basedOnRoute: 'stable' }),
  )

  const outcome = resolveRouteRequest(table, ' claude-opus-5 ')
  assert.equal(outcome.kind, 'routable')
  const effective = (outcome as { route: ModelRoute }).route

  assert.equal(effective.name, 'claude-opus-5', '响应头、sticky 键与日志用的名字不许被换成来源')
  assert.deepEqual(effective.poolStrategies, table.stable.poolStrategies, '池策略取自来源那条')
  assert.deepEqual(effective.pinModels, table.stable.pinModels, '钉名同样取自来源')
  assert.equal(effective.maxAttempts, 5, '尝试数也是「怎么选」的一部分')
  assert.equal(effective.basedOnRoute, undefined, '解开之后不带引用，消费方不必二次判断')
})

test('引用断掉分三种原因，每种都点名是哪条引用', () => {
  const missing = tableOf(base('lane', { basedOnRoute: 'gone' }))
  const disabled = tableOf(base('stable', { enabled: false }), base('lane', { basedOnRoute: 'stable' }))
  const nested = tableOf(
    base('mid', { basedOnRoute: 'stable' }),
    base('stable'),
    base('lane', { basedOnRoute: 'mid' }),
  )

  for (const [table, reason] of [
    [missing, 'missing'],
    [disabled, 'disabled'],
    [nested, 'nested'],
  ] as const) {
    const outcome = resolveRouteRequest(table, 'lane')
    assert.equal(outcome.kind, 'broken-reference')
    const broken = outcome as { route: ModelRoute; reason: string }
    assert.equal(broken.reason, reason)
    assert.equal(broken.route.name, 'lane', '报错的仍是用户点名的那条')
    assert.match(routePoolBreakMessage(broken.route, broken.reason as never), /lane/)
  }

  assert.match(routePoolBreakMessage(missing.lane, 'missing'), /'gone'/, '要说清是哪条引用断了')
})

test('本路由自己停用时先报停用，不报引用断掉', () => {
  const table = tableOf(base('stable'), base('lane', { basedOnRoute: 'stable', enabled: false }))
  assert.equal(resolveRouteRequest(table, 'lane').kind, 'disabled')
})

test('写入校验拒绝自引用、未知目标与二级引用；归一丢掉非规范与自引用', () => {
  const persisted = tableOf(base('stable'), base('mid', { basedOnRoute: 'stable' }))
  const occupants = { modelNames: [], aliases: [] }

  const errors = validateRoutesForWrite(
    {
      a: base('a', { basedOnRoute: 'a' }),
      b: base('b', { basedOnRoute: 'nope' }),
      c: base('c', { basedOnRoute: 'mid' }),
      d: base('d', { basedOnRoute: 'Stable' }),
      ok: base('ok', { basedOnRoute: 'stable' }),
    },
    persisted,
    occupants,
  )

  assert.ok(errors.some(message => message.includes("routes.a: 'basedOnRoute' cannot reference itself")))
  assert.ok(errors.some(message => message.includes("references the unknown route 'nope'")))
  assert.ok(errors.some(message => message.includes('one hop only')), '二级引用必须被拒')
  assert.ok(errors.some(message => message.includes("routes.d: 'basedOnRoute' must be an existing canonical route name")))
  assert.ok(!errors.some(message => message.startsWith('routes.ok:')), '合法引用不该报错')

  const normalized = normalizeModelRoutes(
    {
      lane: base('lane', { basedOnRoute: ' Stable ' }),
      self: base('self', { basedOnRoute: 'self' }),
    },
    { fallbackStrategy: 'round-robin' },
  )
  assert.equal(normalized.lane.basedOnRoute, 'stable', '引用值按规范名归一（trim + 小写）')
  assert.equal(normalized.self.basedOnRoute, undefined, '自引用在读取侧就被丢掉，不留递归的口子')
})

test('表里查不到来源时不崩，按 missing 报', () => {
  const resolution = resolvePoolRoute(undefined, base('lane', { basedOnRoute: 'stable' }))
  assert.equal(resolution.ok, false)
  assert.equal((resolution as { reason?: string }).reason, 'missing')
})

test('粘性硬优先只在建键是显式 false 时落盘（缺省即开，非法值不等于关掉）', () => {
  const table = tableOf(
    base('plain'),
    base('off', { stickyHardPin: false }),
    base('on', { stickyHardPin: true }),
    base('junk', { stickyHardPin: 'no' as unknown as boolean }),
  )
  // 缺省即硬钉是**读侧**那一条 `!== false` 判据给的，所以老记录不必迁移：
  // 键根本不存在，与「键存在且为 true」在行为上必须同形。
  assert.equal(Object.hasOwn(table.plain, 'stickyHardPin'), false, '没配就不落键，别让每条路由多写一格')
  assert.notEqual(table.plain.stickyHardPin, false)
  assert.equal(table.off.stickyHardPin, false, '关掉必须真的存下来，否则下次读回又是开')
  assert.equal(Object.hasOwn(table.on, 'stickyHardPin'), false, '显式开与缺省同一形状')
  assert.equal(Object.hasOwn(table.junk, 'stickyHardPin'), false, '非法值不得被当成关掉')
})
