import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'

import { DEFAULT_SSE_PING_INTERVAL_MS, startSseHeartbeat } from '../../src/main/proxy/utils/sseHeartbeat.ts'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

test('心跳按间隔写 SSE 注释帧，停止后不再写', async () => {
  const sink = new PassThrough()
  let text = ''
  sink.on('data', chunk => { text += chunk.toString() })

  const heartbeat = startSseHeartbeat(sink, 5)
  // 并行测试下定时器可能被推迟；留足余量，断言的是「按间隔持续写」而不是精确次数。
  await sleep(80)
  heartbeat.stop()
  const afterStop = text
  await sleep(25)

  assert.ok((text.match(/: PING\n\n/g)?.length ?? 0) >= 2)
  assert.equal(text, afterStop, 'stop 之后不得再写心跳')
  assert.ok(heartbeat.pingCount() >= 2, '心跳数要能被诊断日志读到')
})

test('流已结束后不再写心跳', async () => {
  const sink = new PassThrough()
  let text = ''
  sink.on('data', chunk => { text += chunk.toString() })

  const heartbeat = startSseHeartbeat(sink, 10)
  sink.end()
  await sleep(35)
  heartbeat.stop()

  assert.equal(text.includes(': PING'), false, 'writableEnded 后不得再写')
})

test('默认间隔 15s（客户端空流超时之前）', () => {
  assert.equal(DEFAULT_SSE_PING_INTERVAL_MS, 15_000)
})
