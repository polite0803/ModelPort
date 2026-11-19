/**
 * DeepSeek DSML 工具调用的解析与流式过滤。
 *
 * 真实形态取自 2026-11-19 18:02（Codex 会话 `rollout-2026-11-19T17-49-36…` 第 308 行），
 * 逐字节核对：开标签 `<｜DSML｜ calls>` / `<｜DSML｜ invoke …>` / `<｜DSML｜ parameter …>`，
 * 闭标签 `</｜DSML｜ parameter>` / `</｜DSML｜ invoke>` / `</｜DSML｜ calls>`；
 * `｜` 是 U+FF5C 全角竖线，`DSML｜` 后带一个空格。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createDsmlContentFilter,
  parseDsmlToolCalls,
  parseToolCallBlock,
} from '../../src/shared/dsmlToolCalls.ts'

const LEAK_BLOCK = [
  '<｜DSML｜ calls>',
  '<｜DSML｜ invoke name="exec_command">',
  '<｜DSML｜ parameter name="cmd" string="true">git status --short</｜DSML｜ parameter>',
  '<｜DSML｜ parameter name="justification" string="true">查看工作区状态</｜DSML｜ parameter>',
  '<｜DSML｜ parameter name="login" string="false">false</｜DSML｜ parameter>',
  '<｜DSML｜ parameter name="max_output_tokens" string="false">10000</｜DSML｜ parameter>',
  '<｜DSML｜ parameter name="prefix" string="true">git</｜DSML｜ parameter>',
  '</｜DSML｜ invoke>',
  '</｜DSML｜ calls>',
].join('\n')

const COMPACT_BLOCK = [
  '<｜DSML｜tool_calls>',
  '<｜DSML｜invoke name="read_file">',
  '<｜DSML｜parameter name="path" string="true">a.ts</｜DSML｜parameter>',
  '</｜DSML｜invoke>',
  '</｜DSML｜tool_calls>',
].join('\n')

test('解析真实泄漏形状：string 属性与数字/布尔字面量按原类型还原', () => {
  const calls = parseDsmlToolCalls(LEAK_BLOCK)
  assert.ok(calls)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'exec_command')
  assert.deepEqual(JSON.parse(calls[0].arguments), {
    cmd: 'git status --short',
    justification: '查看工作区状态',
    login: false,
    max_output_tokens: 10000,
    prefix: 'git',
  })
})

test('无空格的渠道包写法同样能解析', () => {
  const calls = parseDsmlToolCalls(COMPACT_BLOCK)
  assert.ok(calls)
  assert.deepEqual(calls.map(call => call.name), ['read_file'])
  assert.deepEqual(JSON.parse(calls[0].arguments), { path: 'a.ts' })
})

test('一个块里多个 invoke 全部按顺序解析', () => {
  const block = [
    '<｜DSML｜ calls>',
    '<｜DSML｜ invoke name="read_file">',
    '<｜DSML｜ parameter name="path" string="true">a.ts</｜DSML｜ parameter>',
    '</｜DSML｜ invoke>',
    '<｜DSML｜ invoke name="read_file">',
    '<｜DSML｜ parameter name="path" string="true">b.ts</｜DSML｜ parameter>',
    '</｜DSML｜ invoke>',
    '</｜DSML｜ calls>',
  ].join('\n')
  const calls = parseDsmlToolCalls(block)
  assert.ok(calls)
  assert.deepEqual(calls.map(call => call.name), ['read_file', 'read_file'])
  assert.deepEqual(calls.map(call => JSON.parse(call.arguments).path), ['a.ts', 'b.ts'])
})

test('块残缺（缺 invoke 闭合标签）判解析失败，不猜', () => {
  const partial = [
    '<｜DSML｜ calls>',
    '<｜DSML｜ invoke name="x">',
    '<｜DSML｜ parameter name="a" string="true">1</｜DSML｜ parameter>',
  ].join('\n')
  assert.equal(parseDsmlToolCalls(partial), undefined)
})

test('流式：正文整体是 DSML 时只产出调用，正文为空', () => {
  const filter = createDsmlContentFilter(call => call.name === 'exec_command')
  const event = filter.push(`\n\n${LEAK_BLOCK}`)
  assert.equal(event.text, '')
  assert.equal(event.calls.length, 1)
  assert.equal(event.calls[0].name, 'exec_command')
})

test('流式：标签跨 chunk 切断仍能拼出完整调用', () => {
  const filter = createDsmlContentFilter()
  let text = ''
  const calls: string[] = []
  for (let i = 0; i < LEAK_BLOCK.length; i += 7) {
    const event = filter.push(LEAK_BLOCK.slice(i, i + 7))
    text += event.text
    calls.push(...event.calls.map(call => call.name))
  }
  assert.equal(text, '')
  assert.deepEqual(calls, ['exec_command'])
})

test('流式：正文带前言时锁存纯文本，逐字放行不解析', () => {
  const filter = createDsmlContentFilter()
  const first = filter.push('下面演示 DSML 语法：')
  assert.equal(first.text, '下面演示 DSML 语法：')
  assert.equal(first.calls.length, 0)
  const rest = filter.push(LEAK_BLOCK)
  assert.equal(rest.text, LEAK_BLOCK)
  assert.equal(rest.calls.length, 0)
})

test('流式：accept 拒绝时整块按文本放行（过滤器保留该能力，tap 侧恒接受）', () => {
  const filter = createDsmlContentFilter(() => false)
  const event = filter.push(LEAK_BLOCK)
  assert.equal(event.calls.length, 0)
  assert.equal(event.text, LEAK_BLOCK)
})

test('流式：块未闭合就结束时，flush 连开标签一起回吐', () => {
  const filter = createDsmlContentFilter()
  const partial = [
    '<｜DSML｜ calls>',
    '<｜DSML｜ invoke name="exec_command">',
    '<｜DSML｜ parameter name="cmd" string="true">git status',
  ].join('\n')
  const event = filter.push(partial)
  assert.equal(event.text, '')
  const tail = filter.flush()
  assert.equal(tail.text, partial)
  assert.equal(tail.calls.length, 0)
})

test('流式：两个连续块之间只有空白也能各出一条调用', () => {
  const filter = createDsmlContentFilter()
  const second = LEAK_BLOCK.replace('git status --short', 'git diff --stat')
  const event = filter.push(`${LEAK_BLOCK}\n\n${second}`)
  assert.equal(event.text, '')
  assert.deepEqual(event.calls.map(call => JSON.parse(call.arguments).cmd), ['git status --short', 'git diff --stat'])
})

/* ------------------------------------------------------------------ *
 * 第二种形态：<tool_call> JSON（relayai 一类「模拟工具」网关的约定）  *
 * 实测出现条件：请求没有声明工具时，模型自己写出这种文本。            *
 * ------------------------------------------------------------------ */

