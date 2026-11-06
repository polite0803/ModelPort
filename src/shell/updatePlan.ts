/**
 * Pure planning for the console's online update: release selection, checksum rules,
 * systemd-unit parsing and the WSL install/rollback shell scripts.
 *
 * Kept free of Electron and `node:fs` so `node --test` can prove the dangerous parts -
 * asset name matching, checksum refusal, path quoting, backup-before-overwrite - without
 * a WSL host, a network or a real installer.
 *
 * One product ships two kinds of artifacts in the same release: the console installer
 * (`ModelPort-<version>-<arch>-setup.exe`) and the WSL/headless daemon tarball
 * (`modelport-daemon-<version>-<arch>.tar.gz`). Both carry a `.sha256`, and the release
 * tag is the single version they share. The console is the orchestrator because the
 * Windows side has the network and `wsl.exe`; the daemon itself has no updater.
 */

export interface ReleaseAsset {
  name: string
  url: string
  size?: number
}

export interface ReleaseInfo {
  /** Normalized (leading `v` removed). */
  version: string
  tag: string
  pageUrl: string
  assets: ReleaseAsset[]
}

export type DaemonArch = 'x64' | 'arm64'

export interface AssetPair {
  name: string
  url: string
  checksumName: string
  checksumUrl: string
  size?: number
}

export interface ReleaseSelection {
  version: string
  pageUrl: string
  shell: AssetPair | null
  daemon: AssetPair | null
  /** Asset names that exist (or should exist) but cannot be installed without a checksum. */
  missing: string[]
}

export interface SystemdInstall {
  installDir: string
  resourceDir: string | null
  nodePath: string | null
}

export interface InstallScriptInput {
  /** Path inside the WSL filesystem, e.g. /mnt/c/Users/.../modelport-daemon-1.7.5-x64.tar.gz */
  tarballPath: string
  /** Directory that currently holds modelport-daemon.cjs; systemd keeps pointing here. */
  installDir: string
  service: string
}

export interface RollbackScriptInput {
  installDir: string
  backupDir: string
  service: string
}

export function normalizeVersion(tag: string): string {
  return tag.trim().replace(/^v/i, '')
}

function coreParts(version: string): { core: number[]; pre: string | null } {
  const normalized = normalizeVersion(version)
  const [core, pre] = normalized.split('-', 2)
  return {
    core: core.split('.').map(part => {
      const value = Number.parseInt(part, 10)
      return Number.isFinite(value) ? value : 0
    }),
    pre: pre ?? null,
  }
}

/** Numeric dotted compare; a prerelease sorts below its release. */
export function compareVersions(a: string, b: string): number {
  const left = coreParts(a)
  const right = coreParts(b)
  const length = Math.max(left.core.length, right.core.length)
  for (let index = 0; index < length; index += 1) {
    const x = left.core[index] ?? 0
    const y = right.core[index] ?? 0
    if (x !== y) return x > y ? 1 : -1
  }
  if (left.pre === right.pre) return 0
  if (left.pre === null) return 1
  if (right.pre === null) return -1
  return left.pre > right.pre ? 1 : -1
}

export function isNewer(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0
}

export function parseRelease(payload: unknown): ReleaseInfo {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('release payload is not an object')
  }
  const raw = payload as { tag_name?: unknown; html_url?: unknown; assets?: unknown }
  if (typeof raw.tag_name !== 'string' || raw.tag_name.trim() === '') {
    throw new Error('release has no tag_name')
  }
  const version = normalizeVersion(raw.tag_name)
  if (!/^[0-9A-Za-z][0-9A-Za-z._+-]*$/.test(version)) {
    throw new Error(`unsupported release tag: ${raw.tag_name}`)
  }
  const assets: ReleaseAsset[] = Array.isArray(raw.assets)
    ? raw.assets.flatMap(asset => {
        if (typeof asset !== 'object' || asset === null) return []
        const entry = asset as { name?: unknown; browser_download_url?: unknown; size?: unknown }
        if (typeof entry.name !== 'string' || typeof entry.browser_download_url !== 'string') return []
        let url: URL
        try {
          url = new URL(entry.browser_download_url)
        } catch {
          return []
        }
        // The updater executes these bytes. A release description pointing at plain HTTP
        // would let a network attacker swap the installer for the same checksum-free name.
        // Localhost is the fixture/enterprise-mirror exception, never a LAN host.
        const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return []
        return [{
          name: entry.name,
          url: url.toString(),
          ...(typeof entry.size === 'number' ? { size: entry.size } : {}),
        }]
      })
    : []
  if (assets.length === 0) throw new Error('release has no https assets')
  return {
    version,
    tag: raw.tag_name.trim(),
    pageUrl: typeof raw.html_url === 'string' ? raw.html_url : '',
    assets,
  }
}

