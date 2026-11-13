import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 远程 UI 的传输层要自己扛住管理面限流与重复轮询。
 *
 * 2026-11-06 WSL 的 8 小时窗口里，71 条 429 全部来自 127.0.0.1：Channels 页一次
 * 刷新十几个 RPC、`channels:changed` 逐请求触发、再加 5s 状态轮询，把管理面
 * 60/分钟的桶打满。服务端限额已抬高，这一层钉住客户端的三个配套动作：
 * 相同调用在途合并、429 用机器可读时长退避一次、两个高频轮询降速。
 *
 * 判据写成吃文本的纯函数，负控在内存里改源文 —— 不落盘。
 */
const readSource = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')

const headless = readSource('src/renderer/src/api/headless.ts')
const channels = readSource('src/renderer/src/pages/Channels.tsx')
const proxyStatus = readSource('src/renderer/src/components/proxy/ProxyStatus.tsx')
const dashboardStore = readSource('src/renderer/src/stores/dashboardStore.ts')
const dashboardPage = readSource('src/renderer/src/pages/Dashboard.tsx')

function checkHeadless(source) {
  const problems = []
  if (!/const inFlightRpc = new Map/.test(source)) {
    problems.push('identical in-flight RPCs are not coalesced')
  }
  if (!/const existing = inFlightRpc\.get\(key\)/.test(source) || !/if \(existing\) return existing/.test(source)) {
    problems.push('invoke does not return the in-flight promise for the same channel+args')
  }
  // 429 仍只自动重试一次；2026-11-09 起先把同一个调用键的窗口释放时间记下来，
  // 让下一轮刷新一起等，而不是各自再撞一次（`gateUntilByKey` / `waitForGate`）。
  if (!/response\.status === 429/.test(source) || !/if \(!retried\) return invokeOnce\(channel, args, key, true\)/.test(source)) {
    problems.push('429 is thrown instead of retried once')
  }
  if (!/gateUntilByKey/.test(source) || !/await waitForGate\(key\)/.test(source)) {
    problems.push('the 429 window is not shared across that call key')
  }
  if (!/retryAfterMs/.test(source) || !/Retry-After/.test(source)) {
    problems.push('the retry delay is not read from the gateway contract')
  }
  return problems
}

function checkPolling(channelsSource, proxySource) {
  const problems = []
  if (!/CHANGED_DEBOUNCE_MS = 1500/.test(channelsSource)) {
    problems.push('channels:changed is not debounced')
  }
  if (!/CREDITS_MIN_INTERVAL_MS = 10_000/.test(channelsSource)) {
    problems.push('per-channel credit fan-out is not throttled')
  }
  if (!/onChanged\(scheduleRefresh\)/.test(channelsSource)) {
    problems.push('the changed subscription does not use the debounced refresh')
  }
  if (!/15_000/.test(proxySource)) {
    problems.push('proxy status still polls faster than 15s')
  }
  return problems
}

test('远程 UI 的 RPC 在途合并与 429 退避都存在', () => {
  assert.deepEqual(checkHeadless(headless), [])
})

test('Channels 去抖/积分节流与 ProxyStatus 15s 轮询都存在', () => {
  assert.deepEqual(checkPolling(channels, proxyStatus), [])
})

test('每个判据在对应的破坏样本上会红', () => {
  assert.match(
    checkHeadless(headless.replace('if (existing) return existing', '')).join('\n'),
    /does not return the in-flight promise/,
  )
  assert.match(
    checkHeadless(headless.replace('if (!retried) return invokeOnce(channel, args, key, true)', '')).join('\n'),
    /429 is thrown/,
  )
  assert.match(
    checkHeadless(headless.replace('await waitForGate(key)', '')).join('\n'),
    /not shared across that call key/,
  )
  assert.match(
    checkPolling(channels.replace('onChanged(scheduleRefresh)', 'onChanged(() => void refresh())'), proxyStatus).join('\n'),
    /does not use the debounced refresh/,
  )
  assert.match(
    checkPolling(channels, proxyStatus.replace('15_000', '5_000')).join('\n'),
    /polls faster than 15s/,
  )
})

