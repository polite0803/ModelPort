/**
 * 渠道额度状态的回归测试。
 *
 * Comate 没有可查询的“剩余积分”数字（`daily_cost` 返回 null），但有真实额度
 * 状态：适配器记录最近一次 Auto-Free 请求的成功/限额结果，面板显示
 * “可用 / 已用尽 / 待确认”，而不是“0/N 个账号有读数”。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PAGE = join(process.cwd(), 'src', 'renderer', 'src', 'pages', 'Channels.tsx')

test('没有数字积分时显示额度状态，而不是 0/N 个账号有读数', () => {
  const source = readFileSync(PAGE, 'utf8')
  assert.match(source, /creditState\.status === 'available'/, '面板必须读额度状态')
  assert.match(source, /creditState\.status === 'limited'/)
  assert.match(source, /creditState\.status === 'unknown'/)
  assert.match(source, /channels\.creditsStatus/, '明细标题必须能显示“额度状态”')
  assert.match(source, /channels\.creditsLastSuccess/)
  assert.match(source, /channels\.creditsNoRecord/)
  // 没有读数时不渲染“0/N”计数。
  assert.match(source, /creditState\.reported === 0/)
  for (const locale of ['zh-CN', 'en-US']) {
    const json = JSON.parse(
      readFileSync(join(process.cwd(), 'src', 'renderer', 'src', 'i18n', 'locales', `${locale}.json`), 'utf8'),
    )
    for (const key of [
      'creditsStatus',
      'creditsAvailable',
      'creditsLimited',
      'creditsUnknown',
      'creditsLastSuccess',
      'creditsLastLimited',
      'creditsNoRecord',
    ]) {
      const text = json.channels?.[key]
      assert.equal(typeof text, 'string', `${locale} 缺少 channels.${key}`)
      assert.ok(text.length > 0)
    }
  }
})