function assetPair(release: ReleaseInfo, name: string, missing: string[]): AssetPair | null {
  const asset = release.assets.find(entry => entry.name === name)
  if (!asset) {
    missing.push(name)
    return null
  }
  const checksumName = `${name}.sha256`
  const checksum = release.assets.find(entry => entry.name === checksumName)
  if (!checksum) {
    // Refusing to install without a checksum is deliberate: these bytes are executed
    // as root (daemon) or run as a Windows installer (shell).
    missing.push(checksumName)
    return null
  }
  return {
    name,
    url: asset.url,
    checksumName,
    checksumUrl: checksum.url,
    ...(asset.size === undefined ? {} : { size: asset.size }),
  }
}

/** One named artifact, with the same checksum rule the pair selector applies. */
export function selectAsset(release: ReleaseInfo, name: string): AssetPair | null {
  return assetPair(release, name, [])
}

export function selectReleaseAssets(release: ReleaseInfo, arch: DaemonArch): ReleaseSelection {
  const missing: string[] = []
  const pairOf = (name: string): AssetPair | null => assetPair(release, name, missing)

  return {
    version: release.version,
    pageUrl: release.pageUrl,
    // One product ships one installer: the console *is* the app now, so its update asset
    // is the same NSIS package a fresh install uses.
    shell: pairOf(`ModelPort-${release.version}-x64-setup.exe`),
    daemon: pairOf(`modelport-daemon-${release.version}-${arch}.tar.gz`),
    missing,
  }
}

/**
 * Accepts both `<hash>  <name>` (sha256sum/Get-FileHash output) and a bare hash.
 * The filename is compared by basename because `sha256sum dist/x.tar.gz` writes the path.
 */
export function parseSha256(text: string, expectedName: string): string | null {
  const line = text.split(/\r?\n/).map(value => value.trim()).find(value => value !== '')
  if (!line) return null
  const match = /^([a-fA-F0-9]{64})(?:\s+\*?(.+))?$/.exec(line)
  if (!match) return null
  if (match[2] !== undefined) {
    const name = match[2].trim().split(/[\\/]/).pop() ?? ''
    if (name !== '' && name !== expectedName) return null
  }
  return match[1].toLowerCase()
}

export function archFromUname(machine: string): DaemonArch | null {
  const value = machine.trim().toLowerCase()
  if (value === 'x86_64' || value === 'amd64') return 'x64'
  if (value === 'aarch64' || value === 'arm64') return 'arm64'
  return null
}

function splitCommand(value: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (quote !== null) {
      if (char === quote) {
        quote = null
        continue
      }
      if (char === '\\' && quote === '"' && index + 1 < value.length) {
        index += 1
        current += value[index]
        continue
      }
      current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current !== '') {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current !== '') tokens.push(current)
  return tokens
}

