/**
 * Headless daemon entry - the gateway without a window.
 *
 * This is the process that lives inside WSL (or any machine whose UI is elsewhere):
 * store, providers, scheduler and the Koa listeners, and nothing else. There is no
 * BrowserWindow, tray, dialog or updater here, which is exactly what makes closing
 * the management UI irrelevant to serving requests.
 *
 * Bundled by `scripts/build-daemon.mjs` into a single CJS file with every runtime
 * dependency inlined (the packaged app carries no node_modules - same rule, same
 * failure if it is broken), and with `__MODELPORT_VERSION__` replaced at build time.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { generateManagementSecret } from '../proxy/middleware/managementAuth'
import { createNodeHost, setHost } from '../runtime/host'
import { storeManager } from '../store/store'
import { bootstrapGateway, installGatewayShutdownHandlers } from '../gateway/bootstrap'

declare const __MODELPORT_VERSION__: string

function resourceRootCandidate(): string {
  const fromEnv = process.env.MODELPORT_RESOURCE_ROOT
  return fromEnv && fromEnv.trim() !== '' ? fromEnv : join(__dirname, 'resources')
}

function resolveResourceRoot(): string {
  const root = resourceRootCandidate()
  // Fail here rather than at the first channel request: an empty resource root is
  // "13 account channels silently missing", which is much harder to notice later.
  if (!existsSync(join(root, 'channel-pack'))) {
    throw new Error(
      `Resource root has no channel-pack: ${root} (set MODELPORT_RESOURCE_ROOT to the directory ` +
        'shipped next to the daemon bundle)',
    )
  }
  return root
}

function resolveWebRoot(): string | undefined {
  const candidate = process.env.MODELPORT_WEB_ROOT && process.env.MODELPORT_WEB_ROOT.trim() !== ''
    ? process.env.MODELPORT_WEB_ROOT
    : join(__dirname, 'renderer')
  return existsSync(join(candidate, 'index.html')) ? candidate : undefined
}

setHost(createNodeHost({
  version: __MODELPORT_VERSION__,
  resourceRoot: resolveResourceRoot(),
  webRoot: resolveWebRoot(),
}))

/**
 * `--print-paths`: prints what this host actually resolved, then exits.
 *
 * Every "the daemon starts but X is missing" report comes down to these five values
 * (version, resource root, channel pack, data directory, keystore), and on WSL they
 * are not where a Windows-trained instinct looks for them. Printing them is cheaper
 * than reasoning about them.
 */
function printPaths(): void {
  const storagePath = storeManager.getStoragePath()
  const root = resourceRootCandidate()
  const packDir = join(root, 'channel-pack')
  const lines = [
    `version       ${__MODELPORT_VERSION__}`,
    `host          node (headless)`,
    `resourceRoot  ${root}`,
    `channelPack   ${packDir} (${existsSync(join(packDir, 'worker.mjs')) ? 'worker.mjs found' : 'MISSING - run npm run build:channel-pack'})`,
    `dataDir       ${storagePath}`,
    `webRoot       ${resolveWebRoot() ?? 'absent (no built UI to serve at /ui)'}`,
    `sealedKey     ${existsSync(join(storagePath, 'store.key')) ? 'store.key present (data.json is machine-bound; this host cannot open it)' : 'absent (data.json will be plaintext here)'}`,
    `keystore      unavailable on this host`,
  ]
  console.log(lines.join('\n'))
}

/**
 * `--init-host`: makes this daemon reachable from another machine (the Windows host).
 *
 * Three settings have to move together and no single one of them works alone: a browser
 * on the host cannot reach a WSL service bound to WSL's own loopback; a non-loopback bind
 * is refused without an API key (the fail-closed rule, enforced in `ProxyServer.start`);
 * and with the management API off there is nothing to talk to. Writing them through
 * `updateConfig` keeps `data.json` the single authority - there is no daemon-only bypass
 * of these switches.
 */
async function initHost(port: string | undefined): Promise<void> {
  await storeManager.initialize()
  if (storeManager.hasInitializationError()) {
    console.error(`[Init] Storage unavailable: ${storeManager.getInitializationError()?.message}`)
    process.exitCode = 1
    return
  }

  const config = storeManager.getConfig()
  const apiKeys = (config.apiKeys ?? []).length > 0
    ? config.apiKeys
    : [{
        id: randomUUID(),
        name: 'WSL 首启生成',
        key: `sk-mp-${randomBytes(24).toString('hex')}`,
        enabled: true,
        createdAt: Date.now(),
        usageCount: 0,
        description: '由 modelport --init-host 生成，可在 API Keys 页面重新生成',
      }]
  const managementApiSecret = config.managementApi?.managementApiSecret || generateManagementSecret()

  storeManager.updateConfig({
    ...(port ? { proxyPort: Number(port) } : {}),
    proxyHost: '0.0.0.0',
    apiKeys,
    managementApi: { enableManagementApi: true, managementApiSecret },
  })
  storeManager.flushPendingWrites()

  const effectivePort = port ? Number(port) : config.proxyPort
  // Machine-readable, one line: the console's WSL install parses this instead of scraping
  // the human block below (a wording change must not silently break first install).
  console.log(`MODELPORT_HANDSHAKE ${JSON.stringify({
    port: effectivePort,
    secret: managementApiSecret,
    apiKey: apiKeys[0].key,
  })}`)
  console.log(
    `[Init] gateway reachable from the host machine at http://127.0.0.1:${effectivePort}/ui\n` +
      `[Init]   API key     ${apiKeys[0].key}\n` +
      `[Init]   management  ${managementApiSecret}\n` +
      '[Init] Both are written into data.json once and are shown here once; rotate them from the UI.\n' +
      '[Init] The daemon listens on 0.0.0.0 because a host browser cannot reach a loopback-only\n' +
      '[Init] listener inside WSL. Keep the API key set: without any key the server refuses to\n' +
      '[Init] bind beyond loopback. Restart the service for the new bind to take effect.',
  )
}

