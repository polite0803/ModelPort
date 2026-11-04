/**
 * 备份信封的解析与摘要（`shared/backup.ts`）。
 *
 * 这层的职责是「一份文件能不能被当成备份」，以及导入确认框上那几个数字。判错的两种
 * 方向代价不同：
 * - 放行不该放行的（别人家的 JSON、更新版本的备份）→ 覆盖式导入会把账号表清成垃圾；
 * - 拒掉本该放行的（老备份缺某个可选块）→ 换机迁移直接失败。
 * 所以下面的用例把「必须有」和「必须容忍」两边都钉住。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  BACKUP_FORMAT,
  BACKUP_SEALED_FORMAT,
  BACKUP_VERSION,
  mergeById,
  mergeNamedTables,
  parseBackupDocument,
  summarizeBackup,
  type BackupBundle,
} from '../../src/shared/backup.ts'

function bundle(overrides: Partial<BackupBundle> = {}): BackupBundle {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    appVersion: '1.7.1',
    createdAt: '2026-11-04T02:00:00.000Z',
    platform: 'win32',
    scope: { includeStatistics: true, includeLogs: false },
    data: {},
    ...overrides,
  }
}

test('非 JSON / 非对象 / 别家的 JSON 一律明确失败', () => {
  assert.deepEqual(parseBackupDocument('not json'), { kind: 'error', reason: 'not-json' })
  assert.deepEqual(parseBackupDocument('"text"'), { kind: 'error', reason: 'not-object' })
  assert.deepEqual(parseBackupDocument('{"format":"something-else","version":1,"data":{}}'), {
    kind: 'error',
    reason: 'wrong-format',
  })
  // `data` 不是对象同样是外形不对：后续所有读取都以它为根。
  assert.deepEqual(parseBackupDocument(JSON.stringify({ ...bundle(), data: [] })), {
    kind: 'error',
    reason: 'wrong-format',
  })
})

test('版本高于当前应用时拒绝，低于当前版本放行（老备份要能导入）', () => {
  const newer = JSON.stringify(bundle({ version: BACKUP_VERSION + 1 }))
  assert.deepEqual(parseBackupDocument(newer), { kind: 'error', reason: 'unsupported-version' })

  const older = JSON.stringify({ ...bundle(), version: BACKUP_VERSION - 1 })
  const parsed = parseBackupDocument(older)
  assert.equal(parsed.kind, 'bundle')
})

test('封装件先认外层，不在解析阶段尝试解密', () => {
  const sealed = JSON.stringify({
    format: BACKUP_SEALED_FORMAT,
    version: BACKUP_VERSION,
    sealed: {
      algorithm: 'aes-256-gcm',
      kdf: 'scrypt',
      n: 16384,
      r: 8,
      p: 1,
      salt: 'c2FsdA==',
      iv: 'aXY=',
      tag: 'dGFn',
      ciphertext: 'Y2lwaGVy',
    },
  })
  const parsed = parseBackupDocument(sealed)
  assert.equal(parsed.kind, 'sealed')
})

test('摘要数出真正的条目数，凭据缺失与跨平台都要报警', () => {
  const preview = summarizeBackup(
    bundle({
      data: {
        providers: [{ id: 'a' }, { id: 'b' }],
        accounts: [{ id: 'x', credentials: {} }, { id: 'y', credentials: {} }],
        config: { routes: { auto: {} }, modelMappings: { alias1: {} }, apiKeys: [{ id: 'k' }] },
        userModelMarks: { a: {} },
        channels: { accounts: [{ id: 'c1' }] },
        requestLogs: [{ id: 'r1' }, { id: 'r2' }],
      },
    }),
    { platform: 'darwin', appVersion: '1.7.1' },
  )

  assert.deepEqual(preview.counts, {
    providers: 2,
    accounts: 2,
    accountsWithCredentials: 0,
    routes: 1,
    modelMappings: 1,
    apiKeys: 1,
    userModelMarks: 1,
    channelAccounts: 1,
    requestLogs: 2,
    appLogs: 0,
  })
  assert.deepEqual(preview.warnings.sort(), ['different-platform', 'no-credentials'])
})

test('备份比当前版本新时给出提示，不比预发布序号', () => {
  const newer = summarizeBackup(bundle({ appVersion: '1.8.0' }), { platform: 'win32', appVersion: '1.7.9' })
  assert.ok(newer.warnings.includes('newer-app-version'))

  const sameMajor = summarizeBackup(bundle({ appVersion: '1.7.1-beta.2' }), {
    platform: 'win32',
    appVersion: '1.7.1',
  })
  assert.ok(!sameMajor.warnings.includes('newer-app-version'))
})

test('mergeById 本地优先：同 id 不被备份覆盖，缺的才补', () => {
  const local = [
    { id: 'p1', name: 'local-p1' },
    { id: 'p2', name: 'local-p2' },
  ]
  const incoming = [
    { id: 'p1', name: 'backup-p1' },
    { id: 'p3', name: 'backup-p3' },
  ]
  const merged = mergeById(local, incoming, (item) => item.id)
  assert.equal(merged.added, 1)
  assert.deepEqual(
    merged.next.map((item) => item.name),
    ['local-p1', 'local-p2', 'backup-p3'],
  )
})

test('mergeById 丢弃没有 id 的条目，不让它变成重复行', () => {
  const merged = mergeById<{ id?: string }>([], [{ id: undefined }, { id: 'a' }], (item) => item.id)
  assert.equal(merged.added, 1)
  assert.equal(merged.next.length, 1)
})

test('mergeNamedTables 只补缺的名字：已有的别名不被备份改写', () => {
  const merged = mergeNamedTables({ aliasA: { actualModel: 'local' } }, {
    aliasA: { actualModel: 'backup' },
    aliasB: { actualModel: 'backup' },
  })
  assert.equal(merged.added, 1)
  assert.deepEqual(merged.next, {
    aliasA: { actualModel: 'local' },
    aliasB: { actualModel: 'backup' },
  })
})
