/**
 * system 块的按渠道截断（`maxSystemTokensByProvider`）。
 *
 * 为什么单开一格而不是塞进 `maxTokens`：system 块是**客户自己的提示词**，
 * 比丢历史更强的动作。行为判据（2026-11-16 实测一份 125,024 token 的 agent 请求）：
 * system 块约 45,239 token = 36.2%，单条 tool 结果约 66,005 —— 系统块大，但不是大头。
 * 所以它既不该全局默认被切（会在每条渠道上改写前缀、打碎可用的缓存），也不该
 * 完全不可控（在 AFP 计费、缓存不降价的渠道上它每轮都按全价重买）。
 *
 * 缺省 = 一个字节都不动；点名 `maxSystemTokensByProvider[providerId]` 才截断。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ContextManagementService,
  TokenLimitStrategy,
  createContextManagementService,
  normalizeContextManagementConfig,
} from '../../src/main/proxy/services/contextManagementService.ts'
import { CcrStore, setCcrStore } from '../../src/main/proxy/compression/ccr/store.ts'
import type { ChatMessage } from '../../src/main/proxy/types.ts'

const msg = (role: ChatMessage['role'], length: number): ChatMessage =>
  ({ role, content: 'x'.repeat(length) }) as ChatMessage

const est = (messages: ChatMessage[]) => ContextManagementService.estimateTotalTokens(messages)

const config = (systemCap?: number) => ({
  enabled: true,
  channelIds: ['volc'],
  executionOrder: ['tokenLimit'] as never[],
  strategies: {
    slidingWindow: { enabled: false, maxMessages: 200 },
    tokenLimit: {
      enabled: true,
      maxTokens: 20_000,
      ...(systemCap === undefined ? {} : { maxSystemTokensByProvider: { volc: systemCap } }),
    },
  },
})

/** system 30,000 字符 = 10,000 token；一个普通的 user 追问。 */
const withBigSystem = (): ChatMessage[] => [msg('system', 30_000), msg('user', 300)]

test('缺省：system 块一个字节都不动（未点名即不裁）', () => {
  const input = withBigSystem()
  const result = new TokenLimitStrategy({ enabled: true, maxTokens: 20_000 }).execute(input)

  assert.equal(result.messages[0]?.content, input[0]?.content, '未点名时不许改写客户的系统提示')
  assert.equal(result.trimmed, false, '没有别的可裁，就什么都没发生')
})

test('点名渠道后 system 被截到自己的上限，并留下取回指针', async () => {
  const input = withBigSystem()
  // 走工厂 + process 这条生产路径：解析发生在构造函数里，直接 new 一个策略
  // 会绕过它，测到的就不是「按渠道」这件事。
  const service = createContextManagementService(config(4_000), 'volc')
  const out = await service.process(input)

  const systemTokens = est([out.messages[0]])
  assert.ok(systemTokens <= 4_000 + 8, `system 应被裁到 ~4000，实际 ${systemTokens}`)
  assert.match(
    String(out.messages[0]?.content),
    /chars dropped to fit the context budget\./,
    '截断必须自述',
  )
  assert.equal(out.messages[1]?.content, input[1]?.content, 'user 追问不受影响')
  assert.equal(out.changed, true, '内容被改写 ⇒ changed 必须为真，否则调用方会丢弃结果')
})

test('负控：同一份输入、不点名该渠道 —— system 原样，输出更大', () => {
  const input = withBigSystem()
  const strategy = (cap?: number) =>
    new TokenLimitStrategy({ enabled: true, maxTokens: 20_000, ...(cap === undefined ? {} : { systemMaxTokens: cap }) })

  const pointed = strategy(4_000).execute(input)
  const unpointed = strategy().execute(input)

  assert.ok(
    est(unpointed.messages) > est(pointed.messages),
    '两条路径必须真的不同，否则「按渠道开启」这句话没有分辨力',
  )
  assert.equal(unpointed.messages[0]?.content, input[0]?.content)
})

test('未点名的**另一条**渠道不受这条覆盖影响', () => {
  const input = withBigSystem()
  const cfg = config(4_000)
  const other = createContextManagementService(cfg, 'trae')
  assert.equal(
    other.getConfig().strategies.tokenLimit.systemMaxTokens,
    undefined,
    '覆盖表只对点名的 providerId 生效',
  )
  const out = new TokenLimitStrategy(other.getConfig().strategies.tokenLimit).execute(input)
  assert.equal(out.messages[0]?.content, input[0]?.content)
})

test('归一化：覆盖表只收正有限数，坏值丢弃；resolved 键不许写进配置', () => {
  const normalized = normalizeContextManagementConfig({
    enabled: true,
    strategies: {
      tokenLimit: {
        enabled: true,
        maxTokens: 1000,
        maxSystemTokensByProvider: { ' volc ': 24_000, zero: 0, negative: -5, text: 'x' as never },
        // 已解析值不是存储状态：文件里出现也必须被摘掉。
        systemMaxTokens: 99_999,
      },
    },
  } as never)

  assert.deepEqual(normalized.strategies.tokenLimit.maxSystemTokensByProvider, { volc: 24_000 })
  assert.equal(
    (normalized.strategies.tokenLimit as { systemMaxTokens?: number }).systemMaxTokens,
    undefined,
    'systemMaxTokens 是解析结果，配置文件不许携带',
  )
})

test('system 截断真的能取回原文：hash 指向完整系统提示', () => {
  const dir = mkdtempSync(join(tmpdir(), 'modelport-trim-ccr-'))
  try {
    setCcrStore(new CcrStore({ dir }))
    const input = withBigSystem()
    const strategy = new TokenLimitStrategy({ enabled: true, maxTokens: 20_000, systemMaxTokens: 4_000 })
    const out = strategy.execute(input)

    const content = String(out.messages[0]?.content)
    const hash = /Retrieve more: hash=([a-f0-9]{24})/.exec(content)?.[1]
    assert.ok(hash, `截断标记必须带 hash，实际尾部: ${JSON.stringify(content.slice(-120))}`)

    const restored = new CcrStore({ dir }).get(hash)
    assert.equal(restored, input[0]?.content, '指针必须能取回逐字原文，而不是被截断的前缀')
  } finally {
    setCcrStore(undefined)
    rmSync(dir, { recursive: true, force: true })
  }
})