/**
 * `--import-backup <path>`: the D7 handoff. A backup exported on the desktop carries the
 * settings and credentials into a keystore-less host, where they land as plaintext by
 * design (and say so). The password is read from stdin or `MODELPORT_BACKUP_PASSWORD`,
 * never from argv: command lines end up in shell history and in `ps` output.
 */
async function importBackup(backupPath: string | undefined, mode: 'replace' | 'merge'): Promise<void> {
  if (!backupPath) {
    console.error('[Import] --import-backup needs a file path')
    process.exitCode = 2
    return
  }

  const { stageBackupFile, unlockBackup, applyBackup } = await import('../backup/service')

  await storeManager.initialize()
  if (storeManager.hasInitializationError()) {
    console.error(`[Import] Storage unavailable: ${storeManager.getInitializationError()?.message}`)
    process.exitCode = 1
    return
  }

  const staged = stageBackupFile(backupPath)
  if (staged.canceled || !staged.token) {
    console.error(`[Import] ${staged.error ?? 'could not read the backup file'}`)
    process.exitCode = 1
    return
  }

  // `unlock` keeps the same one-shot token: it fills in the plaintext bundle behind it
  // rather than issuing a new handle.
  const token = staged.token
  if (staged.encrypted) {
    const password = await readBackupPassword()
    if (password === null) {
      console.error('[Import] The backup is password-sealed but no password arrived (stdin or MODELPORT_BACKUP_PASSWORD)')
      process.exitCode = 2
      return
    }
    const unlocked = unlockBackup(token, password)
    if (!unlocked.ok) {
      console.error(`[Import] ${unlocked.error ?? 'unlock failed'}`)
      process.exitCode = 1
      return
    }
  }

  const applied = await applyBackup(token, mode)
  if (!applied.ok) {
    console.error(`[Import] ${applied.error ?? 'apply failed'}`)
    process.exitCode = 1
    return
  }

  storeManager.flushPendingWrites()
  const skipped = applied.skipped ?? []
  console.log(
    `[Import] ${mode === 'replace' ? '覆盖' : '合并'}导入完成：providers=${applied.counts?.providers ?? 0} ` +
      `accounts=${applied.counts?.accounts ?? 0} routes=${applied.counts?.routes ?? 0}` +
      (skipped.length > 0 ? ` skipped=${skipped.join(',')}` : ''),
  )
  if (storeManager.isCredentialEncryptionDegraded()) {
    console.log(
      `[Import] 这台主机没有系统密钥库，凭据以明文写在 ${storeManager.getStoragePath()}/data.json。` +
        '请限制该目录权限（chmod 700）。',
    )
  }
  console.log('[Import] Restart the service: providers and accounts are mirrored at startup.')

  // An import is "the backup's config wins" - that is what `restoreConfig` means, and it
  // includes the bind address, the API keys and the management switch. On a headless host
  // those three are what makes it reachable at all, so say what the file now says rather
  // than letting the operator discover it from a connection timeout.
  const after = storeManager.getConfig()
  console.log(
    `[Import] 现在 data.json 里的生效值：proxyHost=${after.proxyHost} proxyPort=${after.proxyPort} ` +
      `apiKeys=${(after.apiKeys ?? []).length} managementApi=${after.managementApi?.enableManagementApi ? 'on' : 'off'}`,
  )
  if (!after.proxyHost || after.proxyHost === '127.0.0.1' || !after.managementApi?.enableManagementApi) {
    console.log('[Import] 备份来自桌面安装时，这几项会回到出厂形态：宿主打不开、管理面也是关的。' +
      '需要远程管理就再执行一次 `--init-host`（它只补缺的那部分，不覆盖已有密钥与口令）。')
  }
}

async function readBackupPassword(): Promise<string | null> {
  const fromEnv = process.env.MODELPORT_BACKUP_PASSWORD
  if (fromEnv && fromEnv.trim() !== '') return fromEnv.trim()
  if (process.stdin.isTTY) {
    console.log('[Import] Backup password (input is not hidden here; prefer piping it or the env var):')
  }
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  const line = Buffer.concat(chunks).toString('utf8').split('\n')[0]?.trim() ?? ''
  return line === '' ? null : line
}

if (process.argv.includes('--print-paths')) {
  printPaths()
} else if (process.argv.includes('--import-backup')) {
  const index = process.argv.indexOf('--import-backup')
  void importBackup(
    process.argv[index + 1],
    process.argv.includes('--merge') ? 'merge' : 'replace',
  ).catch((error: unknown) => {
    console.error('[Import] Failed:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
} else if (process.argv.includes('--init-host')) {
  const portIndex = process.argv.indexOf('--port')
  void initHost(portIndex >= 0 ? process.argv[portIndex + 1] : undefined).catch((error: unknown) => {
    console.error('[Init] Failed:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
} else {
  main().catch((error: unknown) => {
    console.error('[Daemon] Startup failed:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}

async function main(): Promise<void> {
  installGatewayShutdownHandlers((signal) => console.log(`[Daemon] ${signal}: stopping`))

  const result = await bootstrapGateway({
    onListening: ({ version, host, port }) => {
      console.log(`[Daemon] ModelPort ${version} listening on ${host}:${port}`)
    },
    onWarning: (line) => console.warn(`[Daemon] ${line}`),
  })

  if (!result.ok) {
    console.error(
      result.code === 'storage-unavailable'
        ? `[Daemon] Storage unavailable: ${result.message}`
        : `[Daemon] ${result.message}`,
    )
    process.exitCode = 1
  }
}
