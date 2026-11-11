import { test } from 'node:test'
import assert from 'node:assert/strict'

const { loadModule } = await import('../routes/harness.mjs')

test('error/warn 双写：原 console 仍执行，进 sink 的文本已脱敏', async () => {
  const bridge = await loadModule('main/logging/consoleBridge.ts')
  bridge.resetConsoleBridgeForTests()

  const seen: Array<[string, string]> = []
  const printed: string[] = []
  const originalError = console.error
  console.error = (...args: unknown[]) => {
    printed.push(args.map(String).join(' '))
  }
  try {
    bridge.setMainConsoleSink((level: string, message: string) => seen.push([level, message]))
    bridge.installConsoleBridge()

    console.error('upstream failed api_key=sk-abcdef123456')
    console.warn('slow path', 42)
  } finally {
    bridge.resetConsoleBridgeForTests()
    console.error = originalError
  }

  assert.deepEqual(seen.map(([level]) => level), ['error', 'warn'])
  assert.ok(!seen[0][1].includes('sk-abcdef123456'), '凭证必须脱敏后才落盘')
  assert.match(seen[0][1], /\[REDACTED\]/)
  assert.match(seen[1][1], /slow path 42/)

  // 宿主自己的终端输出不能被桥吃掉
  assert.equal(printed.length, 1)
  assert.match(printed[0], /upstream failed/)
})

test('sink 内部再 console.error 不递归', async () => {
  const bridge = await loadModule('main/logging/consoleBridge.ts')
  bridge.resetConsoleBridgeForTests()

  let calls = 0
  const originalError = console.error
  console.error = () => {}
  try {
    bridge.setMainConsoleSink((_level: string, message: string) => {
      calls += 1
      // 这就是 AppLogManager 持久化失败时干的事
      console.error('persist failed:', message)
    })
    bridge.installConsoleBridge()

    console.error('boom')
    console.error('boom again')
  } finally {
    bridge.resetConsoleBridgeForTests()
    console.error = originalError
  }

  assert.equal(calls, 2, '每次外层调用只应触发一次 sink')
})

test('重复 install 只包裹一次', async () => {
  const bridge = await loadModule('main/logging/consoleBridge.ts')
  bridge.resetConsoleBridgeForTests()

  const seen: string[] = []
  const originalError = console.error
  console.error = () => {}
  try {
    bridge.setMainConsoleSink((_level: string, message: string) => seen.push(message))
    bridge.installConsoleBridge()
    bridge.installConsoleBridge()
    console.error('once')
  } finally {
    bridge.resetConsoleBridgeForTests()
    console.error = originalError
  }

  assert.deepEqual(seen, ['once'])
})

test('未注入 sink 时只走原 console，不抛错', async () => {
  const bridge = await loadModule('main/logging/consoleBridge.ts')
  bridge.resetConsoleBridgeForTests()

  const printed: string[] = []
  const originalError = console.error
  console.error = (...args: unknown[]) => {
    printed.push(args.map(String).join(' '))
  }
  try {
    bridge.installConsoleBridge()
    console.error('no sink')
  } finally {
    bridge.resetConsoleBridgeForTests()
    console.error = originalError
  }

  assert.deepEqual(printed, ['no sink'])
})