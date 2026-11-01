import test from 'node:test'
import assert from 'node:assert/strict'
import { SSEParser, streamHandler } from '../../src/main/proxy/stream.ts'

function collect(stream: NodeJS.WritableStream & { on(event: 'data', cb: (chunk: Buffer) => void): void }): string[] {
  const out: string[] = []
  stream.on('data', (chunk) => out.push(chunk.toString()))
  return out
}

/**
 * 这条用例钉的是「同一个 SSEParser 实例被两条并发流共享」那一版实现：那时 A 留下的半行
 * 会接在 B 的第一帧前面一起解析，B 的输出里就混进了 A 的正文（反之亦然），而且不抛异常、
 * 没有日志。修成按流新建解析器后，两侧都只看得见自己的内容。
 */
test('并发流各用自己的解析器：A 的半帧残留不会接到 B 上', () => {
  const a = streamHandler.createTransformStream('model-a', 'resp-a')
  const b = streamHandler.createTransformStream('model-b', 'resp-b')
  const outA = collect(a)
  const outB = collect(b)

  // A 只给半行（没有换行 → 留在它自己的 carry buffer 里）
  a.write('data: {"id":"a","choices":[{"index":0,"delta":{"content":"SECRET-AAA-1111"}}')
  // B 给一条完整事件
  b.write('data: {"id":"b","choices":[{"index":0,"delta":{"content":"PUBLIC-BBB-2222"}}]}\n\n')

  const textB = outB.join('')
  assert.match(textB, /PUBLIC-BBB-2222/)
  assert.equal(textB.includes('SECRET-AAA-1111'), false, 'B 的输出混进了 A 的残留半帧')

  // 补完 A 的那半行
  a.write('}\n\n')
  const textA = outA.join('')
  assert.match(textA, /SECRET-AAA-1111/)
  assert.equal(textA.includes('PUBLIC-BBB-2222'), false, 'A 的输出混进了 B 的内容')
})

test('一条流的异常残帧不污染另一条刚开始的流', () => {
  const dirty = streamHandler.createTransformStream('model-dirty', 'resp-dirty')
  collect(dirty)
  // 留在中间的碎片：字段名写到一半就断
  dirty.write('data: {"choices":[{"delta":{"content":"LEFTOVER-XXXX')

  const fresh = streamHandler.createTransformStream('model-fresh', 'resp-fresh')
  const outFresh = collect(fresh)
  fresh.write('data: {"choices":[{"delta":{"content":"FRESH-YYYY"}}]}\n\n')

  const text = outFresh.join('')
  assert.match(text, /FRESH-YYYY/)
  assert.equal(text.includes('LEFTOVER-XXXX'), false)
})

/**
 * 负控：证明上面两条用例查的是真东西 —— 把同一个解析器实例交给两条流，前一条留下的半行
 * 会被拼到后一条的帧上（实测输出 `{"choices":[{"delta":{"content":"SECRET-AAA"data: {"choices":…`），
 * JSON 解析当场失败、A 的正文进入 B 的响应。按流新建解析器后同样两步是干净的。
 */
test('负控：共享 SSEParser 时半帧残留必然串进下一条帧', () => {
  const shared = new SSEParser()
  shared.parse('data: {"choices":[{"delta":{"content":"SECRET-AAA"')
  const contaminated = shared.parse('data: {"choices":[{"delta":{"content":"PUBLIC-BBB"}}]}\n\n')
  assert.equal(JSON.stringify(contaminated).includes('SECRET-AAA'), true, '共享解析器没有复现出串流')

  const first = new SSEParser()
  const second = new SSEParser()
  first.parse('data: {"choices":[{"delta":{"content":"SECRET-AAA"')
  const clean = second.parse('data: {"choices":[{"delta":{"content":"PUBLIC-BBB"}}]}\n\n')
  assert.equal(JSON.stringify(clean).includes('SECRET-AAA'), false)
})
