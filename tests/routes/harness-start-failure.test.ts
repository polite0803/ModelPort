/**
 * `startProxy` 起不来时的收尾契约。
 *
 * 判据是行为差集：端口被占时必须以「拒绝」结束（不是挂住）；端口释放后
 * **同一个进程**里必须能重新起来并服务 `/health`。半启动状态不清除时，下一次
 * `start()` 会被 `if (this.server) return false` 直接判死 —— 2026-11-17 门禁
 * 连续红正是这条形态：一次端口占用被放大成整个文件、整条腿的红。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:net'

import { bootstrapStore, startProxy } from './harness.mjs'

const PORT = 18977

const harness = await bootstrapStore({
  initialData: {
    providers: [],
    accounts: [],
    sessions: [],
    logs: [],
    requestLogs: [],
    statistics: {},
    userModelOverrides: {},
    config: {
      proxyPort: PORT,
      proxyHost: '127.0.0.1',
      loadBalanceStrategy: 'round-robin',
      routes: {},
    },
  },
})

function occupy(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const blocker = createServer()
    blocker.once('error', reject)
    blocker.listen(port, '127.0.0.1', () => resolve(blocker))
  })
}

function release(blocker: Server): Promise<void> {
  return new Promise(resolve => blocker.close(() => resolve()))
}

test('a refused start leaves no residue: the same process can bind the port again', async () => {
  // 两轮：第一轮证明失败后可恢复，第二轮证明失败态不会累积。
  for (let cycle = 0; cycle < 2; cycle++) {
    const blocker = await occupy(PORT)
    try {
      await assert.rejects(
        startProxy(PORT),
        /refused to start on 127\.0\.0\.1:18977/,
        `cycle ${cycle}: an occupied port must surface as a refusal, not a hang`,
      )
    } finally {
      await release(blocker)
    }

    const proxy = await startProxy(PORT)
    try {
      const health = await proxy.request('GET', '/health')
      assert.equal(health.status, 200, `cycle ${cycle}: the freed port must serve again`)
    } finally {
      await proxy.stop()
    }
  }
})

after(() => {
  harness.dispose()
})