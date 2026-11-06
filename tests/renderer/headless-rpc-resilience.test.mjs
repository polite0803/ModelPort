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

function checkHeadless(source) {
  const problems = []
  if (!/const inFlightRpc = new Map/.test(source)) {
    problems.push('identical in-flight RPCs are not coalesced')
  }
  if (!/const existing = inFlightRpc\.get\(key\)/.test(source) || !/if \(existing\) return existing/.test(source)) {
    problems.push('invoke does not return the in-flight promise for the same channel+args')
  }
  if (!/response\.status === 429 && !retried/.test(source)) {
    problems.push('429 is thrown instead of retried once')
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
    checkHeadless(headless.replace('response.status === 429 && !retried', 'false')).join('\n'),
    /429 is thrown/,
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
