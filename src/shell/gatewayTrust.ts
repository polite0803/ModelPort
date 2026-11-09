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
 * Two ways to obtain that PEM, and the order matters:
 * - `GET /v1/management/tls/ca` with the sealed management secret, over the same origin the
 *   window is showing. `net.fetch` is Chromium's stack, so it consults the OS store the way
 *   Claude Desktop and the browser do - after a successful install this call starts working
 *   over HTTPS without a special case;
 * - the certificate the TLS layer refused while loading that page (kept by
 *   `main.ts` from `certificate-error`). This is the bootstrap case: the management
 *   endpoint is unreachable *because* the certificate is untrusted, so the only copy
 *   available is the one the handshake already presented. It is also why the console's
 *   failure page carries the install button - an untrusted HTTPS gateway has no page to
 *   click a button on.
 *
 * Nothing here takes a path or a PEM from the page: letting a remote document name the file
 * that gets installed into the user's root store is not a capability anyone intended to ship.
 */
import { net } from 'electron'
import { X509Certificate } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  defaultTrustRuntime,
  installCertificateTrust,
  isCertificateTrusted,
  sha1Thumbprint,
  uninstallCertificateTrust,
} from '../shared/certificateTrust'
import type { TrustRuntime } from '../shared/certificateTrust'
import type { ShellCertificateTrustResult, ShellCertificateTrustStatus } from '../shared/shellBridge'

/** The management endpoint is a local call; a hung gateway must not hang the panel. */
const FETCH_TIMEOUT_MS = 8000

/**
 * A resolved status fetch is reused for a moment: the panel re-reads it on every proxy
 * state change and after each action, and re-downloading the same PEM 4 times a minute
 * buys nothing. The trust probe itself is never cached - it is the reading that changes
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
  source: 'gateway' | 'handshake'
}

export interface TrustTarget {
  /** Normalized origin of the active gateway entry. */
  origin: string
  /** Where this file writes the PEM, under the console's own userData. */
  cachePath: string
  secret: string | null
  /** PEM captured when the TLS layer refused this gateway's certificate. */
  captured: string | null
}

export interface ResolvedCertificate {
  certificate: GatewayCertificate | null
  error: string | null
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

function materialize(
  pem: string,
  cachePath: string,
  origin: string,
  source: GatewayCertificate['source'],
): GatewayCertificate | null {
  const described = describeCertificate(pem)
  if (!described) return null
  // The trust tools read a file, not a string, so the copy has to land on disk first.
  mkdirSync(dirname(cachePath), { recursive: true })
  writeFileSync(cachePath, pem.endsWith('\n') ? pem : `${pem}\n`, { encoding: 'utf8', mode: 0o600 })
  return { ...described, origin, cert: pem, certPath: cachePath, source }
}

async function fetchFromGateway(origin: string, secret: string): Promise<{ pem: string } | { error: string }> {
  let response: Response
  try {
    response = await net.fetch(`${origin}/v1/management/tls/ca`, {
      headers: { 'X-Management-Secret': secret },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (cause) {
    return {
      error:
        `Could not reach ${origin}/v1/management/tls/ca: ${cause instanceof Error ? cause.message : String(cause)}`,
    }
  }
  if (response.status === 404) {
    return { error: 'The gateway has not generated a certificate yet: start it once with HTTPS enabled.' }
  }
  if (response.status === 401 || response.status === 403) {
    return { error: 'The gateway rejected the management secret this console remembered.' }
  }
  if (!response.ok) return { error: `The gateway responded ${response.status}.` }
  const body = (await response.json().catch(() => null)) as { data?: { pem?: unknown } } | null
  if (typeof body?.data?.pem !== 'string' || body.data.pem === '') {
    return { error: 'The gateway answered without a certificate.' }
  }
  return { pem: body.data.pem }
}

let resolvedCache: { key: string; at: number; value: ResolvedCertificate } | null = null

/**
 * The certificate of the active gateway, on disk, on this machine.
 *
 * The refused-handshake copy wins over a failed endpoint call but not over a successful
 * one: the handshake certificate is what the listener presented a moment ago, while the
 * endpoint also reports which file the gateway itself uses, and after a SAN change the
 * captured copy can be the older of the two.
 */
export async function resolveGatewayCertificate(target: TrustTarget): Promise<ResolvedCertificate> {
  // A reissued certificate (a SAN change) must not be served from the cache, so the
  // captured PEM is part of the key - guarded, because an unparsable one is reported by
  // the resolution below rather than thrown out of a cache lookup.
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
    target.cachePath,
    target.secret === null ? 'nosecret' : 'secret',
    capturedKey,
  ].join('\u0000')
  if (resolvedCache && resolvedCache.key === key && Date.now() - resolvedCache.at < RESOLVE_CACHE_MS) {
    return resolvedCache.value
  }

  const value = await resolveUncached(target)
  resolvedCache = { key, at: Date.now(), value }
  return value
}

async function resolveUncached(target: TrustTarget): Promise<ResolvedCertificate> {
  let endpointError: string | null = null

  if (target.secret !== null) {
    const fetched = await fetchFromGateway(target.origin, target.secret)
    if ('pem' in fetched) {
      const certificate = materialize(fetched.pem, target.cachePath, target.origin, 'gateway')
      if (certificate) return { certificate, error: null }
      endpointError = 'The gateway returned something that is not a readable certificate.'
    } else {
      endpointError = fetched.error
    }
  } else {
    endpointError = 'This console has no management secret for this gateway.'
  }

  if (target.captured !== null) {
    const certificate = materialize(target.captured, target.cachePath, target.origin, 'handshake')
    if (certificate) return { certificate, error: null }
    return { certificate: null, error: `The certificate refused during the handshake could not be parsed. ${endpointError ?? ''}`.trim() }
  }

  return {
    certificate: null,
    error: `${endpointError ?? 'The gateway certificate is unavailable.'} Load the gateway page once over HTTPS so the console can capture the certificate it presents.`,
  }
}

export async function gatewayTrustStatus(
  target: TrustTarget,
  runtime: TrustRuntime = defaultTrustRuntime(),
): Promise<ShellCertificateTrustStatus> {
  const { certificate, error } = await resolveGatewayCertificate(target)
  const supported = isTrustPlatform(runtime.platform)
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
  }
}

export async function changeGatewayTrust(
  target: TrustTarget,
  action: 'install' | 'uninstall',
  runtime: TrustRuntime = defaultTrustRuntime(),
): Promise<ShellCertificateTrustResult> {
  const { certificate, error } = await resolveGatewayCertificate(target)
  if (!certificate) {
    return {
      ok: false,
      message: error ?? 'The console could not read the gateway certificate.',
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