test('<tool_call> JSON：relayai 形状还原成调用，arguments 原样保留', () => {
  const block = '<tool_call>{"name":"run_command","arguments":{"command":"git status --short"}}</tool_call>'
  const calls = parseToolCallBlock(block)
  assert.ok(calls)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'run_command')
  assert.deepEqual(JSON.parse(calls[0].arguments), { command: 'git status --short' })
})

test('<tool_call> JSON：Anthropic 风格的 input 与 tool/parameters 也能认', () => {
  const withInput = parseToolCallBlock('<tool_call>{"name":"read_file","input":{"path":"a.ts"}}</tool_call>')
  assert.ok(withInput)
  assert.deepEqual(JSON.parse(withInput[0].arguments), { path: 'a.ts' })

  const withTool = parseToolCallBlock('<tool_call>{"tool":"grep","parameters":{"pattern":"x"}}</tool_call>')
  assert.ok(withTool)
  assert.equal(withTool[0].name, 'grep')
  assert.deepEqual(JSON.parse(withTool[0].arguments), { pattern: 'x' })
})

test('<tool_call> JSON：一次多个调用（数组形态）', () => {
  const block = '<tool_call>[{"name":"a","arguments":{}},{"name":"b","arguments":{"x":1}}]</tool_call>'
  const calls = parseToolCallBlock(block)
  assert.ok(calls)
  assert.deepEqual(calls.map(call => call.name), ['a', 'b'])
  assert.deepEqual(JSON.parse(calls[1].arguments), { x: 1 })
})

test('<tool_call> JSON：自由文本参数包成 input，非法 JSON 不猜', () => {
  const freeform = parseToolCallBlock('<tool_call>{"name":"apply_patch","arguments":"*** Begin Patch"}</tool_call>')
  assert.ok(freeform)
  assert.deepEqual(JSON.parse(freeform[0].arguments), { input: '*** Begin Patch' })

  assert.equal(parseToolCallBlock('<tool_call>not json at all</tool_call>'), undefined)
  assert.equal(parseToolCallBlock('<tool_call>{"arguments":{}}</tool_call>'), undefined, '没有名字不能造')
})

test('流式：<tool_call> 标签跨 chunk 切断仍能还原，且不吞正文', () => {
  const block = '<tool_call>{"name":"run_command","arguments":{"command":"ls"}}</tool_call>'
  const filter = createDsmlContentFilter()
  let text = ''
  const names: string[] = []
  for (let i = 0; i < block.length; i += 6) {
    const event = filter.push(block.slice(i, i + 6))
    text += event.text
    names.push(...event.calls.map(call => call.name))
  }
  assert.equal(text, '')
  assert.deepEqual(names, ['run_command'])
})

test('流式：<tool_call> 带前言时锁存纯文本，不解析', () => {
  const filter = createDsmlContentFilter()
  const first = filter.push('示例格式如下：')
  assert.equal(first.text, '示例格式如下：')
  const rest = filter.push('<tool_call>{"name":"a","arguments":{}}</tool_call>')
  assert.equal(rest.calls.length, 0)
  assert.ok(rest.text.includes('<tool_call>'))
})

test('流式：DSML 与 <tool_call> 连续出现，两种都能还原', () => {
  const filter = createDsmlContentFilter()
  const json = '<tool_call>{"name":"second","arguments":{}}</tool_call>'
  const event = filter.push(`${LEAK_BLOCK}\n\n${json}`)
  assert.equal(event.text, '')
  assert.deepEqual(event.calls.map(call => call.name), ['exec_command', 'second'])
})