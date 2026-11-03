import { X509Certificate, createPrivateKey, createPublicKey } from 'crypto'
import { execFile } from 'child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { generate } from 'selfsigned'
import type { TlsCertificateInfo, TlsHandshakeStats, TlsStatus, TlsTrustResult } from '../../shared/types'
import type { AppConfig } from '../store/types'
import { buildHttpsUrl, isIpv4, isIpv6, requiredSanHosts } from '../../shared/httpsConfig.ts'

const MANAGED_DIR = join(homedir(), '.modelport', 'tls')
const MANAGED_CERT = 'server.crt'
const MANAGED_KEY = 'server.key'
const CERT_DAYS = 397
const RENEW_BEFORE_MS = 7 * 24 * 60 * 60 * 1000

export interface TlsMaterial extends TlsCertificateInfo {
  cert: string
  key: string
}

export interface TlsRuntimeStatus {
  running: boolean
  host: string
  port: number
  error: string | null
  /** Rejected handshakes counted by the running listener; null when it never started. */
  handshakes?: TlsHandshakeStats | null
}

/** The config slice that decides which certificate gets presented. */
export interface TlsConfigInput {
  httpsCertPath?: string
  httpsKeyPath?: string
  httpsSanHosts?: string[]
}

interface CommandResult {
  ok: boolean
  output: string
}

function run(file: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 20000 }, (error, stdout, stderr) => {
      const output = `${stdout ?? ''}${stderr ?? ''}`.trim()
      resolve({ ok: !error, output })
    })
  })
}

function certificateInfo(certPem: string, source: TlsCertificateInfo['source'], certPath: string, keyPath: string): TlsCertificateInfo {
  const x509 = new X509Certificate(certPem)
  return {
    source,
    certPath,
    keyPath,
    subject: x509.subject,
    issuer: x509.issuer,
    fingerprint256: x509.fingerprint256,
    validFrom: x509.validFrom,
    validTo: x509.validTo,
    subjectAltName: x509.subjectAltName ?? null,
    selfSigned: x509.subject === x509.issuer,
  }
}

function keyMatchesCertificate(x509: X509Certificate, keyPem: string): boolean {
  try {
    const certPublic = x509.publicKey.export({ type: 'spki', format: 'der' })
    const keyPublic = createPublicKey(createPrivateKey(keyPem)).export({ type: 'spki', format: 'der' })
    return certPublic.equals(keyPublic)
  } catch {
    return false
  }
}

function readPair(certPath: string, keyPath: string, source: TlsCertificateInfo['source']): TlsMaterial {
  if (!existsSync(certPath)) throw new Error(`Certificate file not found: ${certPath}`)
  if (!existsSync(keyPath)) throw new Error(`Private key file not found: ${keyPath}`)
  const cert = readFileSync(certPath, 'utf8')
  const key = readFileSync(keyPath, 'utf8')
  const x509 = new X509Certificate(cert)
  if (!keyMatchesCertificate(x509, key)) {
    throw new Error('HTTPS private key does not match the certificate')
  }
  return { ...certificateInfo(cert, source, certPath, keyPath), cert, key }
}

function managedPaths(): { certPath: string; keyPath: string } {
  return {
    certPath: join(MANAGED_DIR, MANAGED_CERT),
    keyPath: join(MANAGED_DIR, MANAGED_KEY),
  }
}

function altNamesFor(hosts: string[]): Array<{ type: number; value?: string; ip?: string }> {
  return hosts.map((host) =>
    isIpv4(host) || isIpv6(host) ? { type: 7, ip: host } : { type: 2, value: host },
  )
}

function certCoversHosts(x509: X509Certificate, hosts: string[]): boolean {
  return hosts.every((host) =>
    isIpv4(host) || isIpv6(host)
      ? x509.checkIP(host) !== undefined
      : x509.checkHost(host) !== undefined,
  )
}

function managedCertificateUsable(certPem: string, requiredHosts: string[]): boolean {
  try {
    const x509 = new X509Certificate(certPem)
    if (Date.parse(x509.validTo) - Date.now() < RENEW_BEFORE_MS) return false
    return certCoversHosts(x509, requiredHosts)
  } catch {
    return false
  }
}

