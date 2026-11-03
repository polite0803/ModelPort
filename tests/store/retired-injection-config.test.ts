import { test } from 'node:test'
import assert from 'node:assert/strict'

const { bootstrapStore } = await import('../routes/harness.mjs')

/**
 * 2026-11-03 退役的四处网关注入层的配置键。
 *
 * `normalizeConfig` 是 spread，老 `data.json` 里的死键会原样活到 `getConfig()`，而
 * `GET/PUT /v1/management/config/:key` 的门槛就是 `key in config` —— 于是管理侧会报
 * 「这一格存在」，改它却没有任何代码读。读侧必须把它们摘掉。
 */
test('退役注入层的配置键不从老 data.json 活回运行态', async (t) => {
  const harness = await bootstrapStore({
    initialData: {
      requestLogs: [],
      config: {
        // 同一份播种里放一个仍然有效的键：它活下来，才证明下面三条是「被摘掉」而不是「没播种进去」。
        retryCount: 5,
        toolCallingConfig: {
          enabled: true,
          mode: 'auto',
          clientAdapterId: 'standard-openai-tools',
          advanced: {},
        },
        toolPromptConfig: { mode: 'always' },
        trailingUserGuard: true,
        outputSteering: { enabled: true, level: 3 },
        // 摘要策略是嵌在 `contextManagement` 里的一格，摘它的是另一条归一函数，所以单独播种。
        contextManagement: {
          enabled: true,
          strategies: {
            slidingWindow: { enabled: true, maxMessages: 7 },
            tokenLimit: { enabled: false, maxTokens: 4000 },
            summary: { enabled: true, keepRecentMessages: 3, summaryPrompt: 'legacy prose' },
          },
          executionOrder: ['slidingWindow', 'tokenLimit', 'summary'],
        },
      },
    },
  })
  t.after(() => harness.dispose())
  const sm = harness.storeManager

  const config = sm.getConfig() as Record<string, unknown>
  assert.equal(config.retryCount, 5, '同批播种的有效键必须存活，否则这条判据是空的')
  for (const retired of ['toolCallingConfig', 'toolPromptConfig', 'trailingUserGuard', 'outputSteering']) {
    assert.equal(
      retired in config,
      false,
      `${retired} 已退役：读侧不能留这一格，否则管理 API 会把它报成可写的存在配置`,
    )
  }

  // 嵌在 `contextManagement` 里的那一格走的是另一条归一（`normalizeContextManagementConfig`）。
  const context = config.contextManagement as unknown as {
    strategies: Record<string, unknown>
    executionOrder: string[]
  }
  assert.equal('summary' in context.strategies, false,
    '退役的摘要策略不能从老 data.json 活回运行态')
  assert.deepEqual(context.executionOrder, ['slidingWindow', 'tokenLimit'])
  assert.deepEqual(
    (context.strategies.slidingWindow as { maxMessages: number }).maxMessages,
    7,
    '同一次归一必须留下有效值，否则上面两条是空的',
  )

  // 写侧同一条路：updateConfig 末尾再归一一次，运行期写入的死键也留不下来。
  const afterWrite = sm.updateConfig({ loadBalanceStrategy: 'failover' } as never) as unknown as Record<string, unknown>
  assert.equal('toolCallingConfig' in afterWrite, false)
  assert.equal(afterWrite.loadBalanceStrategy, 'failover')
})
