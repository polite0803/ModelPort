/**
 * Writing a certificate into, reading it out of, and probing the OS trust store.
 *
 * This lives in `@shared` because two different machines run the same three commands.
 * The gateway runs them for the machine hosting the listener - which, under WSL or a
 * remote deployment, is not the machine whose browser is refusing the certificate. The
 * console runs them for the machine in front of the user. One copy is the point: the
 * Windows removal hazard below and the thumbprint shape the probe compares against are
 * exactly the details that break silently when they are duplicated and drift.
 *
 * The OS call is injected through `TrustRuntime`, so the argument shapes and the output
 * parsing are testable without touching a real certificate store.
 */
import { execFile } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { TlsTrustResult } from './types.ts'

/** The two things the trust tools need: the certificate and where it sits on *this* disk. */
export interface TrustMaterial {
  /** PEM of the certificate; never the private key. */
  cert: string
  /** Path the OS tool reads. It must exist and hold `cert`. */
  certPath: string
}

export interface TrustCommandResult {
  ok: boolean
  output: string
}

/** Everything platform-specific about the trust store, so callers can substitute it. */
export interface TrustRuntime {
  platform: string
  home: string
  run(file: string, args: string[]): Promise<TrustCommandResult>
}

export function defaultTrustRuntime(): TrustRuntime {
  return {
    platform: process.platform,
    home: homedir(),
    run: (file, args) =>
      new Promise((resolve) => {
        execFile(file, args, { windowsHide: true, timeout: 20000 }, (error, stdout, stderr) => {
          resolve({ ok: !error, output: `${stdout ?? ''}${stderr ?? ''}`.trim() })
        })
      }),
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
 * Whether the certificate is trusted by the OS store of the machine this runtime runs on.
 * Chromium-based clients (Claude Desktop, browsers) use that store, so this is the same
 * question the client will ask. null means the platform has no cheap probe.
 *
 * ⚠️ A `true` here says nothing about Node-based clients (Codex CLI, the
 * WorkBuddy/CodeBuddy agent, anything using `node:https` or undici): Node never
 * consults the OS store, it uses its bundled CA set plus `NODE_EXTRA_CA_CERTS`.
 */
export async function isCertificateTrusted(
  material: TrustMaterial,
  runtime: TrustRuntime = defaultTrustRuntime(),
): Promise<boolean | null> {
  if (runtime.platform === 'win32') {
    const thumbprint = sha1Thumbprint(material.cert)
    const command = `(Get-ChildItem Cert:\\CurrentUser\\Root | Where-Object { $_.Thumbprint -eq '${thumbprint}' } | Measure-Object).Count`
    const result = await runtime.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command])
    if (!result.ok) return null
    return result.output.trim() === '1'
  }

  if (runtime.platform === 'darwin') {
    const result = await runtime.run('security', ['verify-cert', '-c', material.certPath, '-p', 'ssl'])
    return result.ok
  }

  return null
}

export async function installCertificateTrust(
  material: TrustMaterial,
  runtime: TrustRuntime = defaultTrustRuntime(),
): Promise<TlsTrustResult> {
  if (runtime.platform === 'win32') {
    const result = await runtime.run('certutil', ['-user', '-addstore', 'Root', material.certPath])
    if (!result.ok) {
      return { ok: false, message: result.output || 'certutil failed to install the certificate', trusted: false }
    }
    return {
      ok: true,
      message: 'Certificate installed into the current user Trusted Root store. Restart the client to pick it up.',
      trusted: await isCertificateTrusted(material, runtime),
    }
  }

  if (runtime.platform === 'darwin') {
    const result = await runtime.run('security', [
      'add-trusted-cert',
      '-r',
      'trustRoot',
      '-k',
      loginKeychainPath(runtime),
      material.certPath,
    ])
    if (!result.ok) {
      return { ok: false, message: result.output || 'security add-trusted-cert failed', trusted: false }
    }
    return {
      ok: true,
      message: 'Certificate added to the login keychain trust settings. Restart the client to pick it up.',
      trusted: await isCertificateTrusted(material, runtime),
    }
  }

  return {
    ok: false,
    message: `On Linux, trust the certificate manually, e.g. sudo trust anchor --store "${material.certPath}" (or copy it to /usr/local/share/ca-certificates/ and run update-ca-certificates).`,
    trusted: null,
  }
}

/**
 * Takes the certificate out of the OS trust store again.
 *
 * ⚠️ Windows deliberately does **not** use `certutil -delstore`: measured on this
 * machine, a serial that matches nothing still exits 0 and removes the *first*
 * entry of the store. The PowerShell form below filters on the exact SHA-1 and
 * deletes nothing when there is no match.
 */
export async function uninstallCertificateTrust(
  material: TrustMaterial,
  runtime: TrustRuntime = defaultTrustRuntime(),
): Promise<TlsTrustResult> {
  if (runtime.platform === 'win32') {
    const thumbprint = sha1Thumbprint(material.cert)
    const command =
      `$found = @(Get-ChildItem Cert:\\CurrentUser\\Root | Where-Object { $_.Thumbprint -eq '${thumbprint}' }); ` +
      "if ($found.Count -eq 0) { 'NOT-INSTALLED' } else { $found | Remove-Item; 'REMOVED=' + $found.Count }"
    const result = await runtime.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command])
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
      trusted: await isCertificateTrusted(material, runtime),
    }
  }

  if (runtime.platform === 'darwin') {
    const result = await runtime.run('security', [
      'delete-certificate',
      '-Z',
      sha1Thumbprint(material.cert),
      loginKeychainPath(runtime),
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
      trusted: await isCertificateTrusted(material, runtime),
    }
  }

  return {
    ok: false,
    message: `On Linux, remove the trust anchor manually, e.g. sudo trust anchor --remove "${material.certPath}" (or delete it from /usr/local/share/ca-certificates/ and run update-ca-certificates).`,
    trusted: null,
  }
}

function loginKeychainPath(runtime: TrustRuntime): string {
  const db = join(runtime.home, 'Library', 'Keychains', 'login.keychain-db')
  return existsSync(db) ? db : 'login.keychain'
}
