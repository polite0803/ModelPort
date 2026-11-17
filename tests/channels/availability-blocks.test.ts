/**
 * 模型可用性快照（P4，2026-11-16）。
 *
 * 两个判据域各出各的事实、绝不折成一个口径：
 * - `rate_limited`（渠道 worker 限流镜像）：`untilSource: 'upstream'` ——
 *   时刻是上游亲口说的（账号 × 模型的真实重置时刻）；
 * - `quota-exhausted`（聚合额度活标记）：`untilSource: 'estimated'`（标记自身
 *   的时刻或 TTL 推算）；活标记才投影，过期行不出现。
 *
 * 证明层次：真 `accountChannelManager.rateLimitMarksSnapshot`（镜像读写同一张表）
 * + 真 `storeManager.getAggregateQuotaExhaustions`（落盘标记）→ handler 装配 → 键形状。
 * handler 本身在 `node --test` 里不可调用（`ipcMain.handle` 空实现），接线由
 * `tests/ipc/routes-menu-wire.test.ts` 风格的源码断言钉住。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { bootstrapStore, loadModule } from '../routes/harness.mjs'
import { IpcChannels } from '../../src/main/ipc/channels.ts'

const harness = await bootstrapStore({ initialData: { providers: [], accounts: [] } })
const { accountChannelManager } = await loadModule('main/providers/accountChannels/manager.ts')
const sm = harness.storeManager

const NOW = Date.now()

// 镜像写一份：预热路径（`noteRateLimits`）写入的读数。
;(accountChannelManager as unknown as {
  noteRateLimits: (id: string, table: Record<string, { limited: true; resetAtMs: number }>, models: string[]) => void
}).noteRateLimits('opencode', { 'hy4flash-free': { limited: true, resetAtMs: NOW + 3600_000 } }, ['hy4flash-free'])

// 聚合标记写一条：报文带复位时刻（P1 修复后 until 是事实）。
sm.addProvider({
  id: 'open_router',
  name: 'OpenRouter',
  type: 'aggregate',
  authType: 'token',
  apiEndpoint: 'https://openrouter.invalid/api/v1',
  chatPath: '/chat/completions',
  headers: {},
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
  supportedModels: ['or/free'],
  modelMappings: { 'or/free': 'or-free' },
} as never)
sm.addAccount({
  id: 'or-acct',
  providerId: 'open_router',
  name: 'or key',
  credentials: { apiKey: 'sk-test' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
} as never)
sm.recordAggregateQuotaExhaustion('open_router', {
  accountId: 'or-acct',
  accountName: 'or key',
  modelId: 'or/free',
  reason: 'quota-exhausted',
  status: 429,
  message: 'Your token-plan 1-month quota has been exhausted. The quota will reset at 12-08 16:00:00 UTC.',
  asOf: new Date(NOW).toISOString(),
  until: new Date(Date.parse('2026-12-08T16:00:00Z')).toISOString(),
})

after(() => harness.dispose())

test('镜像快照：按渠道分桶、只含在期条目', () => {
  const snap = accountChannelManager.rateLimitMarksSnapshot(NOW)
  assert.equal(snap.opencode?.['hy4flash-free'], NOW + 3600_000, '镜像读数按 (渠道, 模型) 还原')
  const empty = accountChannelManager.rateLimitMarksSnapshot(NOW + 3600_000 + 1)
  assert.equal(Object.keys(empty.opencode ?? {}).length, 0, '过期条目被顺带清掉')
})

test('聚合活标记读得到、过期行折叠掉', () => {
  const rows = sm.getAggregateQuotaExhaustionsOf('open_router')
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.modelId, 'or/free')
  assert.ok(rows[0]!.until !== undefined)
})

test('接线：通道常量、handler 引用与 api 方法成对出现', () => {
  const read = (path: string): string => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
  assert.equal(IpcChannels.AVAILABILITY_BLOCKS, 'availability:blocks')
  for (const file of ['src/main/ipc/handlers.ts', 'src/shared/api.ts']) {
    assert.ok(read(file).includes('IpcChannels.AVAILABILITY_BLOCKS'), `${file} 少了 AVAILABILITY_BLOCKS`)
  }
  const api = read('src/shared/api.ts')
  assert.match(api, /blocks: \(\): Promise<AvailabilityBlocksResult> =>\s*\n\s*wire\.invoke\(IpcChannels\.AVAILABILITY_BLOCKS\)/,
    '页面只认命名方法，不开通用 invoke')
  const handlers = read('src/main/ipc/handlers.ts')
  const start = handlers.indexOf('IpcChannels.AVAILABILITY_BLOCKS')
  const block = handlers.slice(start, handlers.indexOf('registerMainHandler(', start + 1))
  assert.match(block, /rateLimitMarksSnapshot\(\)/, '渠道半边必须读镜像，不另算')
  assert.match(block, /getAggregateQuotaExhaustions\(\)/, '聚合半边读落盘标记')
  assert.match(block, /untilSource: 'upstream'/, '渠道限流的时刻是上游声明')
  assert.match(block, /untilSource: 'estimated'/, '聚合标记的时刻是推算（或 TTL）')
})
