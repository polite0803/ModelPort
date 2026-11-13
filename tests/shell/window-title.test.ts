import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * The title bar must say which gateway the console is pointed at: with several entries
 * in the address book, a bare "ModelPort" cannot tell the operator which one answers
 * the next click. The page's own <title> may not overwrite it.
 */
import { gatewayWindowTitle } from '../../src/shell/windowTitlePlan.ts'

test('标题带条目名与主机端口，多网关一眼可辨', () => {
  assert.equal(
    gatewayWindowTitle({ name: '本机网关', url: 'http://127.0.0.1:8080' }),
    'ModelPort — 本机网关 (127.0.0.1:8080)',
  )
  assert.equal(
    gatewayWindowTitle({ name: '235 容器', url: 'https://192.168.0.235:8443/ui/' }),
    'ModelPort — 235 容器 (192.168.0.235:8443)',
  )
})

test('空地址簿退回品牌名；空条目名退回主机', () => {
  assert.equal(gatewayWindowTitle(null), 'ModelPort')
  assert.equal(gatewayWindowTitle({ name: '  ', url: 'http://box:8080' }), 'ModelPort — box:8080 (box:8080)')
})

test('URL 解析不了时仍给出条目名，不产出空标题', () => {
  assert.equal(gatewayWindowTitle({ name: '坏地址', url: 'not a url' }), 'ModelPort — 坏地址 (not a url)')
})

test('main.ts 在加载与页面改标题时都重设标题，页面标题不得覆盖', () => {
  const main = readFileSync('src/shell/main.ts', 'utf8').replace(/\r\n/g, '\n')
  assert.ok(main.includes("window.webContents.on('page-title-updated'"), 'missing page-title-updated fence')
  const fence = main.slice(main.indexOf("window.webContents.on('page-title-updated'"))
  assert.ok(fence.includes('event.preventDefault()'), 'the page title must not replace the gateway title')
  assert.ok(fence.includes('applyWindowTitle()'), 'the fence must re-apply the gateway title')
  const loadActive = main.slice(main.indexOf('async function loadActive'), main.indexOf('async function loadLocalGateway'))
  assert.ok(loadActive.includes('applyWindowTitle()'), 'loadActive must title the window before loading')
})