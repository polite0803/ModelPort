/**
 * 预热失败的止血接线门：错误必须留痕、成功才刷新冷却、失败不能无脑重试。
 * 2026-11-20 现网 67 次预热有 47 次 400；错误体未取到之前不猜根因，
 * 但「花了钱却没有日志」与「失败后继续买前缀」都不能回退。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const chatRoute = readFileSync('src/main/proxy/routes/chat.ts', 'utf-8')

test('预热非 2xx 写带 status 的 warn 日志，异常路径也记一行摘要', () => {
  assert.match(chatRoute, /addLog\('warn', '压缩后预热新前缀被上游拒绝'/)
  assert.match(chatRoute, /status: warmResult\.status/)
  assert.match(chatRoute, /errorCode: warmErrorSummaryOf\(warmResult\.errorDetails\?\.code\)/)
  assert.match(chatRoute, /error: warmErrorSummaryOf\(warmResult\.error\)/)
  assert.match(chatRoute, /addLog\('warn', '压缩后预热新前缀失败'/)
})

test('只有预热成功才刷新 lastWarmAt 并清零失败计数', () => {
  assert.doesNotMatch(chatRoute, /if \(!decision\.warm\) return\n\s*lastWarmAt = Date\.now\(\)/)
  const successBlock = chatRoute.match(/if \(warmResult\.success\) \{([\s\S]*?)\n\s*return\n\s*\}/)
  assert.ok(successBlock, '成功分支应存在')
  assert.match(successBlock[1], /lastWarmAt = Date\.now\(\)/)
  assert.match(successBlock[1], /warmFailures = 0/)
  assert.match(successBlock[1], /addLog\('info', '压缩后已预热新前缀'/)
})

test('失败冷却判定在发请求之前', () => {
  const pauseAt = chatRoute.indexOf('shouldPauseWarmAfterFailures(')
  const sendAt = chatRoute.indexOf('forwardChatCompletion(body as never')
  assert.ok(pauseAt > 0 && sendAt > pauseAt, '失败冷却必须挡在真正发请求之前')
})
