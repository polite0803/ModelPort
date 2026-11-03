/**
 * Management API - TLS Routes
 *
 * The settings page can only act on the machine it runs on, and installing the
 * certificate into the OS trust store only helps Chromium/Schannel clients.
 * A remote machine running a Node-based client needs the certificate itself,
 * plus the evidence of whether its handshakes were refused.
 */

import Router from '@koa/router'
import type { Context } from 'koa'
import { managementAuthMiddleware } from '../../middleware/managementAuth'
import { proxyServer } from '../../server'
import { getTlsStatus, tryReadTlsMaterial } from '../../tls'
import ConfigManager from '../../../store/config'
import type { ManagementApiResponse, TlsCertificateBundle } from '../../../../shared/types'

const router = new Router({ prefix: '/v1/management/tls' })

router.use(managementAuthMiddleware)

/** The certificate the HTTPS listener presents. Public data: never the key. */
router.get('/ca', async (ctx: Context) => {
  const material = tryReadTlsMaterial(ConfigManager.get())
  if (!material) {
    ctx.status = 404
    ctx.body = {
      success: false,
      error: {
        code: 'certificate_not_found',
        message:
          'No HTTPS certificate on disk yet. Start the proxy once with HTTPS enabled, or configure a custom certificate.',
      },
    } as ManagementApiResponse
    return
  }

  ctx.body = {
    success: true,
    data: {
      certPath: material.certPath,
      pem: material.cert,
      source: material.source,
      subject: material.subject,
      issuer: material.issuer,
      fingerprint256: material.fingerprint256,
      validTo: material.validTo,
      subjectAltName: material.subjectAltName,
      selfSigned: material.selfSigned,
    },
  } as ManagementApiResponse<TlsCertificateBundle>
})

/** Listener state plus the handshake rejections that never became requests. */
router.get('/status', async (ctx: Context) => {
  const status = await getTlsStatus(ConfigManager.get(), proxyServer.getHttpsRuntimeStatus())

  ctx.body = {
    success: true,
    data: status,
  } as ManagementApiResponse<typeof status>
})

export default router
