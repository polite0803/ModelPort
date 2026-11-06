/**
 * The handshake between the console process and the local gateway it spawns.
 *
 * Both are the same binary in different roles, so these two files are the only channel
 * between them: `local-gateway.json` says "there is a gateway, here is its port", and
 * `local-gateway.handshake` carries the management secret *once*.
 *
 * Ownership is one-way on purpose. The gateway writes both files; the console only reads
 * the status file and **deletes** the handshake after sealing the secret with the OS
 * keystore. A console that also wrote into these files would be writing gateway state -
 * the fence that keeps the two processes from sharing a write target.
 */

export const LOCAL_GATEWAY_STATUS_FILE = 'local-gateway.json'
export const LOCAL_GATEWAY_HANDSHAKE_FILE = 'local-gateway.handshake'

/** The gateway exits with this code to ask its supervisor for a restart. */
export const GATEWAY_RESTART_EXIT_CODE = 75

export interface LocalGatewayStatus {
  version: string
  pid: number
  host: string
  port: number
  startedAt: number
}

export interface LocalGatewayHandshake {
  secret: string
  /** Present when `--init-local` created an API key on a fresh install. */
  apiKey?: string
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function asPort(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) return null
  return value
}

/** Returns null on any malformed field: a half-written file must read as "unknown", not as defaults. */
export function parseLocalGatewayStatus(text: string): LocalGatewayStatus | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const entry = raw as Record<string, unknown>
  const version = asString(entry.version)
  const host = asString(entry.host)
  const port = asPort(entry.port)
  const pid = typeof entry.pid === 'number' && Number.isInteger(entry.pid) && entry.pid > 0 ? entry.pid : null
  const startedAt = typeof entry.startedAt === 'number' && Number.isFinite(entry.startedAt) ? entry.startedAt : null
  if (!version || !host || !port || !pid || startedAt === null) return null
  return { version, pid, host, port, startedAt }
}

export function serializeLocalGatewayStatus(status: LocalGatewayStatus): string {
  return `${JSON.stringify(status, null, 2)}\n`
}

/** A handshake with no secret is not a handshake; the console then asks like any other gateway. */
export function parseLocalGatewayHandshake(text: string): LocalGatewayHandshake | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const entry = raw as Record<string, unknown>
  const secret = asString(entry.secret)
  if (!secret) return null
  const apiKey = asString(entry.apiKey)
  return { secret, ...(apiKey ? { apiKey } : {}) }
}

export function serializeLocalGatewayHandshake(handshake: LocalGatewayHandshake): string {
  return `${JSON.stringify(handshake, null, 2)}\n`
}

/** The console's origin for a local gateway; the loopback host is what the window can reach. */
export function localGatewayOrigin(status: Pick<LocalGatewayStatus, 'port'>): string {
  return `http://127.0.0.1:${status.port}`
}

export type LocalGatewayPhase =
  /** No status file (or an unreadable one): this machine has never been provisioned. */
  | 'not-installed'
  /** A status file exists but its process is gone. */
  | 'stopped'
  /** The process is alive but /health did not answer: booting, wrong port, or wedged. */
  | 'unreachable'
  | 'running'

export interface LocalGatewayView {
  phase: LocalGatewayPhase
  status: LocalGatewayStatus | null
  origin: string | null
  version: string | null
}
