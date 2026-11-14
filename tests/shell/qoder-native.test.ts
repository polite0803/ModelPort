import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildCreatePayload,
  buildUpdatePayload,
  connectQoderBridge,
  decideQoderWrites,
  decodeCdpMessages,
  encodeCdpMessage,
  normalizeEndpointUrl,
  normalizeQoderConfigs,
  planQoderNative,
  qoderEndpointUrl,
  verifyQoderReadback,
  QODER_DEFAULT_CONTEXT_WINDOW,
  QODER_NATIVE_MAX_MODELS,
} from '../../src/shell/qoderNative.ts'
import type { ClientSyncModel } from '../../src/shared/clientSync.ts'

const model = (name: string, contextWindow: number | null, displayName = name): ClientSyncModel => ({
  name,
  displayName,
  contextWindow,
})

const DAILY = model('daily', 1000000, '日常')

/**
 * The payload shapes are pinned to the key sets Qoder's own validators accept (asar
 * `LZr` for the create request, `y$e` for one model): exact keys, no extras - Qoder
 * rejects a payload with an unexpected field, so "one more helpful field" is a broken
 * write, not a nicer one.
 */
test('create payload carries exactly the keys the Qoder validator accepts', () => {
  const payload = buildCreatePayload({ endpointUrl: 'http://127.0.0.1:8080/v1', apiKey: 'sk-test', models: [DAILY] })
  assert.deepEqual(Object.keys(payload).sort(), ['apiKey', 'connection', 'models'])
  assert.deepEqual(Object.keys(payload.connection).sort(), ['displayName', 'endpointUrl', 'kind', 'protocol'])
  assert.equal(payload.connection.kind, 'custom-endpoint')
  assert.equal(payload.connection.protocol, 'openai')
  assert.deepEqual(Object.keys(payload.models[0]).sort(), [
    'availableContextWindows',
    'defaultContextWindow',
    'efforts',
    'isReasoning',
    'isVision',
    'modelDisplayName',
    'modelKey',
    'typeDisplayName',
    'typeKey',
  ])
  assert.equal(payload.models[0].modelKey, 'daily')
  assert.equal(payload.models[0].modelDisplayName, '日常')
  assert.equal(payload.models[0].typeKey, null)
  assert.equal(payload.models[0].typeDisplayName, 'Custom')
  assert.deepEqual(payload.models[0].availableContextWindows, [1000000])
  assert.equal(payload.models[0].defaultContextWindow, 1000000)
  assert.deepEqual(payload.models[0].efforts, [])
})

test('a model the gateway publishes no window for falls back to the Qoder preset', () => {
  const entry = buildCreatePayload({
    endpointUrl: 'http://127.0.0.1:8080/v1',
    apiKey: '',
    models: [model('mystery', null)],
  }).models[0]
  assert.deepEqual(entry.availableContextWindows, [QODER_DEFAULT_CONTEXT_WINDOW])
  assert.equal(entry.defaultContextWindow, QODER_DEFAULT_CONTEXT_WINDOW)
  // The validator demands a positive int - the fallback is Qoder's own default preset,
  // never 0, never a fabricated per-model guess.
  assert.ok(Number.isSafeInteger(entry.defaultContextWindow) && entry.defaultContextWindow > 0)
})

test('update payload updates one model and keeps the existing key (no apiKey field)', () => {
  const payload = buildUpdatePayload({ providerId: 'qoder-custom-abc', model: DAILY })
  assert.deepEqual(Object.keys(payload).sort(), [
    'availableContextWindows',
    'defaultContextWindow',
    'efforts',
    'isReasoning',
    'isVision',
    'modelDisplayName',
    'modelKey',
    'reference',
  ])
  assert.deepEqual(payload.reference, { kind: 'custom', providerId: 'qoder-custom-abc' })
  assert.ok(!('apiKey' in payload), 'update with no apiKey keeps the stored credential')
})

test('endpoint url appends /v1 once and folds trailing slashes for comparison', () => {
  assert.equal(qoderEndpointUrl('http://127.0.0.1:8080'), 'http://127.0.0.1:8080/v1')
  assert.equal(qoderEndpointUrl('https://mp.example.test/'), 'https://mp.example.test/v1')
  assert.equal(normalizeEndpointUrl('HTTP://Host:8443/v1/'), 'http://host:8443/v1')
})

