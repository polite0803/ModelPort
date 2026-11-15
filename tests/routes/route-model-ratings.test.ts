/**
 * 星级推荐（`ModelRoute.modelRatings`）的纯函数层契约。
 *
 * 证明的层次：`src/main/store/modelRoutes.ts` 的读取侧归一
 * （`normalizeRouteModelRatings` / `normalizeModelRoutes`）与写入侧校验
 * （`checkRouteModelRatings` / `validateRoutesForWrite`）。不 import electron，
 * 跑的是真代码。菜单投影在 `model-scope-pin-circuit.test.ts`，处理器接线在
 * `tests/ipc/routes-menu-wire.test.ts`，页面控件在 `tests/renderer/routes-console-surface.test.mjs`。
 *
 * 钉住的语义：
 * 1. 星级只认 1–`ROUTE_RATING_MAX_STARS` 的整数：读侧怪值整条丢弃（手坏的盘不 500），
 *    写侧给可读错误（静默丢弃等于「点了 5 星、存下来没有」）；
 * 2. 去重与手工增删引用同口径（providerId+displayName 大小写不敏感，保留首次大小写）；
 * 3. 空列表不落键 —— 盘上每条路由不多出这一格；
 * 4. 「清除评分」= 删条目，盘上不存在 0 星这种半状态。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  checkRouteModelRatings,
  normalizeModelRoutes,
  normalizeRouteModelRatings,
  validateRoutesForWrite,
} from '../../src/main/store/modelRoutes.ts'
import { ROUTE_RATING_MAX_STARS } from '../../src/shared/types.ts'

const REF = { providerId: 'pa', displayName: 'Alpha-Flash' }
const NO_OCCUPANTS = { modelNames: [], aliases: [] }

test('上限常量是 5：界面星数与读写校验共用同一个数', () => {
  assert.equal(ROUTE_RATING_MAX_STARS, 5)
})

// ---------------------------------------------------------------- 读取侧归一

test('合法评分保留；0/6/小数/NaN/字符串/缺星/非对象一律整条丢弃', () => {
  const out = normalizeRouteModelRatings([
    { ...REF, stars: 1 },
    { providerId: 'pb', displayName: 'Beta-Lite', stars: 5 },
    { providerId: 'pc', displayName: 'Gamma-Mini', stars: 0 },
    { providerId: 'pd', displayName: 'Delta', stars: 6 },
    { providerId: 'pe', displayName: 'Epsilon', stars: 2.5 },
    { providerId: 'pf', displayName: 'Zeta', stars: NaN },
    { providerId: 'pg', displayName: 'Eta', stars: '4' },
    { providerId: 'ph', displayName: 'Theta' },
    { providerId: '', displayName: 'Empty', stars: 3 },
    null,
    'garbage',
  ])
  assert.deepEqual(out, [
    { ...REF, stars: 1 },
    { providerId: 'pb', displayName: 'Beta-Lite', stars: 5 },
  ])
})

test('非数组 → 空表；trim 后去重按大小写不敏感，保留首次出现的大小写', () => {
  assert.deepEqual(normalizeRouteModelRatings(undefined), [])
  assert.deepEqual(normalizeRouteModelRatings({}), [])
  assert.deepEqual(normalizeRouteModelRatings('x'), [])
  assert.deepEqual(normalizeRouteModelRatings([
    { providerId: ' PA ', displayName: ' Alpha-Flash ', stars: 3 },
    { providerId: 'pa', displayName: 'alpha-flash', stars: 5 },
  ]), [{ providerId: 'PA', displayName: 'Alpha-Flash', stars: 3 }])
})

test('空/全非法评分不落键；有评分才落键，且不动其它字段', () => {
  const empty = normalizeModelRoutes({ fast: { name: 'fast', modelRatings: [] } })
  assert.equal('modelRatings' in empty.fast, false, '空列表归一成「没配」，盘上不多这一格')

  const invalid = normalizeModelRoutes({ fast: { name: 'fast', modelRatings: [{ ...REF, stars: 9 }] } })
  assert.equal('modelRatings' in invalid.fast, false)

  const rated = normalizeModelRoutes({ fast: { name: 'fast', modelRatings: [{ ...REF, stars: 4 }] } })
  assert.deepEqual(rated.fast.modelRatings, [{ ...REF, stars: 4 }])
  assert.deepEqual(rated.fast.includeModels, [], '评分不碰手动增删')
  assert.deepEqual(rated.fast.excludeModels, [])
  assert.equal(rated.fast.preferredModel, undefined, '评分不是优先模型')
})

// ---------------------------------------------------------------- 写入侧校验

test('写入校验：undefined/空表/合法条目放行；非数组、坏引用、坏星级给可读错误', () => {
  assert.equal(checkRouteModelRatings(undefined), undefined)
  assert.equal(checkRouteModelRatings([]), undefined)
  assert.equal(checkRouteModelRatings([{ ...REF, stars: 5 }]), undefined)

  assert.match(checkRouteModelRatings({})!.message, /must be an array/)
  assert.match(checkRouteModelRatings([{ providerId: '', displayName: 'x', stars: 3 }])!.message,
    /non-empty providerId and displayName/)
  for (const stars of [0, 6, -1, 3.5, NaN, '4', undefined]) {
    assert.match(checkRouteModelRatings([{ ...REF, stars }])!.message, /integer 1-5/,
      `stars=${String(stars)} 必须被写侧拒绝`)
  }
})

test('整表写入校验点名具体路由与字段；合法评分零错误', () => {
  const errors = validateRoutesForWrite(
    { fast: { name: 'fast', modelRatings: [{ ...REF, stars: 7 }] } },
    undefined,
    NO_OCCUPANTS,
  )
  assert.ok(errors.some(line => line.includes('routes.fast') && line.includes('modelRatings')),
    JSON.stringify(errors))

  assert.deepEqual(validateRoutesForWrite(
    { fast: { name: 'fast', modelRatings: [{ ...REF, stars: 2 }] } },
    undefined,
    NO_OCCUPANTS,
  ), [])
})
