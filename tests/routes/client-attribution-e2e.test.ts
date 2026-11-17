import { test } from 'node:test'
import assert from 'node:assert/strict'

import { localDayKey } from '../../src/shared/localDay.ts'

const { bootstrapStore, startProxy } = await import('../routes/harness.mjs')

const TODAY = localDayKey(Date.now())

// 固定端口：harness 的 startProxy 不接受 0（要一个真的监听端口）。
// 端口号必须与其它 e2e 文件错开：全量测试是多文件并发跑的，撞端口会让**对方**
// 的 startProxy 直接失败（2026-11-17：本文件占了 18971，`responses-inbound` 也用它，
// 门禁因此红了一条与本次改动无关的用例）。现取已用区间（18931–19004）之外的号。
const PORT = 19014

/**
 * 端到端：真 HTTP 请求 → 鉴权中间件 → 路由 → 日志行与按天账本。
 *
 * 这一层证明的是「命中的 key 名真的变成了客户端归属名」，不是读源码文本 ——
 * Node 系客户端不发 UA，纯 UA 口径下两者都是 `undici`（2026-11-17 实测
 * 267/300 行如此），只有 key 名能把它们分开。
 */
test('两把命名 key 的请求被归到各自的客户端桶', async (t) => {
  const harness = await bootstrapStore({
    initialData: {
      requestLogs: [],
      logs: [],
      config: {
        apiKeys: [
          { id: 'k-qoder', name: 'Qoder', key: 'sk-qoder', enabled: true, createdAt: 1, usageCount: 0 },
          { id: 'k-claude', name: 'Claude', key: 'sk-claude', enabled: true, createdAt: 1, usageCount: 0 },
        ],
      },
    },
  })
  t.after(() => harness.dispose())

  const proxy = await startProxy(PORT)
  t.after(() => proxy.stop())

  const body = {
    model: 'auto',
    messages: [{ role: 'user', content: 'ping' }],
  }

  // 两把 key 各发一笔；模型名指向一个不存在的路由，请求会在选路阶段被拒，
  // 但**鉴权已经过了** —— 那正是归属要成立的那一段。
  for (const key of ['sk-qoder', 'sk-claude']) {
    const res = await proxy.request('POST', '/v1/chat/completions', {
      headers: { Authorization: `Bearer ${key}` },
      body,
    })
    assert.notEqual(res.status, 401, 'a valid key must not be refused')
  }

  const day = harness.storeManager.getStatistics().dailyStats[TODAY]
  assert.equal(day.clientUsage?.Qoder, 1)
  assert.equal(day.clientUsage?.Claude, 1)

  // 请求日志行上也要带上归属名（不带 key 名就分不出是谁发的）。
  const rows = harness.storeManager.getRequestLogs()
  const labelled = rows.filter((row) => row.client !== undefined)
  assert.ok(labelled.length > 0, 'the request rows must carry the client attribution')
})
