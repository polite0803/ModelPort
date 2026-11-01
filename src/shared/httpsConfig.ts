/**
 * Pure HTTPS configuration helpers shared by the store, the TLS listener and
 * the settings UI. Kept free of Electron imports so tests can exercise them.
 */
export interface HttpsConfigFields {
  proxyPort?: number
  httpsEnabled?: boolean
  httpsPort?: number
  httpsCertPath?: string
  httpsKeyPath?: string
}

export function validateHttpsConfig(fields: HttpsConfigFields): string[] {
  const errors: string[] = []

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
