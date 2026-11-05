import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { register } from 'node:module'

// `backup/service.ts` still talks to the Electron shell for its dialog half, so the
// src/ loader hooks are needed here; the import engine itself is dialog-free.
register(new URL('../routes/loader-hooks.mjs', import.meta.url))

import { BACKUP_FORMAT, BACKUP_VERSION } from '../../src/shared/backup.ts'

/**
 * 裁定 2026-11-05：WSL 侧的凭据落盘形态 = 明文 + 显式降级声明，配置搬迁走**备份导出/导入**。
 *
 * 这条通路本来就有跨机器设计（`backup/crypto.ts`：口令由用户给，因为 `store.key` 换机解不开），
 * 所以它能不能落到无密钥库主机，是个可测事实，不是推测。本用例证明三件事：
 * 1. 导入引擎不需要窗口（`stageBackupFile` 是 `pickBackupFile` 去掉对话框的那半）；
 * 2. 落盘的 `data.json` 是**明文 JSON**，凭据在里面可读——这正是 D7 的形态；
 * 3. 这个缺席是被声明的：`isCredentialEncryptionDegraded()` 必须为真，界面/日志才有的说。
 */
test('a backup applies on a keystore-less host and lands as plaintext', async () => {
  const home = mkdtempSync(join(tmpdir(), 'modelport-headless-import-'))
  mkdirSync(join(home, '.modelport'), { recursive: true })
  process.env.USERPROFILE = home
  process.env.HOME = home

  const { setHost, createNodeHost } = await import('../../src/main/runtime/host.ts')
  setHost(createNodeHost({ version: '0.0.0-test', resourceRoot: home }))

  const { storeManager } = await import('../../src/main/store/store.ts')
  await storeManager.initialize()
  assert.equal(storeManager.hasInitializationError(), false, 'fresh plaintext store must open')

  const secret = 'sk-mp-headless-import-proof'
  const bundle = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    appVersion: '1.7.3',
    createdAt: new Date().toISOString(),
    platform: 'win32',
    scope: { includeStatistics: false, includeLogs: false },
    data: {
      config: storeManager.getConfig(),
      providers: [{ id: 'prov-imported', name: 'Imported', type: 'custom', enabled: true }],
      accounts: [{ id: 'acct-imported', providerId: 'prov-imported', name: 'acct', credentials: { apiKey: secret } }],
    },
  }
  const filePath = join(home, 'modelport-backup.json')
  writeFileSync(filePath, JSON.stringify(bundle), 'utf8')

  const { stageBackupFile, applyBackup } = await import('../../src/main/backup/service.ts')
  const staged = stageBackupFile(filePath)
  assert.equal(staged.canceled, false, 'staging must succeed without any dialog')
  assert.ok(staged.token, 'staging returns a one-shot import token')

  const applied = await applyBackup(staged.token!, 'replace')
  assert.equal(applied.ok, true, `apply failed: ${JSON.stringify(applied)}`)

  // Read the bytes as they now sit on disk: the whole point of D7 is the *form*.
  const raw = JSON.parse(readFileSync(join(home, '.modelport', 'data.json'), 'utf8')) as {
    accounts?: Array<{ credentials?: Record<string, string> }>
  }
  const stored = raw.accounts?.find(account => account.id === 'acct-imported')?.credentials?.apiKey
  assert.equal(stored, secret, 'the credential is stored as readable plaintext on this host')
  assert.ok(
    storeManager.isCredentialEncryptionDegraded(),
    'plaintext storage must be flagged, so the UI and the daemon log can say it out loud',
  )

  // The engine still encrypts when the host *can* seal; that is what makes this the
  // host's answer rather than a switch someone turned off.
  assert.ok(!existsSync(join(home, '.modelport', 'store.key')), 'no sealed key on a keystore-less host')
})
