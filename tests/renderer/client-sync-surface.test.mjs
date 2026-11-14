import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * 客户端一键切换的呈现层围栏。
 *
 * 要防的退化很具体：这个页面是**网关发来的远程文档**，它能做的事必须只有「要一份预览」
 * 和「点名几个客户端 id」。一旦页面自己拼路径、自己拿明文 key、或者把「未安装 / 没有
 * 自定义模型 / 应用正在运行」画成同一个灰行，用户就会以为切换成功了，而实际上要么写错了
 * 文件，要么写进去的东西被客户端退出时整份回写覆盖掉。
 *
 * 状态与客户端清单都从 `shared/clientSync.ts` 的联合类型里读出来，不在这里重打一遍：
 * 新增一个成员而忘了给它标签，必须当场红。
 */
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const read = (path) => readFileSync(join(root, path), 'utf8')

const page = read('src/renderer/src/pages/ClientSync.tsx')
const app = read('src/renderer/src/App.tsx')
const sidebar = read('src/renderer/src/components/layout/Sidebar.tsx')
const shared = read('src/shared/clientSync.ts')
const preload = read('src/shell/preload.ts')
const shellMain = read('src/shell/main.ts')

const locales = ['zh-CN', 'en-US'].map(name => ({
  name,
  json: JSON.parse(read(`src/renderer/src/i18n/locales/${name}.json`)),
}))

const slots = text => (text.match(/{{\s*[\w.]+\s*}}/g) ?? []).sort().join(',')

/** Members of a string-literal union, skipping the doc comments between them. */
function unionMembers(name) {
  const head = `export type ${name} =`
  const start = shared.indexOf(head)
  assert.ok(start >= 0, `${name} not found in src/shared/clientSync.ts`)
  const rest = shared.slice(start + head.length)
  const end = rest.search(/\nexport /)
  const body = end === -1 ? rest : rest.slice(0, end)
  return [...body.matchAll(/\|\s*'([a-z-]+)'/g)].map(match => match[1])
}