/**
 * 连接类失败（网络错误 / 代理与重启窗口的 502/503/504 非 JSON 体）必须与
 * 「某个 channel 的数据错误」分开：2026-11-14 的 235 事故里，系统代理在后端
 * 不可达时回 502 空体，仪表盘把第一个失败 channel 的原文当数据错误展示并把
 * 统计清零，持续一个 60s 轮询周期。判据钉住三层：传输层分类、store 保留旧数据
 * + 5s 重连、页面重连横幅。
 */
function checkConnectionClass(headlessSource, storeSource, pageSource) {
  const problems = []
  if (!/export const GATEWAY_UNREACHABLE = 'gateway_unreachable'/.test(headlessSource)) {
    problems.push('no typed code for connection-class failures')
  }
  if (!/throw unreachableError\(null\)/.test(headlessSource)) {
    problems.push('fetch network errors are not classified as gateway unreachable')
  }
  const classAt = headlessSource.indexOf('unreachableError(response.status)')
  const genericAt = headlessSource.indexOf('empty response (')
  if (classAt < 0 || genericAt < 0 || classAt > genericAt) {
    problems.push('502/503/504 non-JSON bodies must be classified before the generic empty-response throw')
  }
  if (!/code === GATEWAY_UNREACHABLE/.test(storeSource)) {
    problems.push('the dashboard does not branch on the connection code')
  }
  if (!/set\(\{ connectionLost: true, error: null \}\)/.test(storeSource)) {
    problems.push('connection loss must keep the last data and clear the raw error')
  }
  if (!/\} else \{\n        setError\(error instanceof Error/.test(storeSource)) {
    problems.push('the zeroing catch must stay in the non-connection branch')
  }
  if (!/CONNECTION_RETRY_MS = 5000/.test(storeSource) || !/get\(\)\.connectionLost\) void get\(\)\.refreshData\(\)/.test(storeSource)) {
    problems.push('no 5s reconnect while connectionLost')
  }
  if (!/set\(\{ connectionLost: false \}\)/.test(storeSource)) {
    problems.push('a successful refresh does not clear connectionLost')
  }
  if (!/t\('dashboard\.connectionLost'\)/.test(pageSource) || !/t\('dashboard\.connectionLostDesc'\)/.test(pageSource)) {
    problems.push('the page has no reconnect banner')
  }
  return problems
}

test('连接类失败被分类、保留旧数据并 5s 重连，页面有重连横幅', () => {
  assert.deepEqual(checkConnectionClass(headless, dashboardStore, dashboardPage), [])
})

test('连接类判据在破坏样本上会红', () => {
  assert.match(
    checkConnectionClass(headless.replace('throw unreachableError(null)', 'throw new Error("net")'), dashboardStore, dashboardPage).join('\n'),
    /network errors are not classified/,
  )
  assert.match(
    checkConnectionClass(headless.replace('unreachableError(response.status)', 'new Error("x")'), dashboardStore, dashboardPage).join('\n'),
    /classified before the generic empty-response throw/,
  )
  assert.match(
    checkConnectionClass(headless, dashboardStore.replace('connectionLost: true, error: null', 'connectionLost: true'), dashboardPage).join('\n'),
    /keep the last data and clear the raw error/,
  )
  assert.match(
    checkConnectionClass(headless, dashboardStore.replace('CONNECTION_RETRY_MS = 5000', 'CONNECTION_RETRY_MS = 60000'), dashboardPage).join('\n'),
    /no 5s reconnect/,
  )
  assert.match(
    checkConnectionClass(headless, dashboardStore, dashboardPage.replace("t('dashboard.connectionLost')", 'null')).join('\n'),
    /no reconnect banner/,
  )
})

test('重连与不可达词条在两个语言包里都存在', () => {
  for (const locale of ['zh-CN', 'en-US']) {
    const messages = JSON.parse(readSource(`src/renderer/src/i18n/locales/${locale}.json`))
    assert.equal(typeof messages.dashboard?.connectionLost, 'string', `${locale} missing dashboard.connectionLost`)
    assert.equal(typeof messages.dashboard?.connectionLostDesc, 'string', `${locale} missing dashboard.connectionLostDesc`)
    assert.equal(typeof messages.gatewayConnection?.network, 'string', `${locale} missing gatewayConnection.network`)
    assert.match(messages.gatewayConnection?.unreachable ?? '', /\{\{status\}\}/, `${locale} unreachable must interpolate the status`)
  }
})