test('planner: no install, running app, and ready are three different rows', () => {
  const install = { id: 'qoder-cn' as const, exePath: 'C:/Programs/Qoder CN/Qoder CN.exe' }
  const notInstalled = planQoderNative({ id: 'qoder-cn', install: null, running: false, hasKey: true, origin: 'http://127.0.0.1:8080', models: [DAILY] })
  assert.equal(notInstalled.state, 'not-installed')
  assert.match(notInstalled.reason ?? '', /Qoder CN/)
  const running = planQoderNative({ id: 'qoder-cn', install, running: true, hasKey: true, origin: 'http://127.0.0.1:8080', models: [DAILY] })
  assert.equal(running.state, 'app-running')
  assert.match(running.manualStep ?? '', /退出 Qoder/)
  const ready = planQoderNative({ id: 'qoder-cn', install, running: false, hasKey: true, origin: 'http://127.0.0.1:8080', models: [DAILY] })
  assert.equal(ready.state, 'ready')
  assert.equal(ready.manualStep, null)
  assert.deepEqual(ready.changes.map(change => change.label), ['端点地址', '模型清单'])
  assert.equal(ready.changes[0].after, 'http://127.0.0.1:8080/v1')
})

test('planner: overflow past 32 models is reported, never silently dropped', () => {
  const many = Array.from({ length: QODER_NATIVE_MAX_MODELS + 3 }, (_, i) => model(`m${i}`, 1000000))
  const ready = planQoderNative({ id: 'qoder', install: { id: 'qoder', exePath: 'Qoder.exe' }, running: false, hasKey: true, origin: 'http://h', models: many })
  assert.equal(ready.unserved.length, 3)
  assert.deepEqual(ready.unserved, ['m32', 'm33', 'm34'])
  assert.match(ready.manualStep ?? '', /32 个模型/)
})

test('planner: without a canonical key the row says the key stays empty', () => {
  const ready = planQoderNative({ id: 'qoder', install: { id: 'qoder', exePath: 'Qoder.exe' }, running: false, hasKey: false, origin: 'http://h', models: [DAILY] })
  assert.equal(ready.state, 'ready')
  assert.match(ready.manualStep ?? '', /没有规范 key/)
  assert.match(ready.manualStep ?? '', /API Key/)
})

test('cdp framing: NUL-delimited JSON survives chunks, keeps the tail, drops corrupt frames', () => {
  assert.equal(encodeCdpMessage({ id: 1, method: 'Target.getTargets' }), '{"id":1,"method":"Target.getTargets"}\0')
  const first = decodeCdpMessages('{"id":1}\0{"id":')
  assert.equal(first.messages.length, 1)
  assert.equal(first.rest, '{"id":')
  const second = decodeCdpMessages(first.rest + '2}\0nonsense\0{"id":3}\0')
  assert.equal(second.messages.length, 2)
  assert.deepEqual(second.messages[1], { id: 3 })
  assert.equal(second.rest, '')
})

function modelRow(providerId: string, endpointUrl: string, modelKey: string, protocolStyle = 'openai') {
  return {
    configReference: { kind: 'custom', providerId },
    endpointUrl,
    protocolStyle,
    modelKey,
  }
}

test('config list folds profile rows into one group per config', () => {
  const groups = normalizeQoderConfigs([
    modelRow('p1', 'http://127.0.0.1:8080/v1/', 'daily'),
    modelRow('p1', 'http://127.0.0.1:8080/v1/', 'work'),
    { configReference: { kind: 'custom', providerId: 'p2' }, endpointUrl: 'http://other/v1', models: [{ id: 'a' }, { model: 'b' }] },
    null,
    'junk',
  ])
  assert.equal(groups.length, 2)
  const p1 = groups.find(group => group.providerId === 'p1')
  assert.ok(p1)
  assert.deepEqual([...p1.modelKeys].sort(), ['daily', 'work'])
  assert.equal(p1.protocolStyle, 'openai')
  const p2 = groups.find(group => group.providerId === 'p2')
  assert.ok(p2)
  assert.deepEqual([...p2.modelKeys].sort(), ['a', 'b'])
})

