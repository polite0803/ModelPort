/**
 * 2026-11-02 Codex 事故的渠道层回归：
 *
 * - WorkBuddy 的 11140 安全策略拦截会以 HTTP 400 出现，旧实现只在 401/403
 *   分支里换号，400 直接原样抛给宿主 —— 登录/同步都正常，但推理永远失败。
 * - OpenCode 的匿名槽按出口 IP 限流；全部槽被限时 `identitySlots()` 为空，
 *   旧实现抛 `MISSING_CREDENTIAL`（宿主再映射成 `channel_relogin_required`），
 *   把「等 30 分钟」误导成「重新登录」。现在必须报 429 限流。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  isChannelCredentialFailure,
  isChannelRiskControlFailure,
} from '../../src/main/proxy/failover.ts'

const buddySource = readFileSync('vendor/channel-pack/src/buddy-adapter.ts', 'utf-8')
const indexSource = readFileSync('vendor/channel-pack/src/index.ts', 'utf-8')

test('WorkBuddy：11140 在 HTTP 400 上也要进入账号轮换，而不是原样抛出', () => {
  assert.match(
    buddySource,
    /const initialContentRejected = initialErrorBody\.length > 0 && isContentRejection\(initialErrorBody\)/,
    '必须为非 2xx 响应读一次正文并识别 11140',
  )
  assert.match(
    buddySource,
    /response\.status === 401 \|\| response\.status === 403 \|\| initialContentRejected/,
    '401/403 之外的 11140 也要进入换号分支',
  )
  assert.match(
    buddySource,
    /isContentRejection\(rotatedBody\)[\s\S]{0,900}continue/,
    '换到的账号再次被 11140 拦截时，必须继续换下一个账号',
  )
  assert.match(
    buddySource,
    /sawContentRejection && !response\.ok[\s\S]{0,500}contentRejectionError/,
    '全部账号都被拦截时要如实报安全策略拦截，而不是退回原始 400',
  )
})

test('OpenCode：全部账号限流时返回 429，而不是登录失效', () => {
  assert.match(
    indexSource,
    /该模型的所有通道当前都在限流中/,
    '限流与「没有账号」必须是两句不同的错误',
  )
  assert.match(
    indexSource,
    /'RATE_LIMIT'[\s\S]{0,200}providerRetryAfterMs: waitMs/,
    '限流错误要带 429 与重置等待时间',
  )
  assert.match(
    indexSource,
    /这不是登录问题，可等待、添加 API key 账号或更换出口代理/,
    '错误文案必须排除「重新登录」这一误导方向',
  )
})

test('余额门控渠道：池里有账号但全不可用时不得回退默认凭据', () => {
  for (const product of [
    'LOBSTERAI', 'QODER', 'QODER_CN', 'TRAE', 'CLINE',
    'LOOMY', 'RACCOON', 'MINIMAX', 'GEMINI', 'ZCODE',
  ]) {
    assert.match(
      indexSource,
      new RegExp(`throwIfPoolExhausted\\(${product}, modelId\\)`),
      `${product} 的默认凭据回退必须先经过共用守卫`,
    )
  }
  assert.match(
    indexSource,
    /已停止回退默认单凭据/,
    '余额门控跳过的账号不能再被默认凭据回退用回来',
  )
})

test('宿主分类：限流/余额文案不能被映射成 channel_relogin_required', () => {
  const limited = 'opencode: 该模型的所有通道当前都在限流中（最早约 30 分钟后恢复）；这不是登录问题'
  assert.equal(isChannelCredentialFailure(limited), false)
  assert.equal(isChannelRiskControlFailure(limited), false)
  const noBalance = 'qoder: 账号池中没有可用账号（余额为 0、凭据不可用或账号已停用），已停止默认凭据回退'
  assert.equal(isChannelCredentialFailure(noBalance), false)
  assert.equal(isChannelRiskControlFailure(noBalance), false)
  // 真正的「没有账号」仍然走登录提示。
  assert.equal(isChannelCredentialFailure('opencode: 没有可用通道'), true)
  // 11140 仍按风控归类，换家而不惩罚客户端。
  assert.equal(
    isChannelRiskControlFailure('workbuddy: 全部账号均被服务端安全策略拦截 request illegal'),
    true,
  )
})
