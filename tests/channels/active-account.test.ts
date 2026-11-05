/**
 * 「当前服务账号」粘性排序的回归测试。
 *
 * 背景：渠道包的选号是「手动顺序里的第一个可用账号」，本身不轮询；但换号时
 * 请求 1 从 A 切到 B，而新来的请求会立刻跟到 B，A 上仍在飞的请求还没结束 ——
 * 于是渠道在一段时间里同时压着两个账号。用户 2026-11-05 的裁定是：单号多路
 * 不算异常（客户端本来支持多会话），真正要消掉的是**同时驱动多个账号**。
 *
 * 规则：当前服务账号只要仍可用就排第一；只有它被排除（刚失败）或不再可用
 * （停用 / 限流）时，粘性才跟着换人。这样一次换号只有一次交接，不会让整个
 * 渠道在 A/B 之间漂。
 *
 * ⚠️ 被测模块 `active-account.ts` 零 import，可直接以 TS 源加载。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const VENDOR_SRC = join(ROOT, 'vendor', 'channel-pack', 'src')

async function loadActiveAccount() {
  return await import(pathToFileURL(join(VENDOR_SRC, 'active-account.ts')).href)
}

const accounts = (...ids: string[]) => ids.map(id => ({ id }))

test('当前服务账号被提到第一位（即使手动顺序把它排在后面）', async () => {
  const { moveActiveFirst } = await loadActiveAccount()
  const ordered = moveActiveFirst(accounts('a', 'b', 'c'), 'c')
  assert.deepEqual(ordered.map(entry => entry.id), ['c', 'a', 'b'])
})

test('已经是第一位 / 没有粘性 / 空列表时原样返回', async () => {
  const { moveActiveFirst } = await loadActiveAccount()
  const input = accounts('a', 'b')
  assert.equal(moveActiveFirst(input, 'a'), input)
  assert.equal(moveActiveFirst(input, undefined), input)
  assert.equal(moveActiveFirst(input, ''), input)
  assert.deepEqual(moveActiveFirst([], 'a'), [])
})

test('粘性账号不在候选里（被排除/停用/限流）时不改顺序', async () => {
  const { moveActiveFirst } = await loadActiveAccount()
  const input = accounts('b', 'c')
  assert.equal(moveActiveFirst(input, 'a'), input)
})

test('不改入参（调用方拿到的候选数组保持原样）', async () => {
  const { moveActiveFirst } = await loadActiveAccount()
  const input = accounts('a', 'b', 'c')
  moveActiveFirst(input, 'c')
  assert.deepEqual(input.map(entry => entry.id), ['a', 'b', 'c'])
})
