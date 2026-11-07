/**
 * 非上游模型目录必须在界面上显式提醒（2026-11-08 用户要求）。
 *
 * 背景：TRAE 官方已换模型接口，网关改读官方客户端缓存；这份清单**能用**，
 * 但不是上游现取。把它画得像正常刷新结果，用户就会按滞后的目录做选择。
 * 本用例锁死「页面渲染入口 + 两个语言包的文案」都在位。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

test('渠道页对 official-cache / static-fallback 渲染来源提醒', () => {
  const page = read('src/renderer/src/pages/Channels.tsx')
  assert.match(page, /modelSourceNoticeKey/, '缺少来源 → 文案键的映射')
  assert.match(page, /modelSourceBadgeKey/, '缺少卡片来源徽标')
  assert.match(page, /channels\.models\.source\.noticeCache/)
  assert.match(page, /channels\.models\.source\.noticeFallback/)
  assert.match(page, /channels\.models\.source\.badgeCache/)
  assert.match(page, /channels\.models\.source\.badgeFallback/)
  // 刷新成功的提示必须把来源一起说出来，不能只报数量。
  assert.match(page, /result\.source/)
})

test('两个语言包都带来源提醒的完整文案', () => {
  for (const locale of ['zh-CN', 'en-US']) {
    const json = JSON.parse(read(`src/renderer/src/i18n/locales/${locale}.json`)) as {
      channels?: { models?: { source?: Record<string, string> } }
    }
    const source = json.channels?.models?.source
    assert.ok(source, `${locale} 缺少 channels.models.source`)
    for (const key of ['badgeCache', 'badgeFallback', 'noticeCache', 'noticeFallback', 'toastCache', 'toastFallback']) {
      assert.equal(typeof source[key], 'string', `${locale} 缺少 channels.models.source.${key}`)
      assert.ok(source[key].trim().length > 0)
    }
  }
})
