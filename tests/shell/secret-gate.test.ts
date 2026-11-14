import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * The secret IPC gate: the preload survives cross-origin navigation inside the shell
 * window, so the per-origin store is only as private as this fence. The accident it
 * prevents is a page from gateway A reading (or forgetting) gateway B's sealed secret -
 * the multi-gateway case the store exists for.
 */
import { secretOriginAllowed } from '../../src/shell/secretGatePlan.ts'

const ACTIVE = 'http://127.0.0.1:8080'
const SIBLING = 'https://box:8443'

function input(overrides: Partial<Parameters<typeof secretOriginAllowed>[0]> = {}) {
  return {
    senderUrl: `${ACTIVE}/ui/`,
    requested: ACTIVE,
    activeOrigin: ACTIVE,
    devRendererUrl: null,
    ...overrides,
  }
}

test('活动网关自己的页面可以读自己的 origin', () => {
  assert.equal(secretOriginAllowed(input()), true)
})

test('同一页面伸手去拿另一台网关的口令：拒绝', () => {
  assert.equal(secretOriginAllowed(input({ requested: SIBLING })), false)
})

test('请求的 origin 不是活动网关：拒绝，即使发送者就是那个 origin', () => {
  assert.equal(secretOriginAllowed(input({
    senderUrl: `${SIBLING}/ui/`,
    requested: SIBLING,
  })), false)
})

test('窗口导航到别的 origin 后，旧页面身份不再放行', () => {
  assert.equal(secretOriginAllowed(input({ senderUrl: 'https://elsewhere.example/ui/' })), false)
})

test('data: 失败页与空发送者拿不到任何口令', () => {
  assert.equal(secretOriginAllowed(input({ senderUrl: 'data:text/html,x' })), false)
  assert.equal(secretOriginAllowed(input({ senderUrl: '' })), false)
  assert.equal(secretOriginAllowed(input({ senderUrl: 'not a url' })), false)
})

test('地址簿为空时没有活动 origin，谁都不放行', () => {
  assert.equal(secretOriginAllowed(input({ activeOrigin: null })), false)
})

test('开发模式放行 vite 渲染 origin，且只在设置了渲染地址时', () => {
  const dev = 'http://localhost:5173'
  assert.equal(secretOriginAllowed(input({
    senderUrl: `${dev}/`,
    requested: dev,
    activeOrigin: ACTIVE,
    devRendererUrl: dev,
  })), true)
  // 没有渲染地址（发行形态）时，同一个请求必须被拒绝。
  assert.equal(secretOriginAllowed(input({
    senderUrl: `${dev}/`,
    requested: dev,
    activeOrigin: ACTIVE,
    devRendererUrl: null,
  })), false)
})

test('密钥 IPC 都经过门，门拒绝时读取不泄露行存在', () => {
  const main = readFileSync('src/shell/main.ts', 'utf8').replace(/\r\n/g, '\n')
  for (const channel of ['shell:secret-get', 'shell:secret-set', 'shell:secret-forget', 'shell:secret-refresh']) {
    const start = main.indexOf(`ipcMain.handle('${channel}'`)
    assert.ok(start >= 0, `missing handler ${channel}`)
    const body = main.slice(start, main.indexOf('})', start))
    assert.ok(body.includes('secretGateAllows(event, origin)'), `${channel} must gate on the sender`)
    if (channel === 'shell:secret-get' || channel === 'shell:secret-refresh') {
      assert.ok(body.includes("return { status: 'none' }"), 'a rejected read must look like no row')
    }
  }
})