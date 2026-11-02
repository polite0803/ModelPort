/**
 * 上游 4xx 响应体的读取（2026-11-02 用户报障：Claude Desktop 显示 `API Error: 400 Unknown error`）。
 *
 * 流式请求走 `responseType: 'stream'`，4xx 时 axios 交回来的是一条流。旧实现直接在
 * 流上做键查找，全部落空后再 `JSON.stringify(流)` —— 因循环引用抛错，最终吐字面量
 * `Unknown error`，把上游那句真实原因整条销毁，按文案判定的换家判据也因此一条不命中。
 * 这里钉的是「读得出来」本身，以及读不出来时诚实退到状态码。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable, PassThrough } from 'node:stream'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { pickUpstreamErrorMessage, readUpstreamErrorData } from '../../src/main/proxy/upstreamErrorBody.ts'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

/** 一条已经写完、随即结束的流，形状等同 axios 在 4xx 时给的响应体。 */
function streamOf(text: string): Readable {
  return Readable.from([Buffer.from(text, 'utf8')])
}

test('流式 4xx：上游写在顶层 message 里的原文必须活着回到调用方', async () => {
  // 2026-11-02 匿名重放取回的真句（OVH 拒绝 anthropic 客户端的 `user` 字段）
  const ovhBody = `{"message":"feature 'extra arguments: {\\"user\\":\\"{\\\\\\"device_id\\\\\\":\\\\\\"96f7add2\\\\\\"}\\"}' is not currently supported"}`
  const data = await readUpstreamErrorData(streamOf(ovhBody))
  const message = pickUpstreamErrorMessage(data, 400)

  assert.ok(message.includes("feature 'extra arguments"), `拿到的是：${message}`)
  assert.notEqual(message, 'Unknown error', '这条正是被吞掉的那个值')
  assert.ok(!message.includes('_readableState'), '不得把流的内部状态当错误文案')
})

test('非流式的已解析对象原样通过，键的取序是 error.message → message → msg', async () => {
  const nested = await readUpstreamErrorData({ error: { message: 'nested 优先' } })
  assert.equal(pickUpstreamErrorMessage(nested, 400), 'nested 优先')
  assert.equal(pickUpstreamErrorMessage({ message: '顶层 message' }, 400), '顶层 message')
  assert.equal(pickUpstreamErrorMessage({ msg: '顶层 msg' }, 400), '顶层 msg')
  // error 是对象但没有 message 时，退回 error.error 那一格
  assert.equal(pickUpstreamErrorMessage({ error: { error: '只有 error.error' } }, 400), '只有 error.error')
})

test('流里不是 JSON 时把文本交出去，空流与读不出时诚实退到状态码', async () => {
  const html = await readUpstreamErrorData(streamOf('<html>502 from an intermediary</html>'))
  assert.equal(pickUpstreamErrorMessage(html, 400), '<html>502 from an intermediary</html>')

  const empty = await readUpstreamErrorData(Readable.from([]))
  assert.ok(pickUpstreamErrorMessage(empty, 400).startsWith('HTTP 400'), '空流不能编出任何原因')
})

test('错误体只读到 32KB 为止：上游继续灌字节也不能把这一格拖成无限等待', async () => {
  const stream = new PassThrough()
  const started = Date.now()
  const pending = readUpstreamErrorData(stream)

  // 一次写超过上限，且**不**结束流：读侧必须自己收口
  stream.write(Buffer.alloc(64 * 1024, 0x61))
  const data = await pending
  const elapsed = Date.now() - started

  assert.ok(elapsed < 3_000, `没读满上限就收口不该等满超时，实测 ${elapsed}ms`)
  assert.equal(typeof data, 'string')
  assert.ok((data as string).length >= 32 * 1024 && (data as string).length < 40 * 1024, `实际 ${(data as string).length}`)
  stream.destroy()
})

test('上游挂着不发字节时按超时收口，退回状态码而不是把请求拖死', async () => {
  const silent = new PassThrough()
  const started = Date.now()
  const data = await readUpstreamErrorData(silent)
  const elapsed = Date.now() - started

  assert.equal(data, null, '一个字节都没读到 ⇒ 交回 null，由文案层退回状态码')
  assert.equal(pickUpstreamErrorMessage(data, 502), 'HTTP 502')
  assert.ok(elapsed >= 2_500, `应当是超时收口，实测 ${elapsed}ms`)
})

test('接线：forwarder 与 anthropic 适配器都先把体读出来再取文案', () => {
  const forwarder = readFileSync(join(root, 'src/main/proxy/forwarder.ts'), 'utf8')
  const adapter = readFileSync(join(root, 'src/main/proxy/adapters/anthropic.ts'), 'utf8')

  // 三处 4xx 出口（默认转发 / 出向 responses / 自定义 URL）都要 await；漏一处就退回吞错误那一格
  assert.equal(forwarder.match(/await this\.extractErrorMessage\(response\)/g)?.length, 3)
  assert.doesNotMatch(forwarder, /error: this\.extractErrorMessage\(response\)/)
  assert.match(forwarder, /const data = await readUpstreamErrorData\(response\.data\)/)
  assert.match(adapter, /extractErrorMessage\(await readUpstreamErrorData\(response\.data\), response\.status\)/)
})
