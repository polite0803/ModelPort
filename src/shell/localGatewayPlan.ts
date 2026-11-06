/**
 * Pure decisions about the local gateway: what state it is in, and how to launch it.
 *
 * Kept free of Electron and `node:fs` so `node --test` can prove the state machine -
 * "not installed" versus "installed but stopped" must never look the same on screen,
 * because only the first one is a one-click install.
 */
import type { LocalGatewayStatus, LocalGatewayView } from '../shared/localGateway.ts'

export interface LocalGatewayProbe {
  status: LocalGatewayStatus | null
  /** `process.kill(pid, 0)` succeeded. A recycled PID is not detected; the health probe is. */
  pidAlive: boolean
  healthOk: boolean
}

export function classifyLocalGateway(probe: LocalGatewayProbe): LocalGatewayView {
  if (!probe.status) {
    return { phase: 'not-installed', status: null, origin: null, version: null }
  }
  const status = probe.status
  const origin = `http://127.0.0.1:${status.port}`
  if (!probe.pidAlive) {
    return { phase: 'stopped', status, origin, version: status.version }
  }
  if (!probe.healthOk) {
    return { phase: 'unreachable', status, origin, version: status.version }
  }
  return { phase: 'running', status, origin, version: status.version }
}

export interface LocalGatewayArgvInput {
  mode: 'init' | 'serve'
  statusFile: string
  handshakeFile: string
  /**
   * In development the binary is Electron itself (`electron <appPath>`), so the app path
   * has to be repeated before the role flags; packaged, the binary already is the app.
   */
  appPath: string | null
}

export function localGatewayArgs(input: LocalGatewayArgvInput): string[] {
  const args: string[] = []
  if (input.appPath) args.push(input.appPath)
  args.push(input.mode === 'init' ? '--init-local' : '--gateway')
  args.push('--status-file', input.statusFile)
  if (input.mode === 'init') args.push('--handshake-file', input.handshakeFile)
  return args
}

/** Health polling: a fresh gateway needs a moment before it answers, a dead one never will. */
export const LOCAL_GATEWAY_BOOT_TIMEOUT_MS = 20_000
export const LOCAL_GATEWAY_POLL_INTERVAL_MS = 400
export const LOCAL_GATEWAY_HEALTH_TIMEOUT_MS = 1_500
