import { test } from 'node:test'
import assert from 'node:assert/strict'

import { coldResumeTrace, type ColdResumeTraceInput } from '../../src/main/proxy/coldResumeTrace.ts'

function sample(overrides: Partial<ColdResumeTraceInput> = {}): ColdResumeTraceInput {
  return {
    at: 1000,
    providerId: 'opencode_go',
    accountId: 'acc-1',
    modelId: 'deepseek-v4.1-flash',
    conversationKey: 'session:abc',
    prevPromptTokens: 7000,
    promptTokens: 7200,
    idleGap: 'under5m',
    missTokens: 6000,
    ...overrides,
  }
}

test('FIFO 达到容量后淘汰最旧的一条', () => {
  coldResumeTrace.reset()
  for (let i = 0; i < 130; i++) coldResumeTrace.append(sample({ at: i, accountId: `acc-${i}` }))
  const snap = coldResumeTrace.snapshot()
  assert.equal(snap.capacity, 128)
  assert.equal(snap.entries.length, 128)
  assert.equal(snap.entries[0].at, 129)
  assert.equal(snap.entries[127].at, 2)
  assert.equal(snap.entries.some(entry => entry.accountId === 'acc-0'), false)
})

test('snapshot 是倒序副本，改它不会影响内部状态', () => {
  coldResumeTrace.reset()
  coldResumeTrace.append(sample({ at: 1, accountId: 'a' }))
  coldResumeTrace.append(sample({ at: 2, accountId: 'b' }))
  const snap = coldResumeTrace.snapshot()
  assert.deepEqual(snap.entries.map(entry => entry.accountId), ['b', 'a'])
  snap.entries[0].accountId = 'tampered'
  snap.entries.length = 0
  const again = coldResumeTrace.snapshot()
  assert.equal(again.entries.length, 2)
  assert.equal(again.entries[0].accountId, 'b')
})

test('会话键只落哈希，不落原文', () => {
  coldResumeTrace.reset()
  coldResumeTrace.append(sample({ conversationKey: 'super-secret-session-id' }))
  const entry = coldResumeTrace.snapshot().entries[0]
  assert.doesNotMatch(JSON.stringify(entry), /super-secret-session-id/)
  assert.match(entry.conversationKeyHash ?? '', /^[0-9a-f]{16}$/)
})

test('无会话键时不写哈希字段，异常输入被清洗', () => {
  coldResumeTrace.reset()
  coldResumeTrace.append(sample({ conversationKey: undefined }))
  coldResumeTrace.append(sample({
    at: Number.NaN,
    providerId: 17 as unknown as string,
    accountId: 42 as unknown as string,
    modelId: undefined as unknown as string,
    prevPromptTokens: -3.7,
    promptTokens: Number.POSITIVE_INFINITY,
    missTokens: -100,
  }))
  const entries = coldResumeTrace.snapshot().entries
  // snapshot 倒序：entries[0] 是后追加的异常输入，entries[1] 是无会话键那条。
  assert.equal('conversationKeyHash' in entries[1], false)
  assert.equal(entries[0].at, 0)
  assert.equal(entries[0].providerId, '')
  assert.equal(entries[0].accountId, '')
  assert.equal(entries[0].modelId, '')
  assert.equal(entries[0].prevPromptTokens, 0)
  assert.equal(entries[0].promptTokens, 0)
  assert.equal(entries[0].missTokens, 0)
})

test('非法间隔档不记录，reset 清空', () => {
  coldResumeTrace.reset()
  coldResumeTrace.append(sample({ idleGap: 'bogus' as never }))
  assert.equal(coldResumeTrace.snapshot().entries.length, 0)
  coldResumeTrace.append(sample())
  coldResumeTrace.reset()
  assert.equal(coldResumeTrace.snapshot().entries.length, 0)
})
