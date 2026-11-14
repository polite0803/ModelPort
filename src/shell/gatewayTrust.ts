/**
 * Certificate trust for the machine the console runs on.
 *
 * Why this is a shell file and not a gateway call: the panel is served by the gateway, so
 * `tls:status` and `tls:install-trust` describe and mutate the trust store of the machine
 * *hosting the listener*. In WSL that is a Linux daemon (where the command is not even
 * available), in a remote deployment it is somebody else's computer, and in local mode the
 * two machines happen to coincide - which is exactly why the mismatch went unnoticed. The
 * certificate has to be trusted on the machine that runs the client, so the console reads
 * the PEM itself and writes it into its own OS store.
 *
 * Which certificate is the question: the one the CLIENT actually handshakes with on this
 * access path, never the gateway's own CA. The same gateway presents its self-signed cert
 * when reached by IP but a public edge cert (Let's Encrypt behind Cloudflare) when reached
 * by domain, and the gateway cannot tell those apart - asking its management endpoint for
 * "the certificate" answers a question about the wrong path. So the evidence order is:
 * - probe the entry's client https endpoint with Chromium's TLS stack (`net.fetch`), which
 *   consults the OS store exactly like Claude Desktop and the browser do. Any HTTP answer,
 *   even 401, means the handshake succeeded: the certificate is public or already
 *   installed, and there is nothing to install;
 * - a refused handshake means the machine does not trust what this path presents. Read the
 *   leaf the endpoint presents right now (a plain TLS connect that does not judge - the
 *   probe already judged) and offer it for install;
 * - the certificate the window's TLS layer refused while loading the page (kept by
 *   `main.ts` from `certificate-error`) is the bootstrap fallback: it is the only copy
 *   available when even the leaf read fails, and it is why the console's failure page
 *   carries the install button - an untrusted HTTPS gateway has no page to click one on.
 *
 * Nothing here takes a path or a PEM from the page: letting a remote document name the file
 * that gets installed into the user's root store is not a capability anyone intended to ship.
 */
import { X509Certificate } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { connect as tlsConnect } from 'node:tls'
import {
  defaultTrustRuntime,
  installCertificateTrust,
  isCertificateTrusted,
  sha1Thumbprint,
  uninstallCertificateTrust,
} from '../shared/certificateTrust.ts'
import type { TrustRuntime } from '../shared/certificateTrust.ts'
import type { ShellCertificateTrustResult, ShellCertificateTrustStatus } from '../shared/shellBridge.ts'

/** A hung endpoint must not hang the panel. */
const FETCH_TIMEOUT_MS = 8000

/**
 * A resolved status is reused for a moment: the panel re-reads it on every proxy state
 * change and after each action, and re-probing the same endpoint 4 times a minute buys
 * nothing. The trust-store probe itself is never cached - it is the reading that changes
 * right after an install.
 */
const RESOLVE_CACHE_MS = 10_000

export interface CertificateDescription {
  subject: string
  issuer: string
  fingerprint256: string
  /** SHA-1, uppercase, no separators: the shape the store probe compares against. */
  sha1: string
  validTo: string
  subjectAltName: string | null
  selfSigned: boolean
}

export interface GatewayCertificate extends CertificateDescription {
  origin: string
  /** The PEM itself, under the name `TrustMaterial` expects: the store tools read `cert`. */
  cert: string
  /** Path on this machine, where the PEM was just written. */
  certPath: string
  source: 'handshake'
}

export interface TrustTarget {
  /** Normalized origin of the active gateway entry. */
  origin: string
  /**
   * The client-facing https endpoint of THIS access path: the entry's url when it is
   * already https, otherwise the entry's stored `clientHttpsUrl`. null = this entry has
   * no https client path (loopback http needs no trust; a remote http entry must store
   * one first). Access-path data lives on the entry, never derived from the gateway.
   */
  clientOrigin: string | null
  /** Where this file writes the PEM, under the console's own userData. */
  cachePath: string
  /** PEM captured when the TLS layer refused this gateway's certificate. */
  captured: string | null
}

/**
 * The handshake verdict, in the client's own TLS stack. 'trusted' = any HTTP answer (the
 * certificate was accepted); certError = the TLS layer refused it; unreachable = no TLS
 * conversation happened at all (offline, wrong port), which is not a trust judgement.
 */
export type ProbeOutcome = 'trusted' | { certError: string } | { unreachable: string }

export interface HandshakeProbe {
  handshake(clientOrigin: string): Promise<ProbeOutcome>
  /** The leaf presented right now, read without verifying (the handshake already judged). */
  presentedLeaf(clientOrigin: string): Promise<string | null>
}

export interface ResolvedCertificate {
  certificate: GatewayCertificate | null
  error: string | null
  /** The client handshake succeeded: public or already-installed certificate, nothing to install. */
  pathTrusted: boolean
}