/** Reads `systemctl cat modelport.service` output: ExecStart + resource root. */
export function parseSystemdUnit(unit: string): SystemdInstall | null {
  const lines = unit.replace(/\r\n/g, '\n').split('\n')
  const execLine = lines.find(line => line.trimStart().startsWith('ExecStart='))
  if (!execLine) return null
  const value = execLine
    .trimStart()
    .slice('ExecStart='.length)
    .trim()
    .replace(/^[-@+!]*/, '')
  const tokens = splitCommand(value)
  if (tokens.length === 0) return null
  const bundle = tokens.length >= 2 ? tokens[1] : tokens[0]
  if (!bundle.startsWith('/')) return null
  const slash = bundle.lastIndexOf('/')
  const installDir = slash > 0 ? bundle.slice(0, slash) : '/'
  let resourceDir: string | null = null
  for (const line of lines) {
    const trimmed = line.trimStart()
    if (!trimmed.startsWith('Environment=')) continue
    for (const part of splitCommand(trimmed.slice('Environment='.length).trim())) {
      if (part.startsWith('MODELPORT_RESOURCE_ROOT=')) {
        resourceDir = part.slice('MODELPORT_RESOURCE_ROOT='.length)
      }
    }
  }
  return {
    installDir,
    resourceDir,
    nodePath: tokens.length >= 2 ? tokens[0] : null,
  }
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function assertAbsolutePath(value: string, label: string): void {
  if (!value.startsWith('/')) throw new Error(`${label} must be an absolute path`)
  if (/[\n\r\0]/.test(value)) throw new Error(`${label} contains a control character`)
}

function assertService(value: string): void {
  if (!/^[A-Za-z0-9._@-]+$/.test(value)) throw new Error(`unsupported service name: ${value}`)
}

/**
 * The script prints `BACKUP=` **before** stopping the service, so the caller can roll back
 * even when systemd fails to start the new bundle (a non-zero exit still leaves stdout).
 */
export function buildWslInstallScript(input: InstallScriptInput): string {
  assertAbsolutePath(input.tarballPath, 'tarballPath')
  assertAbsolutePath(input.installDir, 'installDir')
  assertService(input.service)
  return [
    'set -eu',
    `SRC=${shellQuote(input.tarballPath)}`,
    `INSTALL=${shellQuote(input.installDir)}`,
    `SERVICE=${shellQuote(input.service)}`,
    'TS=$(date +%Y%m%d-%H%M%S)',
    'STAGE=$(mktemp -d /tmp/modelport-update.XXXXXX)',
    `trap 'rm -rf "$STAGE"' EXIT`,
    '[ -f "$SRC" ] || { echo "update tarball missing" >&2; exit 10; }',
    '[ -d "$INSTALL" ] || { echo "install dir not found: $INSTALL" >&2; exit 14; }',
    // A versioned layout may point the unit at a `current` symlink. Resolve it before
    // copying/backing up, or `cp -a` would preserve the link instead of the release.
    'INSTALL=$(readlink -f "$INSTALL")',
    'tar -xzf "$SRC" -C "$STAGE"',
    'NEW=$(find "$STAGE" -mindepth 1 -maxdepth 1 -type d | head -n 1)',
    '[ -n "$NEW" ] && [ -f "$NEW/modelport-daemon.cjs" ] || { echo "bundle missing in tarball" >&2; exit 11; }',
    '[ -f "$NEW/resources/channel-pack/worker.mjs" ] || { echo "channel pack missing in tarball" >&2; exit 13; }',
    'BACKUP="$INSTALL.bak-$TS"',
    'cp -a "$INSTALL" "$BACKUP"',
    'echo "BACKUP=$BACKUP"',
    'systemctl stop "$SERVICE" || true',
    'find "$INSTALL" -mindepth 1 -maxdepth 1 -exec rm -rf {} +',
    'cp -a "$NEW"/. "$INSTALL"/',
    'systemctl start "$SERVICE"',
    'i=0',
    'until systemctl is-active --quiet "$SERVICE"; do',
    '  i=$((i+1))',
    '  [ "$i" -ge 10 ] && { echo "service failed to start" >&2; exit 12; }',
    '  sleep 1',
    'done',
    // Keep the new backup plus the previous one; older copies are noise on a small disk.
    'ls -dt "$INSTALL".bak-* 2>/dev/null | tail -n +3 | xargs -r rm -rf || true',
  ].join('\n')
}

export function buildWslRollbackScript(input: RollbackScriptInput): string {
  assertAbsolutePath(input.installDir, 'installDir')
  assertAbsolutePath(input.backupDir, 'backupDir')
  assertService(input.service)
  return [
    'set -eu',
    `INSTALL=${shellQuote(input.installDir)}`,
    `BACKUP=${shellQuote(input.backupDir)}`,
    `SERVICE=${shellQuote(input.service)}`,
    '[ -d "$BACKUP" ] || { echo "backup not found: $BACKUP" >&2; exit 20; }',
    'INSTALL=$(readlink -f "$INSTALL")',
    'systemctl stop "$SERVICE" || true',
    'find "$INSTALL" -mindepth 1 -maxdepth 1 -exec rm -rf {} +',
    'cp -a "$BACKUP"/. "$INSTALL"/',
    'systemctl start "$SERVICE"',
    'i=0',
    'until systemctl is-active --quiet "$SERVICE"; do',
    '  i=$((i+1))',
    '  [ "$i" -ge 10 ] && { echo "rollback service failed to start" >&2; exit 21; }',
    '  sleep 1',
    'done',
    'echo "ROLLED_BACK"',
  ].join('\n')
}

export function parseBackupPath(output: string): string | null {
  const match = /^BACKUP=(.+)$/m.exec(output)
  return match ? match[1].trim() : null
}
