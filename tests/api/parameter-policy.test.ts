import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { findUnsupportedParameter, stripUnsupportedForBuiltin } from '../../src/main/proxy/parameterPolicy.ts'
import { extractTextContent } from '../../src/main/proxy/utils/contentText.ts'
import type { ChatCompletionRequest } from '../../src/main/proxy/types.ts'

const builtin = { type: 'builtin' }
const custom = { type: 'custom' }

function request(extra: Record<string, unknown> = {}): ChatCompletionRequest {
  return { model: 'm', messages: [{ role: 'user', content: 'hi' }], ...extra } as ChatCompletionRequest
}

test('only multiple choices stay rejected for built-in providers', () => {
  assert.equal(findUnsupportedParameter(request({ n: 2 }), builtin), 'n')
  assert.equal(findUnsupportedParameter(request({ response_format: { type: 'json_object' } }), builtin), null)
})

test('sampling knobs stock clients send are accepted and stripped for built-in providers', () => {
  const knobs = ['stream_options', 'response_format', 'top_p', 'stop', 'frequency_penalty', 'presence_penalty', 'max_tokens', 'seed', 'logit_bias']
  for (const knob of knobs) {
    assert.equal(findUnsupportedParameter(request({ [knob]: knob === 'top_p' ? 0.9 : {} }), builtin), null, knob)
  }
})

test('text response_format and single choice stay accepted', () => {
  assert.equal(findUnsupportedParameter(request({ response_format: { type: 'text' } }), builtin), null)
  assert.equal(findUnsupportedParameter(request({ n: 1 }), builtin), null)
  assert.equal(findUnsupportedParameter(request(), builtin), null)
})

test('custom providers keep their existing pass-through behaviour', () => {
  assert.equal(findUnsupportedParameter(request({ response_format: { type: 'json_object' }, seed: 1 }), custom), null)
})

test('sampling knobs are stripped for built-in providers instead of rejected', () => {
  const original = request({
    stream_options: { include_usage: true },
    response_format: { type: 'json_object' },
    top_p: 0.9,
    stop: ['x'],
    frequency_penalty: 0.5,
    presence_penalty: 0.5,
    max_tokens: 256,
    seed: 7,
    logit_bias: { '1': 1 },
    temperature: 0.2,
  })

  assert.equal(findUnsupportedParameter(original, builtin), null)

  const stripped = stripUnsupportedForBuiltin(original, builtin) as ChatCompletionRequest & Record<string, unknown>
  for (const knob of ['stream_options', 'response_format', 'top_p', 'stop', 'frequency_penalty', 'presence_penalty', 'max_tokens', 'seed', 'logit_bias']) {
    assert.equal(stripped[knob], undefined, knob)
  }
  assert.equal(stripped.temperature, 0.2)
  assert.equal(stripped.messages.length, original.messages.length)

  // 不修改传入对象
  assert.equal((original as Record<string, unknown>).top_p, 0.9)

  // 自定义供应商原样透传
  const kept = stripUnsupportedForBuiltin(original, custom) as ChatCompletionRequest & Record<string, unknown>
  assert.equal(kept.top_p, 0.9)
  assert.deepEqual(kept.stream_options, { include_usage: true })
})

test('array tool content is flattened to text instead of [object Object]', () => {
  assert.equal(extractTextContent('plain'), 'plain')
  assert.equal(extractTextContent([{ type: 'text', text: 'ok' }]), 'ok')
  assert.equal(extractTextContent([{ type: 'text', text: 'a' }, { type: 'image_url', image_url: { url: 'x' } }]), 'a')
  assert.equal(extractTextContent(null), '')
  assert.doesNotMatch(extractTextContent([{ type: 'text', text: 'ok' }]), /object Object/)
})

test('request correlation id is returned and context trimming keeps tool fields', () => {
  const chat = readFileSync(fileURLToPath(new URL('../../src/main/proxy/routes/chat.ts', import.meta.url)), 'utf8')
  const completions = readFileSync(fileURLToPath(new URL('../../src/main/proxy/routes/completions.ts', import.meta.url)), 'utf8')
  const forwarder = readFileSync(fileURLToPath(new URL('../../src/main/proxy/forwarder.ts', import.meta.url)), 'utf8')

  assert.match(chat, /ctx\.set\('X-Request-Id', requestId\)/)
  assert.match(completions, /ctx\.set\('X-Request-Id', requestId\)/)
  assert.match(forwarder, /messages: processResult\.messages\.map\(msg => \(\{ \.\.\.msg \}\)\)/)
  assert.match(forwarder, /\.\.\.msg,\s*\n\s*role: msg\.role/)
})

test('custom providers go through the same tool pipeline', () => {
  const forwarder = readFileSync(fileURLToPath(new URL('../../src/main/proxy/forwarder.ts', import.meta.url)), 'utf8')
  // 语义而不是排版：默认分支的 messages 与 tools 都必须来自工具引擎的裁决结果
  // （2026-11-01 修复：`transformed.tools` 此前被整个丢掉，`buildRequestBody` 的
  // 白名单里也没有 `tools`，于是「关掉工具托管」等于把客户端的工具静默删掉）。
  // 断言允许换行与加参，不再锁某一种写法。
  assert.match(
    forwarder,
    /buildRequestBody\(\s*\{[\s\S]{0,400}?messages: transformed\.messages[\s\S]{0,200}?tools: transformed\.tools/,
  )
  assert.match(forwarder, /stream: wrapStreamWithPlan\(probed\.stream, transformed\.plan\)/)
  assert.match(forwarder, /this\.applyToolCallsToResponse\(response\.data, transformed\)/)
})

test('新增的可选参数：自定义/聚合透传，内置按能力剥离', () => {
  const extra = {
    logprobs: true,
    top_logprobs: 3,
    prediction: { type: 'content', content: 'x' },
    modalities: ['text'],
    audio: { format: 'wav' },
    service_tier: 'flex',
    reasoning: { effort: 'low' },
    top_k: 5,
  }
  const strippedForCustom = stripUnsupportedForBuiltin(request(extra), custom) as any
  for (const key of Object.keys(extra)) {
    assert.notEqual(strippedForCustom[key], undefined, `${key} 应对自定义供应商透传`)
  }
  const strippedForBuiltin = stripUnsupportedForBuiltin(request(extra), builtin) as any
  for (const key of Object.keys(extra)) {
    assert.equal(strippedForBuiltin[key], undefined, `${key} 应从内置供应商剥离`)
  }
})
