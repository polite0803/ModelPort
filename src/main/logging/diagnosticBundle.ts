import { app } from 'electron'
import { arch, platform } from 'node:os'
import { storeManager } from '../store/store'
import type { LogEntry, RequestDiagnosticBundle, RequestLogEntry } from '../../shared/types.ts'

function findRequestLog(key: string): RequestLogEntry | null {
  const byId = storeManager.getRequestLogById(key)
  if (byId) return byId
  return storeManager.getRequestLogs(500).find((entry) => entry.requestId === key) ?? null
}

function configSnapshot(): Record<string, unknown> {
  const config = storeManager.getConfig()
  return {
    proxy: {
      host: config.proxyHost,
      port: config.proxyPort,
      httpsEnabled: config.httpsEnabled,
      httpsPort: config.httpsPort,
    },
    loadBalanceStrategy: config.loadBalanceStrategy,
    logLevel: config.logLevel,
    logRetentionDays: config.logRetentionDays,
    requestLogConfig: config.requestLogConfig,
    requestTimeout: config.requestTimeout,
    retryCount: config.retryCount,
    defaultMaxOutputTokens: config.defaultMaxOutputTokens,
    // Names/flags only: route bodies and provider credentials stay out.
    modelMappings: Object.keys(config.modelMappings ?? {}),
    routes: Object.entries(config.routes ?? {}).map(([name, route]) => {
      const record = route as unknown as { enabled?: unknown; models?: unknown }
      return {
        name,
        enabled: record.enabled ?? null,
        modelCount: Array.isArray(record.models) ? record.models.length : null,
      }
    }),
  }
}

/**
 * Build one request's diagnostic bundle. The key may be the request-log row id
 * (what the UI has) or the `X-Request-Id` value (what a client can quote).
 */
export function buildRequestDiagnosticBundle(key: string): RequestDiagnosticBundle {
  const request = findRequestLog(key)
  const requestId = request?.requestId
  const allLogs = storeManager.getLogs()
  const related = requestId
    ? allLogs.filter((entry) => entry.requestId === requestId)
    : []

  return {
    generatedAt: new Date().toISOString(),
    app: {
      version: app.getVersion(),
      electron: process.versions.electron ?? 'unknown',
      node: process.versions.node,
      platform: platform(),
      arch: arch(),
    },
    request,
    relatedLogs: related.slice(0, 500) as LogEntry[],
    config: configSnapshot(),
  }
}