/** Parses a PEM into the fields both the failure page and the panel show. */
export function describeCertificate(pem: string): CertificateDescription | null {
  try {
    const x509 = new X509Certificate(pem)
    return {
      subject: x509.subject,
      issuer: x509.issuer,
      fingerprint256: x509.fingerprint256,
      sha1: sha1Thumbprint(pem),
      validTo: x509.validTo,
      subjectAltName: x509.subjectAltName ?? null,
      selfSigned: x509.subject === x509.issuer,
    }
  } catch {
    return null
  }
}

function isTrustPlatform(platform: string): boolean {
  return platform === 'win32' || platform === 'darwin'
}

function materialize(pem: string, cachePath: string, origin: string): GatewayCertificate | null {
  const described = describeCertificate(pem)
  if (!described) return null
  // The trust tools read a file, not a string, so the copy has to land on disk first.
  mkdirSync(dirname(cachePath), { recursive: true })
  writeFileSync(cachePath, pem.endsWith('\n') ? pem : `${pem}\n`, { encoding: 'utf8', mode: 0o600 })
  return { ...described, origin, cert: pem, certPath: cachePath, source: 'handshake' }
}

function isCertErrorMessage(message: string): boolean {
  return /ERR_CERT_|ERR_SSL|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO|CERTIFICATE/i.test(message)
}

/**
 * The real probe. `net` is imported lazily so this module stays importable by plain-Node
 * tests, which inject their own probe; in the console the import resolves to Electron.
 */