function generateManagedMaterial(hosts: string[]): TlsMaterial {
  const { certPath, keyPath } = managedPaths()
  mkdirSync(MANAGED_DIR, { recursive: true })
  const result = generate(
    [{ name: 'commonName', value: 'ModelPort' }],
    {
      days: CERT_DAYS,
      keySize: 2048,
      algorithm: 'sha256',
      notBeforeDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      extensions: [
        { name: 'basicConstraints', cA: true, pathLenConstraint: 0 },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, keyCertSign: true },
        { name: 'extKeyUsage', serverAuth: true },
        { name: 'subjectAltName', altNames: altNamesFor(hosts) },
        { name: 'subjectKeyIdentifier' },
      ],
    },
  )
  writeFileSync(certPath, result.cert, 'utf8')
  writeFileSync(keyPath, result.private, { encoding: 'utf8', mode: 0o600 })
  try {
    chmodSync(keyPath, 0o600)
  } catch {
    // Windows may ignore POSIX modes; the file still sits under the user profile.
  }
  return readPair(certPath, keyPath, 'managed')
}

function ensureManagedMaterial(requiredHosts: string[]): TlsMaterial {
  const { certPath, keyPath } = managedPaths()
  if (existsSync(certPath) && existsSync(keyPath)) {
    try {
      const material = readPair(certPath, keyPath, 'managed')
      if (managedCertificateUsable(material.cert, requiredHosts)) return material
    } catch {
      // Unreadable or mismatched pair: fall through and regenerate.
    }
  }
  return generateManagedMaterial(requiredHosts)
}

/**
 * Resolves the certificate the HTTPS listener should present. Custom PEM paths
 * win; otherwise the app-managed self-signed cert is generated on first use,
 * renewed shortly before it expires, and regenerated when a name the client
 * connects by is missing from its SAN.
 */
export function loadTlsMaterial(config: TlsConfigInput): TlsMaterial {
  const hasCert = typeof config.httpsCertPath === 'string' && config.httpsCertPath.trim() !== ''
  const hasKey = typeof config.httpsKeyPath === 'string' && config.httpsKeyPath.trim() !== ''
  if (hasCert !== hasKey) {
    throw new Error('HTTPS certificate and key must be provided together')
  }
  if (hasCert && hasKey) {
    return readPair(config.httpsCertPath as string, config.httpsKeyPath as string, 'custom')
  }
  return ensureManagedMaterial(requiredSanHosts(config.httpsSanHosts))
}

/** Reads an existing certificate for display without generating a new one. */
export function tryReadTlsMaterial(config: TlsConfigInput): TlsMaterial | null {
  try {
    const hasCert = typeof config.httpsCertPath === 'string' && config.httpsCertPath.trim() !== ''
    const hasKey = typeof config.httpsKeyPath === 'string' && config.httpsKeyPath.trim() !== ''
    if (hasCert && hasKey) return readPair(config.httpsCertPath as string, config.httpsKeyPath as string, 'custom')
    const { certPath, keyPath } = managedPaths()
    if (!existsSync(certPath) || !existsSync(keyPath)) return null
    return readPair(certPath, keyPath, 'managed')
  } catch {
    return null
  }
}

/**
 * SHA-1 thumbprint, formatted the way Windows certificate stores report it.
 * The trust probe and the removal both compare against this exact shape, so a
 * stray separator or lowercase hex silently matches nothing.
 */
export function sha1Thumbprint(certPem: string): string {
  return new X509Certificate(certPem).fingerprint.replace(/:/g, '').toUpperCase()
}

/**
 * OpenSSL codes that mean "this client does not trust the certificate we
 * presented". Everything else on `tlsClientError` is a protocol-level failure
 * (an HTTP client hitting the HTTPS port, a dead TLS version, a broken tunnel)
 * and must not be reported as a trust problem.
 */
const CERTIFICATE_REJECTION_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNKNOWN_CA',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_UNTRUSTED',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'HOST_NOT_FOUND_ANYWHERE',
])

export function isCertificateRejection(code: string): boolean {
  return CERTIFICATE_REJECTION_CODES.has((code || '').toUpperCase())
}

export interface HandshakeRejectionTracker {
  record(code: string, at: number): void
  stats(): TlsHandshakeStats
}

