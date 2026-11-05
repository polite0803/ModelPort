import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

/**
 * What the page must say, and what it must be able to do, when the gateway it talks to has
 * no window of its own.
 *
 * Both findings came from opening the Windows shell against the WSL daemon: 导入备份 answered
 * 「读取文件失败（可能过大或没有权限）」 when the real fact was that a headless host has no
 * native dialog, and every theme change threw an uncaught `desktop-only` rejection.
 * The answer to the first one was not better copy - import had to actually work, so the
 * browser picker + upload wiring is fenced here too. A missing capability is acceptable;
 * dressing it up as a different failure is not.
 */
const backup = () =>
  readFileSync(join(root, 'src/renderer/src/components/settings/DataBackup.tsx'), 'utf8')

const headless = () => readFileSync(join(root, 'src/renderer/src/api/headless.ts'), 'utf8')

const apiTable = () => readFileSync(join(root, 'src/shared/api.ts'), 'utf8')

const managementIndex = () =>
  readFileSync(join(root, 'src/main/proxy/routes/management/index.ts'), 'utf8')

const theme = () => readFileSync(join(root, 'src/renderer/src/hooks/useTheme.ts'), 'utf8')

const locale = name =>
  JSON.parse(readFileSync(join(root, 'src/renderer/src/i18n/locales', `${name}.json`), 'utf8'))

function hostErrorTable(source) {
  const block = source.match(/const HOST_ERROR_KEYS: Record<string, string> = \{([^}]*)\}/)
  assert.ok(block, 'the component must keep a host-fact -> message table')
  return Object.fromEntries(
    [...block[1].matchAll(/'([^']+)':\s*'([^']+)'/g)].map(m => [m[1], m[2]]),
  )
}

test('a host fact gets its own sentence, a real file failure keeps the old one', () => {
  const table = hostErrorTable(backup())
  assert.equal(table['desktop-only'], 'desktop-only-export')
  assert.equal(table['upload-unavailable'], 'upload-unavailable')
  assert.match(backup(), /backupErrorText\(cause, 'write-failed'\)/)
  assert.match(backup(), /backupErrorText\(cause, 'read-failed'\)/)

  // Same guard, mutated input: drop the row and the host fact falls back to the
  // file-blaming copy - which is the exact regression this fence exists for.
  assert.equal(
    'desktop-only' in hostErrorTable(backup().replace("'desktop-only': 'desktop-only-export',", '')),
    false,
  )
})

test('import is no longer answered as a host excuse', () => {
  // The import path uploads the operator's file instead; nothing may still claim the
  // gateway "has no file picker" for it, or the screen re-opens the ambiguity.
  assert.equal(backup().includes('desktop-only-import'), false)
  for (const name of ['en-US', 'zh-CN']) {
    assert.equal('desktop-only-import' in locale(name).settings.backup.error, false, `${name} still carries it`)
  }
})

test('the browser transport actually carries the file to the gateway', () => {
  const source = headless()
  assert.match(source, /input\.type = 'file'/, 'the picker is the browser dialog, not a dead button')
  assert.match(source, /\/v1\/management\/backup\/stage/, 'the bytes go to the upload route')
  assert.match(source, /uploadBackup,\s*\}/, 'the wire advertises the capability')
  // One table, two transports: the table must prefer the wire's own answer and still fall
  // back to the IPC channel for the desktop app.
  assert.match(apiTable(), /wire\.uploadBackup \? wire\.uploadBackup\(\) : wire\.invoke\(IpcChannels\.BACKUP_PICK\)/)
})

test('the upload route is mounted, not just written', () => {
  const index = managementIndex()
  assert.match(index, /import backupRouter from '\.\/backup'/)
  assert.equal(index.split('backupRouter').length - 1, 3, 'import + named export + default array')
})

test('both locales carry the two host-fact messages', () => {
  for (const name of ['en-US', 'zh-CN']) {
    const tree = locale(name).settings.backup.error
    assert.ok(tree['desktop-only-export'], `${name} is missing the export message`)
    assert.ok(tree['upload-unavailable'], `${name} is missing the upload message`)
    // The gateway may be too old to have the route, so the sentence has to leave somewhere
    // to go.
    assert.ok(tree['upload-unavailable'].includes('--import-backup'), `${name} does not name the CLI`)
  }
})

test('the remembered secret is fetched before the form and saved only after acceptance', () => {
  const gate = readFileSync(join(root, 'src/renderer/src/components/ConnectGate.tsx'), 'utf8')
  assert.match(gate, /useState\(remote && !hasManagementSecret\(\)\)/, 'one round trip first, no form flash')
  assert.match(gate, /await loadRememberedSecret\(\)/)
  const accept = gate.slice(gate.indexOf('await probeGateway()'), gate.indexOf('await probeGateway()') + 320)
  assert.match(accept, /rememberSecret\(value\)/, 'only a secret the gateway accepted is worth keeping')
  // A rejected secret must be dropped from the keystore too, or every start re-offers it.
  const transport = headless()
  assert.match(transport, /forgetSecret[\s\S]{0,320}forgetGatewaySecret\(location\.origin\)/)
  assert.match(transport, /setGatewaySecret\(location\.origin, secret\)/)
  assert.match(transport, /bridge\.getGatewaySecret\(location\.origin\)/)
})

test('restart names the supervisor command instead of being a silent no-op', () => {
  const source = backup()
  assert.equal(
    /void window\.electronAPI\?\.backup\?\.restart\(\)/.test(source),
    false,
    'void-ing the call is how the button looked like it worked while doing nothing',
  )
  assert.match(source, /handleRestart/)
  assert.match(source, /settings\.backup\.error\.desktop-only-restart/)
  for (const name of ['en-US', 'zh-CN']) {
    assert.ok(
      locale(name).settings.backup.error['desktop-only-restart'].includes('systemctl restart modelport'),
      `${name} does not name the command`,
    )
  }
})

test('the title-bar theme call does not throw at a headless host', () => {
  assert.match(theme(), /code !== 'desktop-only'/, 'only the host fact is swallowed, other errors rethrow')
  assert.equal(
    (theme().match(/setTitleBarTheme\?\.\(/g) ?? []).length,
    1,
    'one call site behind the helper, not one per effect',
  )
})
