/**
 * 读数过期展示面的接线门（渲染层文本断言）。
 *
 * 防止两件会静默坏掉的事：
 * 1. TTL 倒计时变成轮询 —— 时钟只更新本地 now，queryCredits 仍是全文件唯一一处手点；
 * 2. 文案把「读数过期」说成「厂商额度作废」，或把渠道快照说成「按小时重置」。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const detail = read('src/renderer/src/components/aggregate/AggregateDetail.tsx')
const channels = read('src/renderer/src/pages/Channels.tsx')
const zh = JSON.parse(read('src/renderer/src/i18n/locales/zh-CN.json'))
const en = JSON.parse(read('src/renderer/src/i18n/locales/en-US.json'))

test('the TTL clock is local and never turns into a credit query', () => {
  assert.match(detail, /const \[now, setNow\] = useState\(\(\) => Date\.now\(\)\)/)
  assert.match(detail, /setInterval\(\(\) => setNow\(Date\.now\(\)\), CREDIT_CLOCK_TICK_MS\)/,
    'a 15s local ticker redraws labels only')
  assert.match(detail, /creditSnapshotLive\(shown, now\)/,
    'freshness must flip with the local clock, not a stale render')
  assert.match(detail, /if \(credit === undefined && probe === null\) return/,
    'no snapshot means no timer at all')
  const calls = detail.match(/queryCredits\(entry\.id\)/g) ?? []
  assert.equal(calls.length, 1, 'exactly one hand-clicked query site, never a poller')
  assert.doesNotMatch(detail, /setInterval[\s\S]{0,200}queryCredits/,
    'the local ticker must never reach the query API')
})

test('TTL expiry is described as the reading expiring, not the vendor credit being void', () => {
  assert.match(detail, /t\('aggregate\.manage\.credit\.orderingCountdown'/, 'fresh rows show the countdown')
  assert.match(detail, /t\('aggregate\.manage\.credit\.orderingOff'/, 'expired rows still use the pinned key')
  assert.match(zh.aggregate.manage.credit.orderingCountdown, /不是额度作废/)
  assert.match(zh.aggregate.manage.credit.orderingOff, /过期/)
  assert.match(zh.aggregate.manage.credit.orderingOff, /分钟/)
  assert.equal(typeof en.aggregate.manage.credit.orderingCountdown, 'string')
  assert.ok(en.aggregate.manage.credit.orderingCountdown.length > 0)
})

test('channel credits state a query-time snapshot, with no invented reset cadence', () => {
  assert.match(channels, /t\('channels\.creditsReadAtNote'\)/, 'the note is rendered in the credits panel')
  assert.match(zh.channels.creditsReadAtNote, /快照/)
  assert.match(zh.channels.creditsReadAtNote, /不是厂商额度的重置或作废时间/)
  assert.equal(typeof en.channels.creditsReadAtNote, 'string')
  assert.ok(en.channels.creditsReadAtNote.length > 0)
  assert.doesNotMatch(zh.channels.creditsLastSuccess, /按小时重置/,
    'the old copy implied a real reset cadence that the data does not carry')
  assert.doesNotMatch(en.channels.creditsLastSuccess, /resets hourly/)
})
