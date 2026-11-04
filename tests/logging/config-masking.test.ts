import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  maskConfig,
  maskSensitiveObject,
  maskSensitiveValue,
} from '../../src/main/logging/maskConfig.ts'

const { bootstrapStore, loadModule } = await import('../routes/harness.mjs')

/**
 * D1/D3：管理密钥与 apiKeys 明文进日志。
 *
 * 两份出口（配置变更日志、`GET /v1/management/config`）用同一份脱敏规则，
 * 所以这里既钉纯函数口径，也钉「真 store 真写一条日志」的结果。
 */
test('maskConfig 脱敏管理密钥、apiKeys[].key 与 credentials，其余字段原样保留', () => {
  const config = {
    proxyPort: 8080,
    managementApi: { enableManagementApi: true, managementApiSecret: 'mgmt_live_secret' },
    apiKeys: [{ id: 'k1', name: 'primary', key: 'sk-live-abcdef', enabled: true }],
    providers: [{ id: 'p1', name: 'p', credentials: { token: 'upstream-token' } }],
  }

  const masked = maskConfig(config) as {
    proxyPort: number
    managementApi: Record<string, unknown>
    apiKeys: Array<Record<string, unknown>>
    providers: Array<Record<string, unknown>>
  }

  assert.equal(masked.managementApi.managementApiSecret, '***')
  assert.equal(masked.managementApi.enableManagementApi, true)

  // 结构特例：只脱敏 key，id/name/enabled 留下，日志才读得懂是哪把钥匙
  assert.equal(masked.apiKeys[0].key, '***')
  assert.equal(masked.apiKeys[0].id, 'k1')
  assert.equal(masked.apiKeys[0].name, 'primary')
  assert.equal(masked.apiKeys[0].enabled, true)

  // 整个 credentials 对象替换：内层键是用户自定义字段名，逐层递归会把值原样吐出
  assert.equal(masked.providers[0].credentials, '***')

  assert.equal(masked.proxyPort, 8080, '非敏感字段必须原样保留，否则日志失去诊断价值')

  // 不可变：入参不得被就地改写
  assert.equal(config.managementApi.managementApiSecret, 'mgmt_live_secret')
  assert.equal(config.apiKeys[0].key, 'sk-live-abcdef')
})

test('maskSensitiveValue 按键名判定，并对非敏感键递归下钻', () => {
  assert.equal(maskSensitiveValue('abc', 'managementApiSecret'), '***')
  assert.equal(maskSensitiveValue('abc', 'password'), '***')
  assert.equal(maskSensitiveValue('abc', 'proxyPort'), 'abc')
  assert.equal(maskSensitiveValue('abc'), 'abc')
  assert.deepEqual(maskSensitiveObject({ a: 1, b: { password: 'x' } }), { a: 1, b: { password: '***' } })

  // `GET /v1/management/config/:key` 读的就是这一格：键名本身不敏感（managementApi），
  // 值里面躺着密钥。只判键名不递归 = 单键出口明文泄露。
  assert.deepEqual(
    maskSensitiveValue({ enableManagementApi: true, managementApiSecret: 'mgmt_x' }, 'managementApi'),
    { enableManagementApi: true, managementApiSecret: '***' },
  )
})

test('退役的管理面死键不回运行态', async (t) => {
  const harness = await bootstrapStore({
    initialData: {
      config: {
        managementApi: { enableManagementApi: true, managementApiSecret: 's', managementApiPort: 9999 },
      },
    },
  })
  t.after(() => harness.dispose())

  const config = harness.storeManager.getConfig() as unknown as {
    managementApi: Record<string, unknown>
  }
  assert.equal(
    'managementApiPort' in config.managementApi,
    false,
    'managementApiPort 已退役：读侧不能把死键报成可写配置',
  )
  assert.equal(config.managementApi.enableManagementApi, true, '有效字段必须存活')
})

test('ConfigManager.update 的日志不含明文管理密钥', async (t) => {
  const harness = await bootstrapStore()
  t.after(() => harness.dispose())

  const { default: ConfigManager } = await loadModule('main/store/config.ts')

  ConfigManager.update({
    managementApi: { enableManagementApi: true, managementApiSecret: 'mgmt_s3cr3t_first' },
  })
  ConfigManager.update({
    managementApi: { enableManagementApi: true, managementApiSecret: 'mgmt_s3cr3t_second' },
  })

  const logs = harness.storeManager.getLogs()
  const serialized = JSON.stringify(logs)

  assert.ok(
    serialized.includes('Update app configuration'),
    '配置变更必须仍然留痕，否则脱敏被换成了「不记」',
  )
  assert.ok(serialized.includes('***'), '日志里应看到脱敏占位，而不是被整条丢弃')
  assert.equal(serialized.includes('mgmt_s3cr3t_first'), false, '旧密钥不得进日志')
  assert.equal(serialized.includes('mgmt_s3cr3t_second'), false, '新密钥不得进日志')
})
