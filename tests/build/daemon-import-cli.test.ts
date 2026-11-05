import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { sealBackup } from '../../src/main/backup/crypto.ts'
import { BACKUP_FORMAT, BACKUP_VERSION } from '../../src/shared/backup.ts'

/**
 * D7 的落地判据：**命令行能不能把一份桌面导出的备份装进无密钥库主机**。
 *
 * 引擎在 `tests/backup/headless-import.test.ts` 里已经证明能在无密钥库下把凭据落成明文；
 * 这条补的是「人怎么调到它」——真起一次 daemon 的 `--import-backup`，跑的是发布产物本身
 * （`out/daemon/modelport-daemon.cjs`，由 `npm run gate` 的 build:daemon 产出）。
 * 口令走 env / stdin，绝不进 argv：命令行会留在 shell 历史与 `ps` 里。
 */
const BUNDLE = join('out', 'daemon', 'modelport-daemon.cjs')

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'modelport-import-cli-'))
  mkdirSync(join(home, '.modelport'), { recursive: true })
  return home
}

function writeSealedBackup(home: string, password: string, secret: string): string {
  const bundle = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    appVersion: '1.7.3',
    createdAt: new Date().toISOString(),
    platform: 'win32',
    scope: { includeStatistics: false, includeLogs: false },
    data: {
      config: {},
      providers: [{ id: 'prov-cli', name: 'CLI Provider', type: 'custom', enabled: true }],
      accounts: [{ id: 'acct-cli', providerId: 'prov-cli', name: 'cli', credentials: { apiKey: secret } }],
    },
  }
  const file = join(home, 'modelport-backup.json')
  writeFileSync(file, JSON.stringify(sealBackup(JSON.stringify(bundle), password)), 'utf8')
  return file
}

function runDaemon(args: string[], env: Record<string, string>) {
  return spawnSync(process.execPath, [BUNDLE, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    // An empty, immediately-closed stdin: without it a child that waits on the terminal
    // would inherit the test runner's pipe and stall until the timeout.
    input: '',
    timeout: 60_000,
  })
}

test('the daemon bundle exists (npm run gate builds it)', () => {
  assert.ok(existsSync(BUNDLE), 'run npm run build:daemon first')
})

test('--import-backup installs a password-sealed backup and the key lands readable', () => {
  const home = makeHome()
  const secret = `sk-mp-cli-proof-${'x'.repeat(8)}`
  const file = writeSealedBackup(home, 'correct horse', secret)

  const run = runDaemon(['--import-backup', file], {
    HOME: home,
    USERPROFILE: home,
    MODELPORT_BACKUP_PASSWORD: 'correct horse',
  })
  assert.equal(run.status, 0, `stdout=${run.stdout}\nstderr=${run.stderr}`)
  assert.match(run.stdout, /导入完成/)
  assert.match(run.stdout, /明文/, 'the plaintext consequence must be stated at import time')

  const stored = JSON.parse(readFileSync(join(home, '.modelport', 'data.json'), 'utf8')) as {
    accounts?: Array<{ id?: string; credentials?: Record<string, string> }>
  }
  const account = (stored.accounts ?? []).find(item => item.id === 'acct-cli')
  assert.equal(account?.credentials?.apiKey, secret, 'the credential survived the handoff as readable plaintext')

  // The import is "the backup's config wins", which also resets the bind address, the keys
  // and the management switch - the three that decide whether a host can reach the daemon.
  // It has to say so, or the operator's next symptom is a connection timeout.
  assert.match(run.stdout, /现在 data\.json 里的生效值：proxyHost=/)
  assert.match(run.stdout, /--init-host/, 'the fix-up step must be named on the same screen')
})

test('a sealed backup without a password stops with a reason instead of half-importing', () => {
  const home = makeHome()
  const file = writeSealedBackup(home, 'needed', 'sk-mp-never-landed')

  const run = runDaemon(['--import-backup', file], {
    HOME: home,
    USERPROFILE: home,
    MODELPORT_BACKUP_PASSWORD: '',
  })
  // stdin is closed with no data, so the password cannot arrive; the data file must stay
  // exactly as it was - a refused import is not a partial one.
  assert.equal(run.status, 2, `stdout=${run.stdout}\nstderr=${run.stderr}`)
  assert.match(run.stdout + run.stderr, /no password/)
  const data = readFileSync(join(home, '.modelport', 'data.json'), 'utf8')
  assert.ok(!data.includes('sk-mp-never-landed'), 'nothing may be written by a refused import')
})

test('the CLI source is reachable from the repo root used by the test runner', () => {
  // Guards against the bundle being built from a different tree than the sources checked here.
  assert.ok(
    existsSync(fileURLToPath(new URL('../../src/main/daemon/entry.ts', import.meta.url))),
    'src/main/daemon/entry.ts must exist next to the built bundle',
  )
})
