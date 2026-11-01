import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PERSISTED_PREFERENCE_KEYS,
  buildExportEnvelope,
  containsPersistedSecrets,
  parseExportEnvelope,
  pickPersistedPreferences,
  sanitizePersistedSettings,
} from '../../src/shared/persistedSettings.ts'

const ENVELOPE_WITH_SECRETS = JSON.stringify({
  state: {
    theme: 'dark',
    language: 'zh-CN',
    maxLogs: 10000,
    sidebarCollapsed: false,
    config: {
      proxyPort: 8080,
      apiKeys: [{ id: 'k1', key: 'sk-proj-leaked-leaked-leaked', enabled: true }],
      managementApi: { enableManagementApi: true, managementApiSecret: 'mgmt_deadbeef' },
    },
    setTheme: () => {},
  },
  version: 0,
})

test('偏好白名单只挑出界面键，config 与函数一律不带走', () => {
  const picked = pickPersistedPreferences({ theme: 'dark', language: 'zh-CN', maxLogs: 10000, sidebarCollapsed: false, config: { apiKeys: [] }, setTheme: () => {} })
  assert.deepEqual(Object.keys(picked).sort(), ['language', 'maxLogs', 'sidebarCollapsed', 'theme'])
  assert.equal('config' in picked, false)
})

test('清洗历史落盘串：去掉凭据，保留 zustand 的 { state, version } 形状', () => {
  const cleaned = sanitizePersistedSettings(ENVELOPE_WITH_SECRETS)
  assert.ok(cleaned !== null)
  const parsed = JSON.parse(cleaned as string)
  assert.equal(typeof parsed.version, 'number')
  assert.equal('config' in parsed.state, false)
  assert.equal(parsed.state.theme, 'dark')
})

test('裸偏好对象也能收敛（不假设一定带信封）', () => {
  const cleaned = sanitizePersistedSettings(JSON.stringify({ theme: 'light', apiKeys: ['sk-nope'] }))
  assert.deepEqual(JSON.parse(cleaned as string), { state: { theme: 'light' }, version: 0 })
})

test('解析不了的串返回 null，而不是原样回灌', () => {
  for (const garbage of ['[object Object]', 'not json', '', '   ', 'null', '[1,2,3]']) {
    assert.equal(sanitizePersistedSettings(garbage), null, `应判为不可用：${garbage}`)
  }
})

test('高危键检测：config 或未登记键都算「带着不该有的东西」', () => {
  assert.equal(containsPersistedSecrets(ENVELOPE_WITH_SECRETS), true)
  assert.equal(containsPersistedSecrets(JSON.stringify({ state: { theme: 'dark' }, version: 0 })), false)
  assert.equal(containsPersistedSecrets(JSON.stringify({ state: { someNewThing: 1 }, version: 0 })), true)
})

test('导出件：字符串形态的 settings 里夹着凭据时，导入结果必须已被清洗', () => {
  const envelope = buildExportEnvelope('1.4.10', ENVELOPE_WITH_SECRETS)
  const parsed = parseExportEnvelope(JSON.stringify(envelope))
  assert.ok(parsed !== null)
  const state = JSON.parse((parsed as { settings: string }).settings).state
  assert.equal('config' in state, false)
  assert.equal(state.theme, 'dark')
  assert.equal(parsed.version, '1.4.10')
})

test('导出件：settings 写成对象形态（手工编辑）同样收敛成偏好', () => {
  const parsed = parseExportEnvelope(JSON.stringify({ version: '1.4.10', exportedAt: new Date().toISOString(), settings: { theme: 'light', config: { apiKeys: [1] } } }))
  assert.ok(parsed !== null)
  assert.deepEqual(JSON.parse((parsed as { settings: string }).settings).state, { theme: 'light' })
})

test('导出件：结构不符就拒绝，不静默接受', () => {
  assert.equal(parseExportEnvelope('{"settings":"{\\"theme\\":\\"dark\\"}"}'), null)
  assert.equal(parseExportEnvelope('not json'), null)
  assert.equal(parseExportEnvelope('{"version":"1.0.0","exportedAt":"x","settings":"[object Object]"}'), null)
  assert.equal(parseExportEnvelope('"just a string"'), null)
})

test('白名单本身不含任何凭据类键（防止有人顺手加回去）', () => {
  for (const key of PERSISTED_PREFERENCE_KEYS) {
    assert.equal(/key|secret|token|credential|config|cookie/i.test(key), false, `${key} 不该进持久化白名单`)
  }
})