export function defaultHandshakeProbe(): HandshakeProbe {
  return {
    async handshake(clientOrigin) {
      const { net } = await import('electron')
      try {
        await net.fetch(`${clientOrigin}/v1/models`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
        return 'trusted'
      } catch (cause) {
        const message = cause instanceof Error
          ? `${cause.message}${cause.cause instanceof Error ? ` ${cause.cause.message}` : ''}`
          : String(cause)
        return isCertErrorMessage(message) ? { certError: message } : { unreachable: message }
      }
    },
    presentedLeaf(clientOrigin) {
      return new Promise(resolve => {
        let settled = false
        const done = (pem: string | null): void => {
          if (!settled) {
            settled = true
            resolve(pem)
          }
        }
        let url: URL
        try {
          url = new URL(clientOrigin)
        } catch {
          done(null)
          return
        }
        const hostname = url.hostname.replace(/^\[|\]$/g, '')
        const isIp = /^[\d.]+$/.test(hostname) || hostname.includes(':')
        const socket = tlsConnect(
          {
            host: hostname,
            port: url.port === '' ? 443 : Number(url.port),
            // SNI is a DNS-name extension; an IP literal must not be sent as one.
            ...(isIp ? {} : { servername: hostname }),
            rejectUnauthorized: false,
            timeout: FETCH_TIMEOUT_MS,
          },
          () => {
            const cert = socket.getPeerCertificate()
            socket.end()
            if (!cert || !cert.raw) {
              done(null)
              return
            }
            const lines = cert.raw.toString('base64').match(/.{1,64}/g) ?? []
            done(`-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`)
          },
        )
        socket.on('error', () => done(null))
        socket.on('timeout', () => {
          socket.destroy()
          done(null)
        })
      })
    },
  }
}

/**
 * The client https origin of an access path. An https entry is its own endpoint; an http
 * entry uses its stored `clientHttpsUrl`, or auto-detects one from the gateway when absent
 * (the same host on the gateway's advertised httpsPort). Detection spares the user typing the
 * address by hand; the trust probe uses it ephemerally and never persists it, so the blind
 * suggestion cannot reach the client switch, which keeps reading the stored entry value.
 * `detect` is injected so this stays importable by plain-Node tests.
 */
export async function resolveClientOrigin(
  origin: string,
  stored: string | null,
  detect: () => Promise<string | null>,
): Promise<string | null> {
  if (origin.startsWith('https:')) return origin
  if (stored !== null && stored.startsWith('https:')) return stored
  return await detect()
}

let resolvedCache: { key: string; at: number; value: ResolvedCertificate } | null = null

/**
 * The certificate of the active entry's client https path, on disk, on this machine.
 *
 * The handshake verdict comes first; the presented leaf (or the window's captured copy as
 * bootstrap) is only materialized when the machine refused it. A reissued certificate must
 * not be served from the cache, so the captured PEM is part of the key - guarded, because
 * an unparsable one is reported by the resolution below rather than thrown out of a lookup.
 */
export async function resolveGatewayCertificate(
  target: TrustTarget,
  probe: HandshakeProbe = defaultHandshakeProbe(),
): Promise<ResolvedCertificate> {
  let capturedKey = ''
  if (target.captured !== null) {
    try {
      capturedKey = sha1Thumbprint(target.captured)
    } catch {
      capturedKey = 'unparsable'
    }
  }
  const key = [
    target.origin,
    target.clientOrigin ?? 'nohttps',
    target.cachePath,
    capturedKey,
  ].join('\u0000')
  if (resolvedCache && resolvedCache.key === key && Date.now() - resolvedCache.at < RESOLVE_CACHE_MS) {
    return resolvedCache.value
  }

  const value = await resolveUncached(target, probe)
  resolvedCache = { key, at: Date.now(), value }
  return value
}

async function resolveUncached(target: TrustTarget, probe: HandshakeProbe): Promise<ResolvedCertificate> {
  if (target.clientOrigin === null) {
    return {
      certificate: null,
      error: '这条入口没有可用的客户端 HTTPS 地址：回环 http 无需证书信任；远程网关需开启 HTTPS 监听并在本控制台保存管理密钥，地址会自动从网关探测（也可在网关条目手动填「客户端 HTTPS 地址」）。',
      pathTrusted: false,
    }
  }

  const outcome = await probe.handshake(target.clientOrigin)
  if (outcome === 'trusted') {
    return { certificate: null, error: null, pathTrusted: true }
  }

  // Refused (or unreachable): the certificate the client actually sees is the evidence.
  // Read what this endpoint presents now; the window's captured copy is the bootstrap
  // fallback for when even that read fails.
  const presented = 'certError' in outcome ? await probe.presentedLeaf(target.clientOrigin) : null
  const pem = presented ?? target.captured
  if (pem !== null) {
    const certificate = materialize(pem, target.cachePath, target.clientOrigin)
    if (certificate) {
      return {
        certificate,
        error: 'certError' in outcome ? `客户端握手被拒：${outcome.certError}` : null,
        pathTrusted: false,
      }
    }
  }

  const reason = 'certError' in outcome ? outcome.certError : outcome.unreachable
  return {
    certificate: null,
    error: `无法取得客户端证书（${reason}）。请先让这条入口的客户端 HTTPS 地址可达，再打开本页。`,
    pathTrusted: false,
  }
}

export async function gatewayTrustStatus(
  target: TrustTarget,
  runtime: TrustRuntime = defaultTrustRuntime(),
  probe: HandshakeProbe = defaultHandshakeProbe(),
): Promise<ShellCertificateTrustStatus> {
  const { certificate, error, pathTrusted } = await resolveGatewayCertificate(target, probe)
  const supported = isTrustPlatform(runtime.platform)
  if (pathTrusted) {
    return {
      supported,
      trusted: true,
      fingerprint256: null,
      sha1: null,
      subject: null,
      issuer: null,
      validTo: null,
      subjectAltName: null,
      selfSigned: null,
      source: null,
      certPath: null,
    }
  }
  if (!certificate) {
    return {
      supported,
      trusted: null,
      fingerprint256: null,
      sha1: null,
      subject: null,
      issuer: null,
      validTo: null,
      subjectAltName: null,
      selfSigned: null,
      source: null,
      certPath: null,
      error: error ?? undefined,
    }
  }
  return {
    supported,
    trusted: await isCertificateTrusted(certificate, runtime),
    fingerprint256: certificate.fingerprint256,
    sha1: certificate.sha1,
    subject: certificate.subject,
    issuer: certificate.issuer,
    validTo: certificate.validTo,
    subjectAltName: certificate.subjectAltName,
    selfSigned: certificate.selfSigned,
    source: certificate.source,
    certPath: certificate.certPath,
    ...(error ? { error } : {}),
  }
}

export async function changeGatewayTrust(
  target: TrustTarget,
  action: 'install' | 'uninstall',
  runtime: TrustRuntime = defaultTrustRuntime(),
  probe: HandshakeProbe = defaultHandshakeProbe(),
): Promise<ShellCertificateTrustResult> {
  const { certificate, error, pathTrusted } = await resolveGatewayCertificate(target, probe)
  if (pathTrusted) {
    return {
      ok: true,
      message: 'The client https handshake succeeds: the certificate is publicly trusted or already installed. Nothing to install.',
      trusted: true,
      fingerprint256: null,
      certPath: null,
    }
  }
  if (!certificate) {
    return {
      ok: false,
      message: error ?? 'The console could not read the client certificate.',
      trusted: null,
      fingerprint256: null,
      certPath: null,
    }
  }

  const evidence = { fingerprint256: certificate.fingerprint256, certPath: certificate.certPath }

  // A certificate that is already in the store needs no second write, and saying so is
  // more useful than re-running the OS command over it.
  if (action === 'install') {
    const already = await isCertificateTrusted(certificate, runtime)
    if (already === true) {
      return {
        ok: true,
        message: 'This certificate is already trusted on this machine. Restart the client to pick it up.',
        trusted: true,
        ...evidence,
      }
    }
    // A leaf issued by someone else does not become a trust anchor by being copied into
    // the root store; the issuer is what has to be trusted. Refusing beats a silent no-op.
    if (certificate.selfSigned === false) {
      return {
        ok: false,
        message:
          'This certificate is not self-signed: the machine has to trust its issuing CA, not this leaf. ' +
          'Install the issuer certificate instead - a non-CA certificate added to the root store changes nothing.',
        trusted: already,
        ...evidence,
      }
    }
  }

  const result =
    action === 'install'
      ? await installCertificateTrust(certificate, runtime)
      : await uninstallCertificateTrust(certificate, runtime)
  return { ...result, ...evidence }
}