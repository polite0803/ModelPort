import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  aggregateBanditStats,
  createBanditRandom,
  isCapacityDrivenFailure,
  sampleBanditSuccessRate,
  type BanditLogEntry,
} from '../../src/main/proxy/autoBandit.ts'

/**
 * 两条评分轴（2026-11-12 用户裁定）：
 *
 * - **能力轴**（本文件的后验与退化计数）只回答「这一家能不能把 agent 回合干完」；
 * - **配额轴**（429/402/额度/欠费/排队 + 冷却与解禁时刻）只回答「现在能不能派给它」。
 *
 * 拆之前两轴混在同一个 Beta 分母里，于是「好用但配额小」的免费家被历史限流永久压住，
 * 而「有配额但只会宣布下一步」的家反而排前面 —— 正好是「时间一久筛出好免费模型」的反面。
 */

const NOW = 1_800_000_000_000

function entry(patch: Partial<BanditLogEntry>): BanditLogEntry {
  return {
    timestamp: NOW,
    status: 'success',
    latency: 1000,
    providerId: 'free',
    actualModel: 'free/plain',
    finishReason: 'tool_calls',
    ...patch,
  } as BanditLogEntry
}

const ANNOUNCED = {
  contentChars: 42, toolCallDeltas: 0, toolsOffered: true, empty: false, lastChar: '：', announcedStop: true,
}

test('配额轴的分类：限流/额度/欠费/池子掏空算，真实故障不算', () => {
  assert.equal(isCapacityDrivenFailure({ httpStatus: 429 }), true)
  assert.equal(isCapacityDrivenFailure({ httpStatus: 402 }), true)
  assert.equal(isCapacityDrivenFailure({
    statusCode: 503, errorCode: 'no_available_model',
  }), true, '整条链被配额掏空不是最后那一家的能力判决')
  assert.equal(isCapacityDrivenFailure({ errorMessage: 'Sorry, your account balance is insufficient' }), true)
  assert.equal(isCapacityDrivenFailure({
    errorMessage: 'Allocated quota exceeded, please increase your quota limit.',
  }), true)
  assert.equal(isCapacityDrivenFailure({
    statusCode: 400, errorCode: 'Arrearage',
    errorMessage: 'Access denied, please make sure your account is in good standing. #overdue-payment',
  }), true)

  // 不算配额轴：这些是真的「这一家干不了这活」
  assert.equal(isCapacityDrivenFailure({ httpStatus: 502 }), false)
  assert.equal(isCapacityDrivenFailure({ httpStatus: 500 }), false)
  assert.equal(isCapacityDrivenFailure({ httpStatus: 4290 }), false)
  // 行级的 `status` 是 'success' | 'error' 字符串，绝不能被当成 HTTP 码读
  assert.equal(isCapacityDrivenFailure({ httpStatus: undefined, statusCode: undefined }), false)
  assert.equal(isCapacityDrivenFailure({ statusCode: 503, errorCode: 'api_error' }), false)
  assert.equal(isCapacityDrivenFailure({}), false)
})

test('429 / 402 / 欠费的尝试不进能力后验', () => {
  const rows = [entry({
    providerId: 'free',
    actualModel: 'free/throttled-but-good',
    attempts: [
      { providerId: 'free', model: 'free/throttled-but-good', outcome: 'failover', status: 429, errorCode: 'rate_limit_error' },
      { providerId: 'free', model: 'free/throttled-but-good', outcome: 'failover', status: 402, errorMessage: 'Sorry, your account balance is insufficient' },
      { providerId: 'free', model: 'free/throttled-but-good', outcome: 'capability', status: 400, errorCode: 'Arrearage', errorMessage: 'account overdue-payment' },
    ],
  })]
  const stats = aggregateBanditStats(rows, NOW)
  const one = stats.get('free|free/throttled-but-good')
  assert.equal(one?.successes, 1, '这一发本身是成功的')
  assert.equal(one?.attemptTotal ?? 0, 0, '三条都是配额类，一条都不该进能力轴')
  assert.equal(one?.attemptFailures ?? 0, 0)
})

test('真实失败仍然进能力轴 —— 拆轴不是免罪金牌', () => {
  const rows = [entry({
    providerId: 'free',
    actualModel: 'free/broken',
    attempts: [
      { providerId: 'free', model: 'free/broken', outcome: 'failover', status: 502 },
      { providerId: 'free', model: 'free/broken', outcome: 'failover', status: 500 },
      { providerId: 'free', model: 'free/broken', outcome: 'failover', status: 503, errorCode: 'model_not_supported' },
    ],
  })]
  const stats = aggregateBanditStats(rows, NOW)
  assert.equal(stats.get('free|free/broken')?.attemptFailures, 3)
})

test('503「池子被配额掏空」的终态行不计入任何候选', () => {
  const rows = [entry({
    providerId: 'free',
    actualModel: 'free/last-tried',
    status: 'error',
    statusCode: 503,
    errorCode: 'no_available_model',
    errorMessage: "Route 'codex' exhausted all 3 candidates",
  })]
  const stats = aggregateBanditStats(rows, NOW)
  assert.equal(stats.get('free|free/last-tried'), undefined,
    '它连分母都不该进 —— 这一发的失败不属于这一家')
})

test('被限流的好模型排在只会宣布的模型前面（两轴的实际效果）', () => {
  const entries: BanditLogEntry[] = []
  for (let i = 0; i < 6; i++) {
    const ts = NOW - (6 - i) * 1000
    // A：每轮前面撞一次 429（配额轴），但交付的那几发都是真工具调用
    entries.push(entry({
      timestamp: ts, providerId: 'free', actualModel: 'free/throttled-but-good',
      attempts: [{ providerId: 'free', model: 'free/throttled-but-good', outcome: 'failover', status: 429 }],
    }))
    // B：不限流，但每轮只宣布下一步
    entries.push(entry({
      timestamp: ts, providerId: 'free', actualModel: 'free/talker',
      streamTrace: { emptyTurn: ANNOUNCED },
    }))
  }
  const stats = aggregateBanditStats(entries, NOW)
  const random = createBanditRandom(7)
  const rate = (key: string): number => {
    const found = stats.get(key)
    assert.ok(found, `missing stats for ${key}`)
    return sampleBanditSuccessRate(found, random)
  }
  assert.equal(stats.get('free|free/throttled-but-good')?.attemptFailures ?? 0, 0,
    '六次限流一次都不该记进能力轴')
  assert.ok(rate('free|free/throttled-but-good') > rate('free|free/talker'),
    `throttled-good=${rate('free|free/throttled-but-good')} talker=${rate('free|free/talker')}`)
})
