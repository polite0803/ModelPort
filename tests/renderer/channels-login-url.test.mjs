/**
 * 渠道登录页打开链路的回归测试。
 *
 * 2026-11-11 实测缺陷：CodeArts / Comate 添加账号时界面停在“等待浏览器登录”，
 * 浏览器始终不打开。根因是无人值守 daemon 的 `openExternal` 只把 URL 打到日志，
 * 而渲染层拿到 `account.create` 返回的 `loginUrl` 后从未使用它。
 *
 * 现在的契约：
 * - 桌面/外壳：`app.openExternal(loginUrl)` 交给系统浏览器；
 * - headless `/ui/`（浏览器标签页）：`window.open(loginUrl, '_blank')`；
 * - 弹窗被拦截时，登录对话框必须渲染可点击的登录地址作为兜底。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PAGE = join(process.cwd(), 'src', 'renderer', 'src', 'pages', 'Channels.tsx')

test('account.create 返回的 loginUrl 由界面打开（桌面 openExternal / 浏览器新标签）', () => {
  const source = readFileSync(PAGE, 'utf8')
  assert.match(source, /loginUrl\?: string/, 'LoginState 必须保留 loginUrl')
  assert.match(source, /value\.loginUrl/, 'startLogin 必须读取 account.create 返回的 loginUrl')
  assert.match(source, /window\.open\(loginUrl, '_blank'/, '浏览器版必须自己开新标签')
  assert.match(source, /openExternal\?\.\(loginUrl\)/, '桌面/外壳必须走系统浏览器')
  assert.match(source, /login\.loginUrl/, '登录对话框必须能取到 URL')
})

test('登录对话框提供手动打开链接，且双语文案齐备', () => {
  const source = readFileSync(PAGE, 'utf8')
  assert.match(source, /href=\{login\.loginUrl\}/, '必须有可点击的登录地址兜底')
  for (const locale of ['zh-CN', 'en-US']) {
    const json = JSON.parse(
      readFileSync(join(process.cwd(), 'src', 'renderer', 'src', 'i18n', 'locales', `${locale}.json`), 'utf8'),
    )
    const hint = json.channels?.login?.manualHint
    assert.equal(typeof hint, 'string', `${locale} 缺少 channels.login.manualHint`)
    assert.ok(hint.length > 0)
  }
})
