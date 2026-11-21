/**
 * 裁剪结果回写上游时只准带协议字段：裁剪服务内部的 `timestamp` 每轮都变，
 * 一旦跟着消息进请求体，字节级前缀缓存就永远对不上。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const forwarder = readFileSync('src/main/proxy/forwarder.ts', 'utf-8')

test('裁剪回写只保留 ChatMessage 的协议字段', () => {
  const rewritten = forwarder.match(/messages: processResult\.messages\.map\(msg => \(\{([\s\S]*?)\}\)\)/)
  assert.ok(rewritten, '应保留裁剪回写映射')
  for (const field of ['role: msg.role', 'content: msg.content', 'name: msg.name', 'tool_call_id: msg.tool_call_id', 'tool_calls: msg.tool_calls']) {
    assert.match(rewritten[1], new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `缺协议字段 ${field}`)
  }
  assert.doesNotMatch(rewritten[1], /\.\.\.msg/, '不能整对象展开，否则内部字段会漏进上游 body')
  assert.doesNotMatch(rewritten[1], /timestamp/)
})
