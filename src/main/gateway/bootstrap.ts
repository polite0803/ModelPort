/**
 * The gateway startup sequence, shared by every host that serves it.
 *
 * Two hosts run this: the headless Node daemon (WSL, containers) and the windowless
 * Electron process the local console spawns. Keeping one function is what stops the two
 * from drifting - a provider mirror, a probe cache prime or the auto-provision call added
 * to one and not the other is a difference nobody notices until a feature works on one
 * host only.
 *
 * The host bindings must already be set: this module never decides which process it is in.
 */
import { getHost } from '../runtime/host'
import { storeManager } from '../store/store'
import { registerIpcHandlers } from '../ipc/handlers'
import { proxyServer } from '../proxy/server'
import { scheduler } from '../scheduler/Scheduler'
import { configureModelListRefresh } from '../scheduler/modelListRefresh'
import { aggregateProviderManager } from '../providers/aggregate'
import { primeModelProbeCache } from '../providers/modelProbeStore'
import { shutdownCatalogBatchJobs } from '../providers/modelCatalogBatchRunner'

export interface GatewayListening {
  host: string
  port: number
  version: string
}

export type GatewayStartResult =
  | { ok: true; listening: GatewayListening }
  | { ok: false; code: 'storage-unavailable' | 'listen-failed' | 'management-api-off'; message: string; host: string; port: number }

export interface GatewayBootstrapInput {
  /** Called once the listener is up. The host decides whether that means a log line or a file. */
  onListening?: (listening: GatewayListening) => void
  /** Non-fatal notes (plaintext credentials, management API off). Never secrets. */
  onWarning?: (line: string) => void
}

export async function bootstrapGateway(input: GatewayBootstrapInput = {}): Promise<GatewayStartResult> {
  await storeManager.initialize()
  if (storeManager.hasInitializationError()) {
    // A gateway with unreadable storage has nothing to serve and nobody to click "retry":
    // say why and leave, instead of coming up and answering 500 to everything.
    return {
      ok: false,
      code: 'storage-unavailable',
      message: storeManager.getInitializationError()?.message ?? 'unknown storage error',
      host: '',
      port: 0,
    }
  }

  if (storeManager.isCredentialEncryptionDegraded()) {
    input.onWarning?.(
      'No OS keystore here: upstream credentials are stored as plaintext in ' +
        `${storeManager.getStoragePath()}/data.json. Restrict that directory (chmod 700) or run on a host with a keystore.`,
    )
  }

  // Probe readings must be in memory before any candidate is picked (`autoRouter::select`
  // is synchronous and cannot read the disk on the hot path).
  await primeModelProbeCache()
  configureModelListRefresh(storeManager.getConfig().modelListRefresh)
  scheduler.start()
  void aggregateProviderManager.autoProvisionKeyless()

  // Registers the same handler table the desktop window drives over IPC; on a headless
  // host it is the backing store for `/v1/management/rpc`. It carries no window dependency.
  await registerIpcHandlers(null)

  const config = storeManager.getConfig()
  const host = config.proxyHost || '127.0.0.1'
  const port = config.proxyPort
  // `registerIpcHandlers` honours `autoStartProxy`, so a second `start()` here would
  // report a failure for a server that is already listening.
  const started = proxyServer.isRunning() || (await proxyServer.start(port, host))
  if (!started) {
    return {
      ok: false,
      code: 'listen-failed',
      message: `Could not listen on ${host}:${port} (in use, or refused: a non-loopback host needs an API key)`,
      host,
      port,
    }
  }

  const listening: GatewayListening = { host, port, version: getHost().getVersion() }
  input.onListening?.(listening)

  if (!config.managementApi?.enableManagementApi) {
    input.onWarning?.(
      'The management API is off, so no UI can reach this gateway yet. Enable it by ' +
        'setting config.managementApi.enableManagementApi=true plus a managementApiSecret in ' +
        `${storeManager.getStoragePath()}/data.json, then restart.`,
    )
  }

  return { ok: true, listening }
}

/** SIGINT/SIGTERM: stop the listener, flush the store, exit. Shared so both hosts behave alike. */
export function installGatewayShutdownHandlers(onShutdown?: (signal: string) => void): void {
  let closing = false
  const shutdown = (signal: string): void => {
    if (closing) return
    closing = true
    onShutdown?.(signal)
    shutdownCatalogBatchJobs()
    scheduler.stop()
    void proxyServer
      .stop()
      .catch(() => undefined)
      .finally(() => {
        storeManager.flushPendingWrites()
        process.exit(0)
      })
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}
