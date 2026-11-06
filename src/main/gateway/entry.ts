/**
 * The gateway role of the ModelPort binary: Electron, no window, no tray, no updater.
 *
 * Reached only from the orchestrator (`src/main/index.ts`) when argv carries `--gateway`
 * or `--init-local`. Two hosts serve the same gateway now - this one for "local" mode and
 * the Node daemon bundle for WSL/containers - and they share `bootstrapGateway()` so a
 * feature cannot land on one and silently miss the other.
 *
 * The profile stays `<appData>/modelport`. That is not cosmetic: `safeStorage` seals
 * `store.key` against it (`src/main/index.ts` documents the same pin), so pointing the
 * gateway at a different directory would leave every existing install unable to decrypt
 * its credentials. The *console* uses `<appData>/modelport-shell`, which is why the two
 * processes never share a profile, a lock or a write target.
 */
import { app } from 'electron'
import { existsSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { recordProcessCrash } from '../logging/crashReporter'
import { bindElectronGatewayHost } from '../runtime/electronGatewayHost'
import { storeManager } from '../store/store'
import { bootstrapGateway, installGatewayShutdownHandlers, type GatewayListening } from './bootstrap'
import { planLocalInit, writeLocalGatewayHandshake, writeLocalGatewayStatus } from './localInit'

const INIT_LOCAL = process.argv.includes('--init-local')
const STATUS_FILE = argValue('--status-file')
const HANDSHAKE_FILE = argValue('--handshake-file')

app.setPath('userData', join(app.getPath('appData'), 'modelport'))

// Before any store/credentials read: the old names must be gone by then.
migrateLegacyDirectory(
  join(app.getPath('appData'), 'chat2api'),
  join(app.getPath('appData'), 'modelport'),
  'Electron profile',
)
migrateLegacyDirectory(join(homedir(), '.chat2api'), join(homedir(), '.modelport'), 'data directory')

bindElectronGatewayHost()

// A packaged windowless process has no terminal attached: keep the evidence where the
// console's diagnostics can read it (crash-fallback.ndjson before the store exists).
process.on('uncaughtException', (error) => {
  console.error('[Gateway] Uncaught Exception:', error)
  recordProcessCrash('uncaughtException', error)
})
process.on('unhandledRejection', (reason) => {
  console.error('[Gateway] Unhandled Rejection:', reason)
  recordProcessCrash('unhandledRejection', reason)
})

app.on('ready', () => {
  void run()
})

async function run(): Promise<void> {
  installGatewayShutdownHandlers((signal) => console.log(`[Gateway] ${signal}: stopping`))

  if (INIT_LOCAL) {
    await storeManager.initialize()
    if (storeManager.hasInitializationError()) {
      console.error(`[Gateway] Storage unavailable: ${storeManager.getInitializationError()?.message}`)
      process.exitCode = 1
      app.quit()
      return
    }
    const plan = planLocalInit(storeManager.getConfig())
    storeManager.updateConfig(plan.updates)
    storeManager.flushPendingWrites()
    // The console reads this once and deletes it; the secret itself is never logged.
    if (HANDSHAKE_FILE) writeLocalGatewayHandshake(HANDSHAKE_FILE, { secret: plan.secret })
    console.log(`[Gateway] local init: management API enabled (secret ${plan.generated ? 'generated' : 'kept'})`)
  }

  const result = await bootstrapGateway({
    onListening: (listening) => {
      writeStatus(listening)
      console.log(`[Gateway] ModelPort ${listening.version} listening on ${listening.host}:${listening.port}`)
    },
    onWarning: (line) => console.warn(`[Gateway] ${line}`),
  })

  if (!result.ok) {
    console.error(`[Gateway] ${result.message}`)
    process.exitCode = 1
    app.quit()
  }
}

function writeStatus(listening: GatewayListening): void {
  if (!STATUS_FILE) return
  writeLocalGatewayStatus(STATUS_FILE, {
    version: listening.version,
    pid: process.pid,
    host: listening.host,
    port: listening.port,
    startedAt: Date.now(),
  })
}

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag)
  if (index < 0) return null
  const value = process.argv[index + 1]
  return value && !value.startsWith('--') ? value : null
}

function migrateLegacyDirectory(from: string, to: string, label: string): void {
  if (!existsSync(from) || existsSync(to)) return
  try {
    renameSync(from, to)
    console.log(`[Migration] moved ${label}: ${from} -> ${to}`)
  } catch (error) {
    console.warn(`[Migration] could not move ${label} (${from} -> ${to}); starting fresh:`, error)
  }
}