/**
 * Counts handshakes the client aborted before HTTP started.
 *
 * Such a request is invisible everywhere else: no route runs, so there is no
 * request-log row and no `X-Request-Id`, and the user only sees "the client
 * cannot connect". The counter is what makes that absence explainable.
 * Repeats of one code inside `dedupWindowMs` are counted but not logged again,
 * because a retrying client can produce hundreds of identical failures.
 *
 * ⚠️ What the server can and cannot know. A client that rejects *our*
 * certificate sends a TLS alert, and Node reports it here as a bare
 * `ECONNRESET` - measured 2026-11-03: the code `DEPTH_ZERO_SELF_SIGNED_CERT`
 * exists only on the client. So claiming "the client did not trust the
 * certificate" from a code would be a fabrication; the honest statement is that
 * the handshake died before any request, and that when this listener presents a
 * self-signed certificate the client's own verification is the first suspect.
 */
export function createHandshakeRejectionTracker(input: {
  startedAt: number
  certPath: string
  selfSigned: boolean
  log: (level: 'warn', message: string) => void
  dedupWindowMs?: number
}): HandshakeRejectionTracker {
  const dedupWindowMs = input.dedupWindowMs ?? 30_000
  const counts = new Map<string, number>()
  const lastLoggedAt = new Map<string, number>()
  let total = 0
  let lastAt: number | null = null

  return {
    record(code, at) {
      const key = (code || 'TLS_HANDSHAKE_ERROR').toUpperCase()
      total += 1
      lastAt = at
      counts.set(key, (counts.get(key) ?? 0) + 1)

      const previous = lastLoggedAt.get(key)
      if (previous !== undefined && at - previous < dedupWindowMs) return
      lastLoggedAt.set(key, at)
      const count = counts.get(key) ?? 1
      const certificate = isCertificateRejection(key)
      const suffix = count > 1 ? ` (${count} of this code since the listener started)` : ''
      const trustHint =
        `Chromium/Schannel clients read the OS trust store (use "Install into system trust"); Node-based ` +
        `clients ignore that store entirely and need NODE_EXTRA_CA_CERTS=${input.certPath} - the same PEM ` +
        `is served by GET /v1/management/tls/ca.`
      input.log(
        'warn',
        certificate
          ? `HTTPS handshake refused by the client: ${key}${suffix}. This code names a certificate ` +
              `problem, so nothing reached the proxy and no request was logged. ${trustHint}`
          : `HTTPS handshake aborted before any request: ${key}${suffix}. No request row exists for it. ` +
              (input.selfSigned
                ? `This listener presents a self-signed certificate, so the first suspect is the client's own ` +
                    `certificate verification - the alert reaches us as ${key}, the reason code stays on the ` +
                    `client. ${trustHint} `
                : '') +
              `An HTTP client aimed at the HTTPS port breaks here too: check the URL scheme against the port.`,
      )
    },
    stats() {
      return {
        sinceAt: input.startedAt,
        total,
        lastAt,
        byCode: [...counts.entries()].map(([code, count]) => ({
          code,
          count,
          certificate: isCertificateRejection(code),
        })),
      }
    },
  }
}

/**
 * Whether the certificate is trusted by the OS store. Chromium-based clients
 * (Claude Desktop) use that store on Windows and macOS, so this is the same
 * question the client will ask. null means the platform has no cheap probe.
 *
 * ⚠️ A `true` here says nothing about Node-based clients (Codex CLI, the
 * WorkBuddy/CodeBuddy agent, anything using `node:https` or undici): Node never
 * consults the OS store, it uses its bundled CA set plus `NODE_EXTRA_CA_CERTS`.
 */
export async function isCertificateTrusted(material: TlsMaterial): Promise<boolean | null> {
  if (process.platform === 'win32') {
    const thumbprint = sha1Thumbprint(material.cert)
    const command = `(Get-ChildItem Cert:\\CurrentUser\\Root | Where-Object { $_.Thumbprint -eq '${thumbprint}' } | Measure-Object).Count`
    const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command])
    if (!result.ok) return null
    return result.output.trim() === '1'
  }

  if (process.platform === 'darwin') {
    const result = await run('security', ['verify-cert', '-c', material.certPath, '-p', 'ssl'])
    return result.ok
  }

  return null
}