test('decide: no config at this endpoint creates one with everything; a matching one only gets the missing', () => {
  const endpoint = 'http://127.0.0.1:8080/v1'
  const models = [model('daily', 1000000), model('work', 500000)]
  const fresh = decideQoderWrites([], endpoint, models)
  assert.deepEqual(fresh, { create: true, providerId: null, toAdd: models })
  const existing = decideQoderWrites(normalizeQoderConfigs([modelRow('p9', 'HTTP://127.0.0.1:8080/v1', 'daily')]), endpoint, models)
  assert.equal(existing.create, false)
  assert.equal(existing.providerId, 'p9')
  assert.deepEqual(existing.toAdd.map(item => item.name), ['work'])
  const complete = decideQoderWrites(
    normalizeQoderConfigs([modelRow('p9', endpoint, 'daily'), modelRow('p9', endpoint, 'work')]),
    endpoint,
    models,
  )
  assert.deepEqual(complete.toAdd, [])
  // A same-address config speaking another protocol is not ours to touch.
  const otherProtocol = decideQoderWrites(normalizeQoderConfigs([modelRow('p9', endpoint, 'daily', 'anthropic')]), endpoint, models)
  assert.equal(otherProtocol.create, true)
})

test('readback: only models the list can see count as written', () => {
  const endpoint = 'http://127.0.0.1:8080/v1'
  const after = normalizeQoderConfigs([modelRow('p9', endpoint, 'daily'), modelRow('p9', endpoint, 'work')])
  const { verifiedModels, failedModels } = verifyQoderReadback(after, endpoint, [model('daily', 1), model('work', 1), model('gone', 1)])
  assert.deepEqual(verifiedModels, ['daily', 'work'])
  assert.deepEqual(failedModels, [{ model: 'gone', error: '写入后回读未确认' }])
})

type AnyRecord = Record<string, unknown>

/** A CDP server fake that answers each written frame immediately, by id. */
function cdpServerFake(pages: Array<{ hasBridge: boolean }>) {
  const dataListeners: Array<(chunk: Buffer) => void> = []
  const closeListeners: Array<() => void> = []
  const written: string[] = []
  const push = (message: object) => {
    const frame = Buffer.from(`${JSON.stringify(message)}\0`, 'utf8')
    for (const listener of dataListeners) listener(frame)
  }
  const transport = {
    write(chunk: string) {
      written.push(chunk)
      const message = JSON.parse(chunk.slice(0, -1)) as AnyRecord
      if (message.method === 'Target.getTargets') {
        push({ id: message.id, result: { targetInfos: pages.map((page, index) => ({ targetId: `t${index}`, type: 'page', url: `file:///win${index}.html` })).concat([{ targetId: 'worker', type: 'service_worker', url: '' }]) } })
      } else if (message.method === 'Target.attachToTarget') {
        push({ id: message.id, result: { sessionId: `s-${String(message.params && (message.params as AnyRecord).targetId)}` } })
      } else if (message.method === 'Runtime.evaluate') {
        const index = Number(String(message.sessionId ?? '').replace('s-t', ''))
        const value = pages[index]?.hasBridge === true ? 'ready' : 'absent'
        push({ id: message.id, result: { result: { type: 'string', value } } })
      } else if (message.method === 'Target.detachFromTarget') {
        push({ id: message.id, result: {} })
      }
    },
    onData(listener: (chunk: Buffer) => void) {
      dataListeners.push(listener)
    },
    onClose(listener: () => void) {
      closeListeners.push(listener)
    },
    close() {},
  }
  return { transport, written }
}

test('connect: probes page targets and settles on the one carrying the bridge', async () => {
  const { transport, written } = cdpServerFake([{ hasBridge: false }, { hasBridge: true }])
  const client = await connectQoderBridge(transport, 5000)
  const methods = written.map(frame => (JSON.parse(frame.slice(0, -1)) as AnyRecord).method as string)
  assert.equal(methods[0], 'Target.getTargets')
  assert.ok(methods.includes('Target.attachToTarget'))
  assert.ok(methods.includes('Target.detachFromTarget'), 'the window without the bridge is released again')
  assert.ok(methods.includes('Runtime.evaluate'))
  const session = await client.evaluate('1')
  assert.ok(session !== undefined)
})

test('connect: a windowless app fails with a named cause instead of hanging', async () => {
  const { transport } = cdpServerFake([])
  await assert.rejects(
    () => connectQoderBridge(transport, 1200),
    /原生模型接口/,
  )
})
