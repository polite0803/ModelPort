/**
 * The console's side of the local gateway: start it, notice it, stop it.
 *
 * The gateway is the same binary in another role (`--gateway` / `--init-local`), started
 * detached so closing the window leaves it serving. Everything that crosses between the
 * two processes goes through the two files in `shared/localGateway.ts`; this module only
 * reads the status file, deletes the one-time handshake and talks to `/health`.
 */
import { app, net } from 'electron'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import {
  LOCAL_GATEWAY_HANDSHAKE_FILE,
  LOCAL_GATEWAY_STATUS_FILE,
  parseLocalGatewayHandshake,
  parseLocalGatewayStatus,
  type LocalGatewayHandshake,
  type LocalGatewayStatus,
  type LocalGatewayView,
} from '../shared/localGateway.ts'
import {
  classifyLocalGateway,
  localGatewayArgs,
  LOCAL_GATEWAY_BOOT_TIMEOUT_MS,
  LOCAL_GATEWAY_HEALTH_TIMEOUT_MS,
  LOCAL_GATEWAY_POLL_INTERVAL_MS,
} from './localGatewayPlan.ts'

export function localGatewayPaths(): { status: string; handshake: string; log: string } {
  const dir = app.getPath('userData')
  return {
    status: join(dir, LOCAL_GATEWAY_STATUS_FILE),
    handshake: join(dir, LOCAL_GATEWAY_HANDSHAKE_FILE),
    log: join(dir, 'local-gateway.log'),
  }
}

export function readLocalGatewayStatus(): LocalGatewayStatus | null {
  const { status } = localGatewayPaths()
  if (!existsSync(status)) return null
  try {
    return parseLocalGatewayStatus(readFileSync(status, 'utf8'))
  } catch {
    // Unreadable is "unknown", never a default port the console would connect to.
    return null
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but belongs to someone else - still alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export async function probeGatewayHealth(origin: string): Promise<boolean> {
  try {
    const response = await net.fetch(new URL('/health', origin).toString(), {
      signal: AbortSignal.timeout(LOCAL_GATEWAY_HEALTH_TIMEOUT_MS),
    })
    return response.ok
  } catch {
    return false
  }
}

export async function readLocalGatewayView(): Promise<LocalGatewayView> {
  const status = readLocalGatewayStatus()
  if (!status) return classifyLocalGateway({ status: null, pidAlive: false, healthOk: false })
  const pidAlive = isPidAlive(status.pid)
  const healthOk = pidAlive && (await probeGatewayHealth(`http://127.0.0.1:${status.port}`))
  return classifyLocalGateway({ status, pidAlive, healthOk })
}

/**
 * Reads and deletes the one-time secret. Returns null when there is nothing pending, so
 * the caller falls back to the sealed copy (or asks, like any other gateway).
 */
export function adoptLocalHandshake(): LocalGatewayHandshake | null {
  const { handshake } = localGatewayPaths()
  if (!existsSync(handshake)) return null
  try {
    const parsed = parseLocalGatewayHandshake(readFileSync(handshake, 'utf8'))
    return parsed
  } catch {
    return null
  } finally {
    // Delete even when unparsable: a stale secret file must not outlive its one use.
    try {
      rmSync(handshake, { force: true })
    } catch {
      // Leaving it behind is harmless - the next init overwrites it.
    }
  }
}

export function startLocalGateway(mode: 'init' | 'serve'): void {
  const paths = localGatewayPaths()
  mkdirSync(app.getPath('userData'), { recursive: true })
  const log = openSync(paths.log, 'a')
  try {
    const args = localGatewayArgs({
      mode,
      statusFile: paths.status,
      handshakeFile: paths.handshake,
      appPath: app.isPackaged ? null : app.getAppPath(),
    })
    const env = { ...process.env }
    // If this console was started in Node-emulation mode, the child must not inherit it.
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(process.execPath, args, {
      detached: true,
      windowsHide: true,
      stdio: ['ignore', log, log],
      env,
    })
    child.unref()
    console.log(`[Shell] local gateway ${mode === 'init' ? 'installed' : 'started'} (pid ${child.pid ?? '?'})`)
  } finally {
    closeSync(log)
  }
}

/** Polls until the gateway answers, or returns the last observed state at the deadline. */
export async function waitForLocalGateway(
  timeoutMs: number = LOCAL_GATEWAY_BOOT_TIMEOUT_MS,
): Promise<LocalGatewayView> {
  const deadline = Date.now() + timeoutMs
  let view = await readLocalGatewayView()
  while (Date.now() < deadline) {
    if (view.phase === 'running') return view
    await new Promise(resolve => setTimeout(resolve, LOCAL_GATEWAY_POLL_INTERVAL_MS))
    view = await readLocalGatewayView()
  }
  return view
}

export async function stopLocalGateway(pid: number): Promise<boolean> {
  if (!isPidAlive(pid)) return true
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return false
  }
  for (let index = 0; index < 30; index += 1) {
    if (!isPidAlive(pid)) return true
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  try {
    // Windows has no graceful SIGTERM for a windowless process; this is the last resort.
    process.kill(pid, 'SIGKILL')
  } catch {
    return false
  }
  return !isPidAlive(pid)
}

/** The tail of the gateway's own log, for the "it is installed but will not start" screen. */
export function readLocalGatewayLog(maxLines = 12): string[] {
  const { log } = localGatewayPaths()
  if (!existsSync(log)) return []
  try {
    const text = readFileSync(log, 'utf8')
    return text.trimEnd().split(/\r?\n/).slice(-maxLines)
  } catch {
    return []
  }
}
