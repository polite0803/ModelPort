/**
 * 声明额度模板库（`shared/declaredQuota.ts::normalizeDeclaredQuotaTemplates`）。
 *
 * 两条会**静默**坏掉的事：
 * 1. 归一器不再复用 `normalizeDeclaredQuota`（各写一份白名单 → 同一份存档两条口径）；
 * 2. 产品里开始出现套餐档位数字（`6000 / 45000 / 90000` 这类）。用户的裁定是
 *    「不硬编码、给 UI 设定空间」，所以后者是一条**反向断言**：源码里不许把任意
 *    套餐数字当模板初值。这条门必须自己会红 —— 用同一条判据喂一份含数字的样本，
 *    断言它能被查出来，否则「扫了但扫不到」与「没扫」看起来一样。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import {
  DECLARED_QUOTA_MAX_TEMPLATES,
  DECLARED_QUOTA_MAX_TEMPLATE_NAME,
  normalizeDeclaredQuotaTemplates,
} from '../../src/shared/declaredQuota.ts'

const root = process.cwd()

test('templates normalize through the one declared-quota normalizer', () => {
  const result = normalizeDeclaredQuotaTemplates([
    { name: '  百炼 Pro  ', limits: [
      { window: 'fiveHour', unit: 'requests', limit: 6000 },
      { window: 'week', unit: 'requests', limit: 45000 },
    ] },
  ])
  assert.equal(result.length, 1)
  assert.equal(result[0].name, '百炼 Pro', 'name is trimmed')
  // 归一后按窗口/单位白名单排序（与账号声明同一套顺序）
  assert.deepEqual(result[0].limits.map(limit => limit.window), ['fiveHour', 'week'])
})

test('illegal rows are dropped, not coerced', () => {
  const result = normalizeDeclaredQuotaTemplates([
    { name: '', limits: [{ window: 'day', unit: 'requests', limit: 5 }] },        // 空名字
    { name: 'x', limits: [] },                                                    // 空模板
    { name: 'y', limits: [{ window: 'fortnight', unit: 'requests', limit: 5 }] }, // 非法窗口
    { name: 'z', limits: [{ window: 'day', unit: 'requests', limit: -3 }] },      // 负上限
    null,
    'nope',
  ])
  assert.deepEqual(result, [], 'nothing survives, and nothing is invented to fill the gap')
})

test('duplicate names keep only the first entry', () => {
  const result = normalizeDeclaredQuotaTemplates([
    { name: 'dup', limits: [{ window: 'day', unit: 'requests', limit: 10 }] },
    { name: 'dup', limits: [{ window: 'day', unit: 'requests', limit: 99 }] },
  ])
  assert.equal(result.length, 1)
  assert.equal(result[0].limits[0].limit, 10, 'the first one wins; the two are not merged')
})

test('ids are unique and name is capped', () => {
  const longName = 'n'.repeat(DECLARED_QUOTA_MAX_TEMPLATE_NAME + 20)
  const result = normalizeDeclaredQuotaTemplates([
    { name: longName, limits: [{ window: 'day', unit: 'requests', limit: 1 }] },
    { name: 'b', limits: [{ window: 'week', unit: 'requests', limit: 1 }] },
  ])
  assert.equal(result.length, 2)
  assert.ok(result[0].name.length <= DECLARED_QUOTA_MAX_TEMPLATE_NAME)
  assert.notEqual(result[0].id, result[1].id, 'ids must not collide: the dropdown key and delete target depend on it')
})

test('the library is capped, and the cap drops the tail rather than the head', () => {
  const many = Array.from({ length: DECLARED_QUOTA_MAX_TEMPLATES + 5 }, (_, index) => ({
    name: `t${index}`,
    limits: [{ window: 'day', unit: 'requests', limit: index + 1 }],
  }))
  const result = normalizeDeclaredQuotaTemplates(many)
  assert.equal(result.length, DECLARED_QUOTA_MAX_TEMPLATES)
  assert.equal(result[0].name, 't0')
})

/**
 * 反向断言用的判据：一个字符串里是否出现「看起来是套餐档位」的整数。
 *
 * 只认 4 位以上的整数字面量（`6000` 起），且排除注释里引用文档的行 —— 但这里刻意
 * 不排除文档：裁定是「代码里不出权威数字」，注释里的示例数字仍会被人抄进代码。
 */
const PLAN_FIGURE = /(^|[^\d])([1-9]\d{3,})([^\d]|$)/

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

/** 判据本体：给一段源码，返回它把套餐数字当模板初值的证据（描述串或 null）。 */
function findPlanFigureLiteral(source) {
  // 模板初值的样子：`{ name: '…', limits: [{ … limit: 6000 }] }`
  for (const match of source.matchAll(/limits\s*:\s*\[[\s\S]{0,400}?\]/g)) {
    const figure = PLAN_FIGURE.exec(match[0])
    if (figure) return match[0].slice(0, 120)
  }
  return null
}

test('the detector can go red: a sample with a plan figure is caught', () => {
  const sample = "const t = { name: 'Pro', limits: [{ window: 'fiveHour', unit: 'requests', limit: 6000 }] }"
  assert.ok(findPlanFigureLiteral(sample) !== null, 'a hardcoded tier must be detected, or this whole test is inert')
  const clean = "const t = { name: 'Pro', limits: [{ window: 'fiveHour', unit: 'requests', limit: 1 }] }"
  assert.equal(findPlanFigureLiteral(clean), null, 'a user-sized sample does not trip it')
})

test('no shipped source seeds a declared-quota template with a plan figure', () => {
  const offenders = []
  for (const file of [...sourceFiles(join(root, 'src/shared')), ...sourceFiles(join(root, 'src/main'))]) {
    const source = readFileSync(file, 'utf8')
    const hit = findPlanFigureLiteral(source)
    if (hit) offenders.push(`${relative(root, file)}: ${hit}`)
  }
  assert.deepEqual(
    offenders,
    [],
    'plan tiers belong to the user, not the codebase (2026-11-20 decision): move them into a user template',
  )
})

test('factory default ships an empty template library', () => {
  const types = readFileSync(join(root, 'src/main/store/types.ts'), 'utf8')
  // DEFAULT_CONFIG 里必须是空数组：预置任何一条都会变成"产品自带档位"
  assert.match(types, /declaredQuotaTemplates:\s*\[\s*\]/)
  assert.equal(statSync(join(root, 'src/main/store/types.ts')).isFile(), true)
})