export async function installCertificateTrust(material: TlsMaterial): Promise<TlsTrustResult> {
  if (process.platform === 'win32') {
    const result = await run('certutil', ['-user', '-addstore', 'Root', material.certPath])
    if (!result.ok) {
      return { ok: false, message: result.output || 'certutil failed to install the certificate', trusted: false }
    }
    return {
      ok: true,
      message: 'Certificate installed into the current user Trusted Root store. Restart the client to pick it up.',
      trusted: await isCertificateTrusted(material),
    }
  }

  if (process.platform === 'darwin') {
    const result = await run('security', ['add-trusted-cert', '-r', 'trustRoot', '-k', loginKeychainPath(), material.certPath])
    if (!result.ok) {
      return { ok: false, message: result.output || 'security add-trusted-cert failed', trusted: false }
    }
    return {
      ok: true,
      message: 'Certificate added to the login keychain trust settings. Restart the client to pick it up.',
      trusted: await isCertificateTrusted(material),
    }
  }

  return {
    ok: false,
    message: `On Linux, trust the certificate manually, e.g. sudo trust anchor --store "${material.certPath}" (or copy it to /usr/local/share/ca-certificates/ and run update-ca-certificates).`,
    trusted: null,
  }
}

function loginKeychainPath(): string {
  const db = join(homedir(), 'Library', 'Keychains', 'login.keychain-db')
  return existsSync(db) ? db : 'login.keychain'
}

/**
 * Takes the certificate out of the OS trust store again.
 *
 * ⚠️ Windows deliberately does **not** use `certutil -delstore`: measured on this
 * machine, a serial that matches nothing still exits 0 and removes the *first*
 * entry of the store. The PowerShell form below filters on the exact SHA-1 and
 * deletes nothing when there is no match.
 */
export async function uninstallCertificateTrust(material: TlsMaterial): Promise<TlsTrustResult> {
  if (process.platform === 'win32') {
    const thumbprint = sha1Thumbprint(material.cert)
    const command =
      `$found = @(Get-ChildItem Cert:\\CurrentUser\\Root | Where-Object { $_.Thumbprint -eq '${thumbprint}' }); ` +
      "if ($found.Count -eq 0) { 'NOT-INSTALLED' } else { $found | Remove-Item; 'REMOVED=' + $found.Count }"
    const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command])
    const output = result.output.trim()

    if (!result.ok) {
      return { ok: false, message: output || 'Failed to remove the certificate', trusted: null }
    }
    if (output.includes('NOT-INSTALLED')) {
      return {
        ok: true,
        message: 'This certificate is not in the current user Trusted Root store; nothing was removed.',
        trusted: false,
      }
    }
    return {
      ok: true,
      message: `Removed from the current user Trusted Root store (${output}).`,
      trusted: await isCertificateTrusted(material),
    }
  }

  if (process.platform === 'darwin') {
    const result = await run('security', [
      'delete-certificate',
      '-Z',
      sha1Thumbprint(material.cert),
      loginKeychainPath(),
    ])
    if (!result.ok) {
      return {
        ok: false,
        message: result.output || `security delete-certificate failed (a trust setting added with sudo has to be removed with sudo)`,
        trusted: null,
      }
    }
    return {
      ok: true,
      message: 'Removed from the login keychain trust settings.',
      trusted: await isCertificateTrusted(material),
    }
  }

  return {
    ok: false,
    message: `On Linux, remove the trust anchor manually, e.g. sudo trust anchor --remove "${material.certPath}" (or delete it from /usr/local/share/ca-certificates/ and run update-ca-certificates).`,
    trusted: null,
  }
}

export async function getTlsStatus(config: AppConfig, runtime: TlsRuntimeStatus): Promise<TlsStatus> {
  const material = tryReadTlsMaterial(config)
  const trusted = material ? await isCertificateTrusted(material) : null
  return {
    enabled: config.httpsEnabled,
    running: runtime.running,
    host: runtime.host,
    port: runtime.port,
    url: runtime.running ? buildHttpsUrl(runtime.host, runtime.port) : null,
    certificate: material
      ? {
          source: material.source,
          certPath: material.certPath,
          keyPath: material.keyPath,
          subject: material.subject,
          issuer: material.issuer,
          fingerprint256: material.fingerprint256,
          validFrom: material.validFrom,
          validTo: material.validTo,
          subjectAltName: material.subjectAltName,
          selfSigned: material.selfSigned,
        }
      : null,
    trusted,
    handshakeRejections: runtime.handshakes ?? null,
    error: runtime.error,
  }
}
