import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  DISPATCH_WINDOW_MS,
  dispatchKeyOf,
  dispatchLedger,
} from '../../src/main/proxy/dispatchLedger.ts'

const NOW = 1_800_000_000_000

beforeEach(() => {
  dispatchLedger.reset()
})

test('派发账本按 (供应商, 模型) 计数，供应商名相同但模型不同是分开的两笔', () => {
  dispatchLedger.record('qwen', 'qwen3.7-max', NOW)
  dispatchLedger.record('qwen', 'qwen3.7-max', NOW + 1000)
  dispatchLedger.record('qwen', 'qwen3.5-flash', NOW + 2000)

  const { counts, total } = dispatchLedger.snapshot(NOW + 3000)
  assert.equal(counts.get(dispatchKeyOf('qwen', 'qwen3.7-max')), 2)
  assert.equal(counts.get(dispatchKeyOf('qwen', 'qwen3.5-flash')), 1)
  assert.equal(total, 3)
})

test('同一个模型名挂在两家供应商下不互相顶账', () => {
  dispatchLedger.record('provider-a', 'glm-5', NOW)
  dispatchLedger.record('provider-b', 'glm-5', NOW)

  const { counts } = dispatchLedger.snapshot(NOW)
  assert.equal(counts.get(dispatchKeyOf('provider-a', 'glm-5')), 1)
  assert.equal(counts.get(dispatchKeyOf('provider-b', 'glm-5')), 1)
})

test('窗口外的派发掉出账本：历史欠债不跟着一个模型一辈子', () => {
  dispatchLedger.record('qwen', 'old', NOW)
  dispatchLedger.record('qwen', 'recent', NOW + DISPATCH_WINDOW_MS)

  // 读数时刻再往前挪 1 毫秒：窗口按 `[now - WINDOW, now]` 取，恰好压在边上的那笔
  // 仍然算数，测试要的是「已经出窗」而不是「正在出窗」。
  const { counts, total } = dispatchLedger.snapshot(NOW + DISPATCH_WINDOW_MS + 1)
  assert.equal(counts.has(dispatchKeyOf('qwen', 'old')), false)
  assert.equal(counts.get(dispatchKeyOf('qwen', 'recent')), 1)
  assert.equal(total, 1)
})

test('reset 清零（代理重启后不该继续背着上一轮的派发欠债）', () => {
  dispatchLedger.record('qwen', 'qwen3.7-max', NOW)
  dispatchLedger.reset()

  assert.equal(dispatchLedger.snapshot(NOW).total, 0)
})

test('从没派发的模型没有键：份额门槛因此由候选池自己算，而不是账本', () => {
  dispatchLedger.record('qwen', 'served', NOW)

  const { counts } = dispatchLedger.snapshot(NOW)
  assert.equal(counts.get(dispatchKeyOf('qwen', 'never-served')), undefined)
})
