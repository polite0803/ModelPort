/**
 * Pure planning for the WSL first install: distro/node discovery, the systemd unit, the
 * root script and the rollback.
 *
 * Kept free of Electron, `wsl.exe` and the filesystem so `node --test` can prove the
 * dangerous parts - a unit whose ExecStart points somewhere else than MODELPORT_RESOURCE_ROOT,
 * a script that forgets to verify the bundle, a distro table decoded from the wrong
 * encoding - without a WSL host.
 */
import type { DaemonArch } from './updatePlan'

/**
 * `wsl.exe -l -v` speaks UTF-16LE; the rest of the distributions speak UTF-8. Decoding
 * everything as UTF-8 turns the distro table into NUL-separated garbage, and the only
 * symptom is "no distributions found" on a machine that has three.
 */
export function decodeWslOutput(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le')
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 256))
  let zerosAtOdd = 0
  for (let index = 1; index < sample.length; index += 2) {
    if (sample[index] === 0) zerosAtOdd += 1
  }
  const pairs = Math.ceil(sample.length / 2)
  if (pairs > 0 && zerosAtOdd / pairs > 0.4) return buffer.toString('utf16le')
  return buffer.toString('utf8')
}

export interface WslDistro {
  name: string
  state: 'Running' | 'Stopped' | 'Installing' | 'Unknown'
  version: number
  isDefault: boolean
}

/**
 * `wsl.exe -l -v` columns. The decoder is `decodeWslOutput` (UTF-16LE); this only reads
 * the table. Distro names may contain spaces, so the split is on runs of two spaces.
 */
export function parseWslDistros(text: string): WslDistro[] {
  const distros: WslDistro[] = []
  for (const rawLine of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.replace(/\0/g, '').trimEnd()
    if (line.trim() === '' || /^\s*NAME\s+STATE/i.test(line)) continue
    const match = /^(\*)?\s*(.+?)\s{2,}(Running|Stopped|Installing|Converting|Unknown)\s+(\d+)\s*$/i.exec(line)
    if (!match) continue
    const state = match[3]
    distros.push({
      name: match[2].trim(),
      state: (state.charAt(0).toUpperCase() + state.slice(1).toLowerCase()) as WslDistro['state'],
      version: Number.parseInt(match[4], 10),
      isDefault: match[1] === '*',
    })
  }
  return distros
}

/** `node -v` → major, or null when the command produced nothing usable. */
export function parseNodeMajor(output: string): number | null {
  const match = /^v?(\d+)\./m.exec(output.trim())
  if (!match) return null
  const major = Number.parseInt(match[1], 10)
  return Number.isFinite(major) ? major : null
}

export const MIN_NODE_MAJOR = 20
/** Pinned to the version the WSL install guide was measured with. */
export const NODE_DIST_VERSION = '22.14.0'

export interface NodeProvisionPlan {
  needed: boolean
  version: string
  arch: DaemonArch
  url: string
  checksumsUrl: string
  fileName: string
}

export function nodeDownloadUrl(version: string, arch: DaemonArch): string {
  return `https://nodejs.org/dist/v${version}/node-v${version}-linux-${arch}.tar.xz`
}

export function planNodeProvision(input: { nodeMajor: number | null; arch: DaemonArch }): NodeProvisionPlan {
  const version = NODE_DIST_VERSION
  const fileName = `node-v${version}-linux-${input.arch}.tar.xz`
  return {
    // An older Node is treated as absent: the daemon needs native type stripping and the
    // modern `fetch`, and "it starts but dies on the first request" is worse than installing.
    needed: input.nodeMajor === null || input.nodeMajor < MIN_NODE_MAJOR,
    version,
    arch: input.arch,
    url: nodeDownloadUrl(version, input.arch),
    checksumsUrl: `https://nodejs.org/dist/v${version}/SHASUMS256.txt`,
    fileName,
  }
}

/** `SHASUMS256.txt` holds a line per artifact; pick the one this download names. */
export function parseShasums(text: string, fileName: string): string | null {
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line.trim())
    if (!match) continue
    const name = match[2].trim().split('/').pop() ?? ''
    if (name === fileName) return match[1].toLowerCase()
  }
  return null
}

export interface SystemdUnitInput {
  nodePath: string
  installDir: string
  service: string
}

