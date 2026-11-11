/**
 * 渠道额度归并的口径测试（`summarizeChannelCredits`，2026-11-11 华为云码道）。
 *
 * 面板表头写的是「剩余积分」，而同一渠道里可能既有积分账号又有 token 配额账号
 * （实测 4428.19 与 4,545,965 并存）。原实现把所有账号的 `balance.total` 无脑相加，
 * 得到 4,550,393.19 这个「既不是积分也不是 token」的数 —— 两个计数域差三个数量级，
 * 相加没有任何含义，却顶着「剩余积分」的标签显示，是最容易被误读的一种错。
 *
 * 契约：
 * 1. 积分桶优先作为渠道总额；整渠道只有 token 时改报 token 并带 `remainingUnit`；
 * 2. 两桶都有 → `mixedUnits: true`，界面必须说明「不折算、不相加，分行显示」；
 * 3. 停用账号不进任何桶，但读数仍在明细行里（启停要看得见变化，2026-10-30）；
 * 4. 查询失败的行只带 `error`，不计入 `reported`（「拿不到」≠「为 0」）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeChannelCredits } from '../../src/shared/channels.ts'

const creditRow = {
  accountId: 'codearts-626463a1',
  nickname: 'hw086287662933786',
  balance: { total: 4428.19 },
}
const tokenRow = {
  accountId: 'codearts-8900729b',
  nickname: 'GT-weixin_51024015',
  balance: { total: 4545965, unit: 'token' },
}

test('积分与 token 并存：总额只含积分，另一桶留在明细行并标记混计', () => {
  const summary = summarizeChannelCredits([creditRow, tokenRow])
  assert.equal(summary.reported, 2, '两个账号都真的拿到了读数')
  assert.equal(summary.remaining, 4428.19, '绝不把 4545965 加进积分总额')
  assert.equal(summary.remainingUnit, undefined, '表头仍是「剩余积分」')
  assert.equal(summary.mixedUnits, true, '界面要说明另一桶去哪了')
  assert.deepEqual(
    summary.accounts.map(account => [account.nickname, account.remaining, account.unit]),
    [
      ['hw086287662933786', 4428.19, 'credit'],
      ['GT-weixin_51024015', 4545965, 'token'],
    ],
  )
})

test('整渠道只有 token 账号：总额改报 token 并带单位', () => {
  const summary = summarizeChannelCredits([tokenRow])
  assert.equal(summary.remaining, 4545965)
  assert.equal(summary.remainingUnit, 'token')
  assert.equal(summary.mixedUnits, undefined, '只有一个口径时不需要解释混计')
})

test('停用的 token 账号不进桶，但读数照常列出', () => {
  const summary = summarizeChannelCredits([
    creditRow,
    { ...tokenRow, enabled: false },
  ])
  assert.equal(summary.remaining, 4428.19)
  assert.equal(summary.mixedUnits, undefined, '停用账号没参与总额，不该谎称混计')
  assert.equal(summary.reported, 2, '有读数就是 2/2，与启停无关')
  assert.equal(summary.accounts[1].enabled, false)
  assert.equal(summary.accounts[1].unit, 'token')
})

test('全部停用：不出总额（显示为空），而不是 0', () => {
  const summary = summarizeChannelCredits([
    { ...creditRow, enabled: false },
    { ...tokenRow, enabled: false },
  ])
  assert.equal(summary.remaining, undefined, '0 会被读成「积分用光了」')
  assert.equal(summary.reported, 2)
})

test('查询失败的行不计读数、保留原因；没有数字余额时才落额度状态', () => {
  const summary = summarizeChannelCredits(
    [
      creditRow,
      { accountId: 'codearts-x', nickname: '坏的', balance: null, error: '账户信息查询失败：HTTP 401' },
      { accountId: 'comate-y', nickname: '只有状态', balance: null, status: 'available', lastAt: 1_700_000_000_000 },
    ],
    { status: 'available', note: '按小时重置' },
  )
  assert.equal(summary.reported, 1, '只有真给出数字的账号算读数')
  assert.equal(summary.remaining, 4428.19)
  assert.equal(summary.accounts[1].error, '账户信息查询失败：HTTP 401')
  assert.equal(summary.accounts[1].unit, undefined, '没有读数就不标口径')
  assert.equal(summary.accounts[2].status, 'available')
  assert.equal(summary.accounts[2].lastAt, 1_700_000_000_000)
  assert.equal(summary.status, 'available', '渠道级状态要一路带到界面')
  assert.equal(summary.note, '按小时重置')
})

test('旧 worker 不带 unit 时按积分处理（向后兼容）', () => {
  const summary = summarizeChannelCredits([creditRow, { ...creditRow, accountId: 'other' }])
  assert.equal(summary.remaining, 8856.38, '同口径才允许相加')
  assert.equal(summary.mixedUnits, undefined)
})