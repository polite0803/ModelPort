/**
 * First-run provisioning for the *local* gateway (the console spawns `--init-local`).
 *
 * Deliberately narrower than the WSL `--init-host`: a local gateway is reached through
 * 127.0.0.1 by the console on the same machine, so binding beyond loopback is not needed.
 * `proxyHost` is therefore **not** touched - an existing install that serves LAN clients
 * must not be silently narrowed back to loopback by an upgrade, and a fresh install
 * already defaults to 127.0.0.1.
 *
 * What the console cannot live without is the management API and its secret: the window
 * is a `/ui/` page driven over `/v1/management/rpc`, and a gateway with the management API
 * off looks exactly like a dead one.
 */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { LocalGatewayHandshake, LocalGatewayStatus } from '../../shared/localGateway.ts'
import { serializeLocalGatewayHandshake, serializeLocalGatewayStatus } from '../../shared/localGateway.ts'

export interface LocalInitConfigView {
  managementApi?: {
    enableManagementApi?: boolean
    managementApiSecret?: string
  }
}

export interface LocalInitPlan {
  updates: {
    managementApi: { enableManagementApi: true; managementApiSecret: string }
  }
  secret: string
  generated: boolean
}

export function generateLocalManagementSecret(): string {
  return `mgmt_${randomBytes(24).toString('hex')}`
}

export function planLocalInit(
  config: LocalInitConfigView,
  generate: () => string = generateLocalManagementSecret,
): LocalInitPlan {
  const existing = config.managementApi?.managementApiSecret
  if (typeof existing === 'string' && existing.trim() !== '') {
    return {
      updates: { managementApi: { enableManagementApi: true, managementApiSecret: existing.trim() } },
      secret: existing.trim(),
      generated: false,
    }
  }
  const secret = generate()
  return {
    updates: { managementApi: { enableManagementApi: true, managementApiSecret: secret } },
    secret,
    generated: true,
  }
}

/**
 * Atomic write (unique temp + rename) with `0600`: the handshake carries a secret.
 * A reader must never observe half a JSON document and read it as "no gateway".
 */
function writePrivateJson(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, text, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, path)
}

export function writeLocalGatewayStatus(path: string, status: LocalGatewayStatus): void {
  writePrivateJson(path, serializeLocalGatewayStatus(status))
}

/**
 * Written only by `--init-local`; the console deletes it after sealing the secret.
 * Rewritten on every init so a console that lost its sealed copy can adopt again.
 */
export function writeLocalGatewayHandshake(path: string, handshake: LocalGatewayHandshake): void {
  writePrivateJson(path, serializeLocalGatewayHandshake(handshake))
}