test('客户端接入是页内一等入口：侧边栏有、路由表注册、按页懒加载', () => {
  assert.match(sidebar, /titleKey: 'nav\.clientSync', href: '\/clients'/,
    '只放在托盘或菜单里不算交付：页内导航要有它')
  assert.match(app, /<Route path="\/clients" element=/)
  assert.match(app, /lazy\(\(\) => import\('@\/pages\/ClientSync'\)/,
    '这一页不该被塞进首屏包')
})

test('两处宿主门各自独立：没有桥就不渲染按钮，旧壳仍保留网关管理', () => {
  assert.match(page, /window as unknown as \{ modelportShell\?: ShellBridge \}/)
  assert.match(page, /const clients = shellBridge\?\.clients/)
  assert.match(page, /if \(!clients\) \{[\s\S]{0,400}?clientSync\.desktopOnly/)
  assert.match(sidebar, /const canSyncClients = typeof shellBridge\?\.clients\?\.preview === 'function'/)
  // 两个能力分别判：有网关管理但没有客户端同步的旧壳，不能因此丢掉网关管理入口。
  assert.match(sidebar, /\{canManageGateways && \(/)
  assert.match(sidebar, /\{canSyncClients && \(/)
})

test('页面只点名 id：不碰文件系统，也不自己拼客户端路径', () => {
  assert.match(page, /await clients\.preview\(\)/)
  assert.match(page, /await clients\.apply\(selected\)/)
  for (const forbidden of ['node:fs', 'writeFileSync', 'readFileSync', 'require(', 'electronAPI']) {
    assert.ok(!page.includes(forbidden), `页面不该出现 ${forbidden}：写盘只有主进程那一处`)
  }
  assert.ok(!/\.codex|\.claude|state\.vscdb|settings\.json|config\.toml/.test(page),
    '路径由主进程重新推导，页面写死路径就等于第二套事实')
  assert.match(preload, /apply: \(clientIds: string\[\]\)/, '过桥的只有 id 数组')
})

test('只有 ready 行可勾选，写盘前必须确认', () => {
  assert.match(page, /next\.rows\.filter\(row => row\.state === 'ready'\)\.map\(row => row\.id\)/)
  assert.match(page, /const writable = row\.state === 'ready'/)
  assert.match(page, /disabled=\{!writable \|\| busy\}/)
  assert.match(page, /onClick=\{\(\) => setConfirming\(true\)\}/, '主按钮先开确认，不直接写')
  assert.match(page, /<Dialog open=\{confirming\}/)
  assert.match(page, /clientSync\.confirmBackup/, '确认框要说明会留备份')
})

test('八种状态各有说法，标签从联合类型枚举、两种语言都写全', () => {
  const states = unionMembers('ClientSyncState')
  assert.equal(states.length, 8, `状态联合解析到 ${states.length} 个成员 —— 形状变了`)
  const ids = unionMembers('ClientId')
  // 条数不写死（移植后是 20 个），改成与主进程标签表现推对账：
  // 加一个 id 少一个标签，页面就会画出空白行，这条必须当场红。
  const planSource = read('src/shell/clientSyncPlan.ts')
  const labelsStart = planSource.indexOf('export const CLIENT_LABELS: Record<ClientId, string> = {')
  assert.ok(labelsStart >= 0, 'CLIENT_LABELS 不见了')
  const labelsBlock = planSource.slice(labelsStart, planSource.indexOf('\n}', labelsStart))
  const labelIds = [...labelsBlock.matchAll(/^ {2}'?([\w-]+)'?:/gm)].map(match => match[1])
  assert.deepEqual([...ids].sort(), [...labelIds].sort(), '客户端联合类型与标签表必须一字不差地对上')

  // 页面用动态键取标签，所以缺键会原样显示成 clientSync.state.xxx。
  assert.match(page, /t\(`clientSync\.state\.\$\{row\.state\}`\)/)
  const toneBlock = page.slice(page.indexOf('const STATE_TONE'), page.indexOf('const DISTRIBUTION_TONE'))
  for (const state of states) {
    const key = state.includes('-') ? `'${state}'` : state
    assert.ok(toneBlock.includes(`${key}:`), `STATE_TONE 缺 ${state}：新状态会渲染成 undefined 样式`)
    for (const { name, json } of locales) {
      const value = json.clientSync?.state?.[state]
      assert.equal(typeof value, 'string', `${name} 缺 clientSync.state.${state}`)
      assert.ok(value.trim().length > 0, `${name} 的 clientSync.state.${state} 是空串`)
    }
  }
  // 各种「不是 ready」的缺席不能合并：各自的原因由主进程给，页面必须渲染出来。
  assert.match(page, /\{row\.reason && <p/)
  for (const state of ['not-installed', 'no-entry', 'app-running', 'blocked', 'error', 'unsupported']) {
    assert.ok(states.includes(state), `${state} 必须仍是独立状态`)
  }
})

test('明文 key 不过桥：页面只见掩码，占位符不进渲染层', () => {
  assert.match(page, /preview\.keyPreview/)
  assert.match(page, /preview\.keyPreview === null/)
  assert.ok(!page.includes('__MODELPORT_CANONICAL_KEY__'), '占位符是主进程写入期的事')
  // 只钉字段名，不钉散文：注释里解释「明文不过桥」是应该的。
  for (const field of ['apiKey', 'secretKey', 'plaintextKey']) {
    assert.ok(!page.includes(field), `页面不该出现明文字段 ${field}`)
  }
  assert.doesNotMatch(page, /preview\.key\b/, '预览上只有 keyPreview，没有 key')
  // 预览类型里也不能有明文槽：加一个字段就等于把密钥交给远程文档。
  const previewBlock = shared.slice(shared.indexOf('export interface ClientSyncPreview'))
  const previewBody = previewBlock.slice(0, previewBlock.indexOf('\n}'))
  assert.ok(!/\bkey\s*:/.test(previewBody), 'ClientSyncPreview 只能有 keyPreview，不能有 key')
  assert.match(shared, /keyPreview: string \| null/)
})

test('上下文窗口缺数就说缺数，不写 0 也不猜', () => {
  assert.match(page, /model\.contextWindow === null/)
  assert.match(page, /clientSync\.contextUnknown/)
  assert.match(shared, /contextWindow: number \| null/)
  for (const { name, json } of locales) {
    assert.ok(!/0K|未知窗口/.test(json.clientSync.contextUnknown), `${name} 的缺数文案不该变成一个数`)
  }
})

test('要用户动手的三件事都渲染：手动步骤、不提供的模型、备份路径', () => {
  assert.match(page, /\{row\.manualStep && \(/)
  assert.match(page, /clientSync\.manualTitle/)
  assert.match(page, /row\.unservedModels\.length > 0/)
  assert.match(page, /row\.unservedModels\.join\(', '\)/)
  assert.match(page, /clientSync\.unservedHint/, '要说清「只报告不改名」，否则用户以为漏改了')
  assert.match(page, /result\.backups\.map\(path =>/)
  assert.match(page, /clientSync\.backupsTitle/)
  // 分发结果四态也各有标签（already/added/failed/no-secret）。
  for (const state of ['already', 'added', 'failed', 'no-secret']) {
    for (const { name, json } of locales) {
      assert.equal(typeof json.clientSync?.distribution?.[state], 'string', `${name} 缺 distribution.${state}`)
    }
  }
})

test('两条通道在 preload 与主进程两侧同名，且都按发送方门控', () => {
  for (const channel of ['shell:clients-preview', 'shell:clients-apply']) {
    assert.ok(preload.includes(`'${channel}'`), `preload 缺 ${channel}`)
    const at = shellMain.indexOf(`ipcMain.handle('${channel}'`)
    assert.ok(at > 0, `主进程缺 ${channel}`)
    assert.match(shellMain.slice(at, at + 400), /clientSyncInputFor\(event\)/, `${channel} 必须走同一个发送方门`)
  }
  const gate = shellMain.slice(shellMain.indexOf('async function clientSyncInputFor'))
  assert.match(gate, /activeGatewayForSender\(event\)/, '不是当前网关的页面拿不到这个能力')
  assert.match(gate, /clientPaths\(app\.getPath\('home'\)/, '路径在这里推导，不从页面收')
  // apply 只收 id，且过滤成已知 id：路径穿越不能从页面发起。
  const applyAt = shellMain.indexOf("ipcMain.handle('shell:clients-apply'")
  assert.match(shellMain.slice(applyAt, applyAt + 500), /Array\.isArray\(clientIds\)/)
  assert.match(shellMain.slice(applyAt, applyAt + 500), /typeof id === 'string'/)
})

test('两种语言写全，插值槽一致，计数不用 count', () => {
  const expected = {
    title: '',
    description: '',
    desktopOnly: '',
    refresh: '',
    apply: '{{n}}',
    loading: '',
    loadFailed: '{{error}}',
    targetGateway: '',
    canonicalKey: '',
    noKey: '',
    modelsTitle: '',
    modelsCount: '{{n}}',
    modelsEmpty: '',
    contextUnknown: '',
    distributionTitle: '',
    noReady: '',
    changesTitle: '',
    added: '',
    unservedTitle: '',
    unservedHint: '',
    manualTitle: '',
    backupsTitle: '',
    applyDone: '',
    applyFailed: '',
    confirmTitle: '',
    confirmDescription: '{{n}},{{origin}}',
    confirmChanges: '{{n}}',
    confirmBackup: '',
    confirmApply: '',
  }
  for (const { name, json } of locales) {
    assert.equal(typeof json.nav.clientSync, 'string', `${name} 缺 nav.clientSync`)
    for (const [key, slot] of Object.entries(expected)) {
      const value = json.clientSync?.[key]
      assert.equal(typeof value, 'string', `${name} 缺 clientSync.${key}`)
      assert.ok(value.trim().length > 0, `${name} 的 clientSync.${key} 是空串`)
      assert.equal(slots(value), slot, `${name} 的 clientSync.${key} 插值槽不对`)
    }
    // i18next 见到 count 会去查 _one/_other，这里没有单复数变体。
    for (const key of ['apply', 'modelsCount', 'confirmChanges', 'confirmDescription']) {
      assert.doesNotMatch(json.clientSync[key], /{{\s*count\s*}}/, `${name} 的 clientSync.${key} 用了 count 槽`)
    }
  }
})