export function buildSystemdUnit(input: SystemdUnitInput): string {
  assertAbsolute(input.nodePath, 'nodePath')
  assertAbsolute(input.installDir, 'installDir')
  assertService(input.service)
  return [
    '[Unit]',
    'Description=ModelPort gateway (headless daemon)',
    'After=network-online.target',
    '',
    '[Service]',
    `ExecStart=${input.nodePath} ${input.installDir}/modelport-daemon.cjs`,
    `Environment=MODELPORT_RESOURCE_ROOT=${input.installDir}/resources`,
    `Environment=MODELPORT_WEB_ROOT=${input.installDir}/renderer`,
    'Restart=on-failure',
    'RestartSec=2',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n')
}

export interface FirstInstallInput {
  /** Path inside WSL, e.g. /mnt/c/Users/.../modelport-daemon-1.8.0-x64.tar.gz */
  tarballPath: string
  /** Archive inside WSL that unpacks to `node-v<ver>-linux-<arch>/`; null when Node exists. */
  nodeTarballPath: string | null
  /** Existing node binary (e.g. /usr/bin/node) when nothing has to be provisioned. */
  existingNodePath: string | null
  installDir: string
  service: string
  port: number
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function assertService(value: string): void {
  if (!/^[A-Za-z0-9._@-]+$/.test(value)) throw new Error(`unsupported service name: ${value}`)
}

function assertAbsolute(value: string, label: string): void {
  if (!value.startsWith('/')) throw new Error(`${label} must be an absolute path`)
  if (/[\n\r\0]/.test(value)) throw new Error(`${label} contains a control character`)
}

/**
 * The whole first install, as one root script:
 *   files → unit → `--init-host` → restart → wait active
 * `--init-host` writes the non-loopback bind and the management secret; the restart after
 * it is what makes the freshly written config take effect. Order matters: restarting
 * before init would bind loopback and look "up" while the host still cannot reach it.
 *
 * On any failure after the unit exists, the caller runs the rollback script - the install
 * is all-or-nothing so a second attempt starts from a known state.
 */
export function buildFirstInstallScript(input: FirstInstallInput): string {
  assertAbsolute(input.tarballPath, 'tarballPath')
  assertAbsolute(input.installDir, 'installDir')
  assertService(input.service)
  if (input.nodeTarballPath !== null) assertAbsolute(input.nodeTarballPath, 'nodeTarballPath')
  if (input.existingNodePath !== null) assertAbsolute(input.existingNodePath, 'existingNodePath')
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new Error(`unsupported port: ${input.port}`)
  }
  const nodeArchive = input.nodeTarballPath
    ? `NODE_TAR=${shellQuote(input.nodeTarballPath)}`
    : 'NODE_TAR=\'\''
  const installRoot = input.installDir.replace(/\/+$/, '') || '/'
  // The unit has to name the binary the script will use; a provisioned runtime lives at a
  // path this side can predict, an existing one is reported by the probe.
  const effectiveNodePath = input.nodeTarballPath !== null
    ? `${installRoot}/node/bin/node`
    : (input.existingNodePath ?? `${installRoot}/node/bin/node`)
  const unit = buildSystemdUnit({
    nodePath: effectiveNodePath,
    installDir: input.installDir,
    service: input.service,
  })

  return [
    'set -eu',
    `SRC=${shellQuote(input.tarballPath)}`,
    `INSTALL=${shellQuote(input.installDir)}`,
    `SERVICE=${shellQuote(input.service)}`,
    `PORT=${shellQuote(String(input.port))}`,
    nodeArchive,
    '[ -f "$SRC" ] || { echo "daemon tarball missing" >&2; exit 10; }',
    'mkdir -p "$INSTALL"',
    'if [ -n "$NODE_TAR" ]; then',
    '  [ -f "$NODE_TAR" ] || { echo "node tarball missing" >&2; exit 20; }',
    '  NODE_STAGE=$(mktemp -d /tmp/modelport-node.XXXXXX)',
    '  tar -xJf "$NODE_TAR" -C "$NODE_STAGE"',
    '  NEWNODE=$(find "$NODE_STAGE" -mindepth 1 -maxdepth 1 -type d | head -n 1)',
    '  [ -n "$NEWNODE" ] || { echo "node tarball has no directory" >&2; exit 21; }',
    '  rm -rf "$INSTALL/node"',
    '  mv "$NEWNODE" "$INSTALL/node"',
    '  rm -rf "$NODE_STAGE"',
    'fi',
    'NODE_BIN=${NODE_TAR:+$INSTALL/node/bin/node}',
    'NODE_BIN=${NODE_BIN:-' + (input.existingNodePath ? shellQuote(input.existingNodePath) : `$INSTALL/node/bin/node`) + '}',
    '[ -x "$NODE_BIN" ] || { echo "node not executable: $NODE_BIN" >&2; exit 30; }',
    'STAGE=$(mktemp -d /tmp/modelport-install.XXXXXX)',
    'trap \'rm -rf "$STAGE"\' EXIT',
    'tar -xzf "$SRC" -C "$STAGE"',
    'NEW=$(find "$STAGE" -mindepth 1 -maxdepth 1 -type d | head -n 1)',
    '[ -n "$NEW" ] && [ -f "$NEW/modelport-daemon.cjs" ] || { echo "bundle missing in tarball" >&2; exit 11; }',
    '[ -f "$NEW/resources/channel-pack/worker.mjs" ] || { echo "channel pack missing in tarball" >&2; exit 13; }',
    // Keep a provisioned node runtime: it lives inside INSTALL and is not in the tarball.
    'find "$INSTALL" -mindepth 1 -maxdepth 1 ! -name node -exec rm -rf {} +',
    'cp -a "$NEW"/. "$INSTALL"/',
    `cat > /etc/systemd/system/$SERVICE.service <<'MODELPORT_UNIT'`,
    unit,
    'MODELPORT_UNIT',
    'systemctl daemon-reload',
    'systemctl enable "$SERVICE"',
    'INIT=$("$NODE_BIN" "$INSTALL/modelport-daemon.cjs" --init-host --port "$PORT")',
    'echo "$INIT"',
    'systemctl restart "$SERVICE"',
    'i=0',
    'until systemctl is-active --quiet "$SERVICE"; do',
    '  i=$((i+1))',
    '  [ "$i" -ge 20 ] && { echo "service failed to start" >&2; exit 12; }',
    '  sleep 1',
    'done',
    'echo "INSTALL=$INSTALL"',
  ].join('\n')
}

/**
 * Removes only what the install created. `~/.modelport` (the gateway data) is deliberately
 * untouched: a failed first install must not cost the operator a second backup import.
 */
export function buildFirstInstallRollbackScript(input: { installDir: string; service: string }): string {
  assertAbsolute(input.installDir, 'installDir')
  assertService(input.service)
  return [
    'set -eu',
    `INSTALL=${shellQuote(input.installDir)}`,
    `SERVICE=${shellQuote(input.service)}`,
    'systemctl disable --now "$SERVICE" || true',
    'rm -f "/etc/systemd/system/$SERVICE.service"',
    'systemctl daemon-reload || true',
    'rm -rf "$INSTALL"',
    'echo "ROLLED_BACK"',
  ].join('\n')
}

export interface InitHostHandshake {
  secret: string
  apiKey?: string
  port?: number
}

/** Reads the one machine-readable line `--init-host` prints; ignores the human block. */
export function parseInitHostHandshake(output: string): InitHostHandshake | null {
  for (const line of output.replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('MODELPORT_HANDSHAKE ')) continue
    try {
      const parsed = JSON.parse(trimmed.slice('MODELPORT_HANDSHAKE '.length)) as Record<string, unknown>
      const secret = typeof parsed.secret === 'string' && parsed.secret.trim() !== '' ? parsed.secret.trim() : null
      if (!secret) return null
      const apiKey = typeof parsed.apiKey === 'string' && parsed.apiKey.trim() !== '' ? parsed.apiKey.trim() : undefined
      const port = typeof parsed.port === 'number' && Number.isInteger(parsed.port) ? parsed.port : undefined
      return { secret, ...(apiKey ? { apiKey } : {}), ...(port ? { port } : {}) }
    } catch {
      return null
    }
  }
  return null
}

/** `systemctl is-system-running` — `degraded` still has a working systemd. */
export function systemdUsable(output: string): boolean {
  const state = output.trim().split('\n')[0]?.trim() ?? ''
  return state === 'running' || state === 'degraded' || state === 'starting'
}
