/**
 * Which managed hosts may hand the console a fresh management secret without asking.
 *
 * A backup restore or a rebuild can rotate the gateway's managementApiSecret; the sealed
 * copy then 401s and the page falls back to the connect form. For hosts the console itself
 * manages there is already a sanctioned handoff channel, so the secret can be re-adopted
 * silently. The shell never opens the gateway's data.json - it stays a client:
 *   local  - the gateway re-emits its handshake on every start; the console adopts that file.
 *   WSL    - `--init-host` is idempotent (keeps the existing secret) and prints the handshake.
 * Remote gateways have no such channel: they keep the fail-closed form.
 *
 * Kept free of Electron so the decision is assertable without a window.
 */

export type SecretRefreshChannel = 'local-handshake' | 'wsl-init-host' | null

export function refreshChannelFor(entry: { kind: string; manageWsl?: boolean } | null): SecretRefreshChannel {
  if (!entry) return null
  if (entry.kind === 'local') return 'local-handshake'
  if (entry.kind === 'wsl' && entry.manageWsl === true) return 'wsl-init-host'
  return null
}

/**
 * The idempotent re-handshake: `--init-host` keeps the existing secret and API key and
 * prints MODELPORT_HANDSHAKE. The node/bundle come from the systemd unit, never a path the
 * page chose. Same one-shot shape the updater uses for `--print-paths`.
 */
export function buildWslInitHostCommand(unit: { installDir: string; nodePath: string | null }): string[] {
  const bundle = `${unit.installDir.replace(/\/+$/, '')}/modelport-daemon.cjs`
  return unit.nodePath ? [unit.nodePath, bundle, '--init-host'] : [bundle, '--init-host']
}