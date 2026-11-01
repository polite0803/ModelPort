/**
 * 末条工具结果兜底（`proxy/trailingUserGuard.ts`）。
 *
 * 故障是真流量取证来的：本机 VS Code 走 131 那台网关，同一会话第 1 轮全部正常，
 * 第 2/2/4 轮回包分别是 `I don't see a request in your message — what would you like
 * me to do in ModelPort?`、`I'm ready — what would you like me to work on…`、
 * 「告诉我你想做的具体事情即可」，另一次改成调 `ask_user` 反问。四条出站都末条
 * `role:"tool"`。
 *
 * 本文件钉两件事：纯函数本身的语义（含幂等与不可变），以及**挂点顺序** ——
 * 顺序错了会造出新缺陷：兜底句混进重复度/存活指标，或被压缩器再改一遍。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  TRAILING_USER_TEXT,
  injectTrailingUser,
  trailingUserGuardEnabled,
} from '../../src/main/proxy/trailingUserGuard.ts'

const toolTurn = [
  { role: 'user', content: '先摸清仓库现状再评估完成度' },
  {
    role: 'assistant',
    content: '执行探测。',
    tool_calls: [{ id: 'c1', type: 'function', function: { name: 'powershell', arguments: '{}' } }],
  },
  { role: 'tool', tool_call_id: 'c1', content: 'big.bin 125829120' },
]

test('末条是 tool 时追加一条 user，且不改原数组', () => {
  const before = JSON.stringify(toolTurn)
  const result = injectTrailingUser(toolTurn)

  assert.equal(result.injected, true)
  assert.equal(result.messages.length, toolTurn.length + 1)
  const appended = result.messages[result.messages.length - 1]
  assert.deepEqual(appended, { role: 'user', content: TRAILING_USER_TEXT })
  // 不可变：原数组一个字节都不能动（调用方共享同一份 messages）。
  assert.equal(JSON.stringify(toolTurn), before)
  assert.notEqual(result.messages, toolTurn)
})

test('末条不是 tool 时返回同一个引用（不复制、不改写）', () => {
  const endsWithUser = [...toolTurn.slice(0, 2), { role: 'user', content: '继续' }]
  const same = injectTrailingUser(endsWithUser)
  assert.equal(same.injected, false)
  assert.equal(same.messages, endsWithUser, '不追加时必须返回原引用，调用方靠这个判断有没有改过')

  const endsWithAssistantToolCall = [...toolTurn.slice(0, 2)]
  const second = injectTrailingUser(endsWithAssistantToolCall)
  assert.equal(second.injected, false)
})

test('幂等：连续调两次只加一条（重试与换家会重复装配同一份消息）', () => {
  const once = injectTrailingUser(toolTurn)
  const twice = injectTrailingUser(once.messages)
  assert.equal(once.injected, true)
  assert.equal(twice.injected, false)
  assert.equal(twice.messages, once.messages)
})

test('空数组 / 非数组 / undefined 都不抛错也不追加', () => {
  for (const value of [[], undefined, null, 'not-an-array', 42, {}]) {
    const result = injectTrailingUser(value)
    assert.equal(result.injected, false, `不该追加：${String(value)}`)
    assert.equal(result.messages, value)
  }
})

test('缺这一格 = 开；只有显式 false 才关', () => {
  // 历史 data.json 里没有这个键。写成「=== true 才开」会让所有老装机在没碰过
  // 面板的情况下静默失去兜底。
  assert.equal(trailingUserGuardEnabled(undefined), true)
  assert.equal(trailingUserGuardEnabled(true), true)
  assert.equal(trailingUserGuardEnabled(false), false)
})

test('文案不加长、不带换行、不带插值', () => {
  // 加长或换行会改变这个兜底的性质（从「重新钉住意图」变成第二段任务描述），
  // 插值则会让它带上未经校验的内容。
  assert.equal(TRAILING_USER_TEXT.includes('\n'), false)
  assert.equal(TRAILING_USER_TEXT.length <= 40, true, `文案 ${TRAILING_USER_TEXT.length} 字，超了`)
})

/* ---------------------------------------------------- 挂点顺序（源码门） */

const forwarderSource = readFileSync(
  fileURLToPath(new URL('../../src/main/proxy/forwarder.ts', import.meta.url)),
  'utf-8',
)

test('兜底必须排在观测与压缩之后、分派之前', () => {
  const guard = forwarderSource.indexOf('injectTrailingUser(request.messages)')
  const duplication = forwarderSource.indexOf('measureCrossTurnDuplication(request.messages)')
  const compression = forwarderSource.indexOf('const compression = applyCompression({')
  const beginAttempt = forwarderSource.indexOf('accountRuntime.beginAttempt(account.id)')

  assert.ok(guard > 0 && duplication > 0 && compression > 0 && beginAttempt > 0, '四个挂点都必须存在')
  // 造的这一句不是客户端发来的：混进重复度/存活指标就不测了；排在压缩之后，
  // 也保证它不会被内容压缩器再改一遍。
  assert.ok(duplication < guard, '重复度测量必须先看客户端原样字节')
  assert.ok(compression < guard, '兜底不能被压缩流程改写')
  assert.ok(guard < beginAttempt, '兜底要在开始记账/分派之前完成')
  // 开关读的是设置，不是代码常量。
  assert.match(forwarderSource, /trailingUserGuardEnabled\(config\.trailingUserGuard\)/)
})

test('AppConfig 两处声明都有这一格（本仓有「同一字段声明两遍」的历史）', () => {
  const shared = readFileSync(
    fileURLToPath(new URL('../../src/shared/types.ts', import.meta.url)),
    'utf-8',
  )
  const store = readFileSync(
    fileURLToPath(new URL('../../src/main/store/types.ts', import.meta.url)),
    'utf-8',
  )
  assert.match(shared, /trailingUserGuard\?: boolean/)
  assert.match(store, /trailingUserGuard\?: boolean/)
})

test('面板读得到这个开关（配置写了就得有人读、也看得见）', () => {
  const panel = readFileSync(
    fileURLToPath(new URL('../../src/renderer/src/components/proxy/AdvancedConfig.tsx', import.meta.url)),
    'utf-8',
  )
  assert.match(panel, /trailingUserGuard: proxyConfig\.trailingUserGuard !== false/)
  assert.match(panel, /saveAppConfig\(\{[\s\S]{0,300}?trailingUserGuard: formData\.trailingUserGuard/)
})
