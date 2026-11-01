/**
 * Pure HTTPS configuration helpers shared by the store, the TLS listener and
 * the settings UI. Kept free of Electron imports so tests can exercise them.
 */
/**
 * Names the managed certificate must carry beyond the loopback defaults.
 * Remote clients connect by address, and a TLS certificate is only usable when
 * the name the client types is inside the certificate's SAN.
 */
export const BUILT_IN_SAN_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '::1']

export function isIpv4(value: string): boolean {
  const parts = value.split('.')
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  )
}

export function isIpv6(value: string): boolean {
  if (!value.includes(':')) return false
  return /^[0-9a-f:.]+$/.test(value)
}

export function isDnsName(value: string): boolean {
  return /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(value)
}

export function isAllowedSanHost(value: string): boolean {
  return isIpv4(value) || isIpv6(value) || isDnsName(value)
}

/** Splits any mix of commas/spaces/newlines into deduplicated, validated names. */
export function normalizeSanHostList(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : []
  const out: string[] = []
  for (const entry of raw) {
    for (const piece of String(entry ?? '').split(/[,;\r\n]+/)) {
      const value = piece.trim().toLowerCase()
      if (value === '' || !isAllowedSanHost(value)) continue
      if (!out.includes(value)) out.push(value)
    }
  }
  return out
}

export function validateSanHosts(input: unknown): string[] {
  if (input === undefined) return []
  if (!Array.isArray(input)) return ['HTTPS certificate names must be a list of IPs or hostnames']

  const rejected: string[] = []
  for (const entry of input) {
    for (const piece of String(entry ?? '').split(/[,;\r\n]+/)) {
      const value = piece.trim().toLowerCase()
      if (value === '') continue
      if (!isAllowedSanHost(value)) rejected.push(value)
    }
  }
  return rejected.length > 0
    ? [`HTTPS certificate name is neither an IP nor a hostname: ${rejected.join(', ')}`]
    : []
}

/** The full set a managed certificate must cover for this config. */
export function requiredSanHosts(extra: unknown): string[] {
  const out = [...BUILT_IN_SAN_HOSTS]
  for (const host of normalizeSanHostList(extra)) {
    if (!out.includes(host)) out.push(host)
  }
  return out
}

export interface HttpsConfigFields {
  proxyPort?: number
  httpsEnabled?: boolean
  httpsPort?: number
  httpsCertPath?: string
  httpsKeyPath?: string
  httpsSanHosts?: string[]
}

export function validateHttpsConfig(fields: HttpsConfigFields): string[] {
  const errors: string[] = validateSanHosts(fields.httpsSanHosts)

  if (fields.httpsPort !== undefined) {
    if (!Number.isInteger(fields.httpsPort) || fields.httpsPort < 1 || fields.httpsPort > 65535) {
      errors.push('HTTPS port must be between 1-65535')
    }
    if (
      fields.httpsEnabled &&
      fields.proxyPort !== undefined &&
      fields.httpsPort === fields.proxyPort
    ) {
      errors.push('HTTPS port must differ from the proxy port')
    }
  }

  const hasCertPath = typeof fields.httpsCertPath === 'string' && fields.httpsCertPath.trim() !== ''
  const hasKeyPath = typeof fields.httpsKeyPath === 'string' && fields.httpsKeyPath.trim() !== ''
  if (hasCertPath !== hasKeyPath) {
    errors.push('HTTPS certificate and key must be provided together')
  }

  return errors
}

export function formatHostForUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

export function buildHttpsUrl(host: string, port: number): string {
  return `https://${formatHostForUrl(host)}:${port}`
}

export function buildProxyUrl(host: string, port: number, https: boolean): string {
  return `${https ? 'https' : 'http'}://${formatHostForUrl(host)}:${port}`
}
