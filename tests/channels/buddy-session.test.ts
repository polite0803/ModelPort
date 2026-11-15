/**
 * buddy 前缀缓存 key 的派生契约（2026-11-15 报障：buddy/hy4free 命中率被压到
 * 128 token 地板）。根因之一是旧实现把 `prompt_cache_key` 钉成一个全局随机
 * UUID，所有会话共用一个缓存命名空间互相驱逐。修复改为按会话身份派生。
 *
 * 本测试钉住派生函数的三条语义：
 * - **跨轮稳定**：同一段对话（同 model/账号/system/首条 user）恒得同 key；
 * - **跨会话隔离**：任一维度不同 → key 不同（尤其首条 user 文本不同）；
 * - **形状与单射**：32 位十六进制；缺省与空串不混同；分隔符注入不相撞。
 *
 * `buddy-session.ts` 只依赖 node:crypto，node 原生剥 TS 即可直接 import。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveBuddyCacheKey } from '../../vendor/channel-pack/src/buddy-session.ts'

const SEED = { model: 'hy4free', accountSeed: 'acct-1', systemText: 'SYS', firstUserText: 'TASK_A' }

test('同输入同输出（确定性），且为 32 位十六进制', () => {
  const a = deriveBuddyCacheKey(SEED)
  const b = deriveBuddyCacheKey(SEED)
  assert.equal(a, b)
  assert.match(a, /^[0-9a-f]{32}$/)
})

test('跨会话隔离：首条 user 文本不同 → key 不同（核心修复）', () => {
  const a = deriveBuddyCacheKey(SEED)
  const b = deriveBuddyCacheKey({ ...SEED, firstUserText: 'TASK_B' })
  assert.notEqual(a, b, '两条并发会话必须落到不同缓存命名空间，否则互相驱逐')
})

test('跨轮稳定：派生只吃首条 user，不吃后续轮次', () => {
  // 同一会话第二轮追加了 assistant/新 user，但首条 user 与 system 不变 →
  // 派生输入不变 → key 不变（后续文本根本不进 seed）。
  const turn1 = deriveBuddyCacheKey(SEED)
  const turn2 = deriveBuddyCacheKey({ ...SEED })
  assert.equal(turn1, turn2)
})

test('模型 / 账号 / system 任一不同 → key 不同', () => {
  const base = deriveBuddyCacheKey(SEED)
  assert.notEqual(base, deriveBuddyCacheKey({ ...SEED, model: 'glm-5.2' }))
  assert.notEqual(base, deriveBuddyCacheKey({ ...SEED, accountSeed: 'acct-2' }))
  assert.notEqual(base, deriveBuddyCacheKey({ ...SEED, systemText: 'OTHER_SYS' }))
})

test('缺省与空串不混同（未下发 ≠ 下发空串）', () => {
  const absent = deriveBuddyCacheKey({ model: 'hy4free' })
  const empty = deriveBuddyCacheKey({ model: 'hy4free', accountSeed: '', systemText: '', firstUserText: '' })
  assert.notEqual(absent, empty)
})

test('JSON 元组单射：分隔符注入不相撞', () => {
  const a = deriveBuddyCacheKey({ model: 'm', systemText: 'a|b', firstUserText: 'c' })
  const b = deriveBuddyCacheKey({ model: 'm', systemText: 'a', firstUserText: 'b|c' })
  assert.notEqual(a, b)
})