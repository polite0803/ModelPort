import { X509Certificate, createPrivateKey, createPublicKey } from 'crypto'
import { execFile } from 'child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { generate } from 'selfsigned'
import type { TlsCertificateInfo, TlsStatus, TlsTrustResult } from '../../shared/types'
import type { AppConfig } from '../store/types'
import { buildHttpsUrl } from '../../shared/httpsConfig.ts'

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

function managedCertificateUsable(certPem: string): boolean {
  try {
    const x509 = new X509Certificate(certPem)
    if (Date.parse(x509.validTo) - Date.now() < RENEW_BEFORE_MS) return false
    return x509.checkHost('localhost') !== undefined && x509.checkIP('127.0.0.1') !== undefined
  } catch {
    return false
  }
}

function generateManagedMaterial(): TlsMaterial {
  const { certPath, keyPath } = managedPaths()
  mkdirSync(MANAGED_DIR, { recursive: true })
  const result = generate(
    [{ name: 'commonName', value: 'ModelPort Local' }],
    {
      days: CERT_DAYS,
      keySize: 2048,
      algorithm: 'sha256',
      notBeforeDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      extensions: [
        { name: 'basicConstraints', cA: true, pathLenConstraint: 0 },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, keyCertSign: true },
        { name: 'extKeyUsage', serverAuth: true },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' },
            { type: 7, ip: '::1' },
          ],
        },
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

function ensureManagedMaterial(): TlsMaterial {
  const { certPath, keyPath } = managedPaths()
  if (existsSync(certPath) && existsSync(keyPath)) {
    try {
      const material = readPair(certPath, keyPath, 'managed')
      if (managedCertificateUsable(material.cert)) return material
    } catch {
      // Unreadable or mismatched pair: fall through and regenerate.
    }
  }
  return generateManagedMaterial()
}

/**
 * Resolves the certificate the HTTPS listener should present. Custom PEM paths
 * win; otherwise the app-managed self-signed cert is generated on first use and
 * renewed shortly before it expires.
 */
export function loadTlsMaterial(config: Pick<AppConfig, 'httpsCertPath' | 'httpsKeyPath'>): TlsMaterial {
  const hasCert = typeof config.httpsCertPath === 'string' && config.httpsCertPath.trim() !== ''
  const hasKey = typeof config.httpsKeyPath === 'string' && config.httpsKeyPath.trim() !== ''
  if (hasCert !== hasKey) {
    throw new Error('HTTPS certificate and key must be provided together')
  }
  if (hasCert && hasKey) {
    return readPair(config.httpsCertPath as string, config.httpsKeyPath as string, 'custom')
  }
  return ensureManagedMaterial()
}

/** Reads an existing certificate for display without generating a new one. */
export function tryReadTlsMaterial(config: Pick<AppConfig, 'httpsCertPath' | 'httpsKeyPath'>): TlsMaterial | null {
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
 * Whether the certificate is trusted by the OS store. Chromium-based clients
 * (Claude Desktop) use that store on Windows and macOS, so this is the same
 * question the client will ask. null means the platform has no cheap probe.
 */
export async function isCertificateTrusted(material: TlsMaterial): Promise<boolean | null> {
  if (process.platform === 'win32') {
    const thumbprint = new X509Certificate(material.cert).fingerprint.replace(/:/g, '').toUpperCase()
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
    const loginKeychain = join(homedir(), 'Library', 'Keychains', 'login.keychain-db')
    const keychain = existsSync(loginKeychain) ? loginKeychain : 'login.keychain'
    const result = await run('security', ['add-trusted-cert', '-r', 'trustRoot', '-k', keychain, material.certPath])
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
    error: runtime.error,
  }
}
