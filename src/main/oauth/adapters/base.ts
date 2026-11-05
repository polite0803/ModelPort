/**
 * OAuth Adapter Base Class
 * Defines common interface and base implementation for all provider authentication adapters
 */

import { getHost } from '../../runtime/host'
import http from 'http'
import crypto from 'crypto'
import {
  ProviderType,
  AuthMethod,
  OAuthResult,
  OAuthOptions,
  OAuthCallbackData,
  TokenValidationResult,
  CredentialInfo,
  AdapterConfig,
  OAuthProgressEvent,
} from '../types'

/**
 * 回调页要把上游回传的 error / error_description 排进 HTML，这两个值来自 URL 查询串，
 * 是外部输入；内联给 `window.electronAPI.send` 的 JSON 同理，`</script>` 会提前闭合标签。
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeInlineJson(value: string): string {
  return value.replace(/</g, '\\u003c')
}

/**
 * OAuth adapter abstract base class
 */
export abstract class BaseOAuthAdapter {
  protected config: AdapterConfig
  protected callbackServer: http.Server | null = null
  protected callbackPort: number
  protected state: string = ''
  protected progressCallback: ((event: OAuthProgressEvent) => void) | null = null

  constructor(config: AdapterConfig) {
    this.config = config
    this.callbackPort = config.callbackPort || 8311
  }

  /**
   * Get provider type
   */
  getProviderType(): ProviderType {
    return this.config.providerType
  }

  /**
   * Get supported authentication methods
   */
  getSupportedAuthMethods(): AuthMethod[] {
    return this.config.authMethods
  }

  /**
   * Set progress callback
   */
  setProgressCallback(callback: (event: OAuthProgressEvent) => void): void {
    this.progressCallback = callback
  }

  /**
   * Emit progress event
   */
  protected emitProgress(status: OAuthProgressEvent['status'], message: string, data?: Record<string, unknown>): void {
    if (this.progressCallback) {
      this.progressCallback({ status, message, data })
    }
  }

  /**
   * Generate random state string
   */
  protected generateState(): string {
    this.state = crypto.randomBytes(16).toString('hex')
    return this.state
  }

  /**
   * Validate state string
   *
   * 常量时间比较：state 是这次登录唯一的「这一笔是我发起的」凭据，明文 `===` 会按
   * 首个不匹配字节提前返回。
   */
  protected validateState(state: string): boolean {
    if (!this.state || !state) return false
    const expected = Buffer.from(this.state, 'utf-8')
    const provided = Buffer.from(state, 'utf-8')
    return expected.length === provided.length && crypto.timingSafeEqual(expected, provided)
  }

  /**
   * Create local callback server
   *
   * 回环绑定是硬性要求，不是偏好：这一页会把 `code` / `token` 交给 `processCallback`
   * 去换凭据，任何非回环监听都等于让同网段的任意主机替用户完成这一步。端口自增只
   * 允许有限次，并且始终以 `server.address()` 的实际端口为准 —— `redirect_uri` 用
   * 的就是这里返回的那个数。
   */
  protected async createCallbackServer(): Promise<number> {
    const LOOPBACK_HOST = '127.0.0.1'
    const MAX_PORT_ATTEMPTS = 10

    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.handleCallback(req, res)
      })
      this.callbackServer = server

      let attempts = 0
      const tryListen = (): void => {
        attempts++
        server.once('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'EADDRINUSE' && attempts < MAX_PORT_ATTEMPTS) {
            this.callbackPort++
            tryListen()
            return
          }
          this.callbackServer = null
          reject(error)
        })

        server.listen(this.callbackPort, LOOPBACK_HOST, () => {
          const address = server.address()
          const port = address && typeof address === 'object' ? address.port : this.callbackPort
          this.callbackPort = port
          resolve(port)
        })
      }

      tryListen()
    })
  }

  /**
   * Close callback server
   */
  protected closeCallbackServer(): void {
    if (this.callbackServer) {
      this.callbackServer.close()
      this.callbackServer = null
    }
  }

  /**
   * Handle OAuth callback
   */
  protected handleCallback(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url || '/', `http://localhost:${this.callbackPort}`)
    const data: OAuthCallbackData = {
      code: url.searchParams.get('code') || undefined,
      token: url.searchParams.get('token') || undefined,
      state: url.searchParams.get('state') || undefined,
      error: url.searchParams.get('error') || undefined,
      errorDescription: url.searchParams.get('error_description') || undefined,
    }

    // `state` 是这一次登录唯一的「请求由我发起」凭据。缺它或不匹配就拒绝：否则任意
    // 进程向本机回环端口打一串授权码，就能把攻击者的账号绑进这台机器。
    // 子类必须在发起授权前调用 generateState()，否则 this.state 为空、回调一律被拒。
    if (!data.state || !this.validateState(data.state)) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end('Invalid or missing OAuth state')
      this.emitProgress('error', 'OAuth callback rejected: invalid state')
      return
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>OAuth Callback</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
          }
          .container {
            text-align: center;
            padding: 40px;
            background: rgba(255,255,255,0.1);
            border-radius: 16px;
            backdrop-filter: blur(10px);
          }
          .success { color: #4ade80; }
          .error { color: #f87171; }
        </style>
      </head>
      <body>
        <div class="container">
          ${data.error 
            ? `<h1 class="error">❌ Login Failed</h1><p>${escapeHtml(data.errorDescription || data.error || '')}</p>`
            : `<h1 class="success">✅ Login Successful</h1><p>Processing, please wait...</p>`
          }
          <p style="font-size: 12px; opacity: 0.7;">This window can be closed</p>
        </div>
        <script>
          if (window.electronAPI) {
            window.electronAPI.send('oauth:callback', ${escapeInlineJson(JSON.stringify(data))});
          }
          setTimeout(() => window.close(), 2000);
        </script>
      </body>
      </html>
    `)

    // 交换令牌、写 store、通知窗口都在 processCallback 里，全部发生在响应已经发出去
    // 之后。不接住它的拒绝，用户会看到「登录成功」而账号其实没落地。
    void this.processCallback(data).catch((error: unknown) => {
      this.emitProgress('error', error instanceof Error ? error.message : String(error))
    })
  }

  /**
   * Open URL in system browser
   */
  protected async openBrowser(url: string): Promise<void> {
    getHost().openExternal(url)
  }

  /**
   * Start OAuth login flow
   */
  async startLogin(options: OAuthOptions): Promise<OAuthResult> {
    throw new Error('Subclass must implement startLogin method')
  }

  /**
   * Cancel login flow
   */
  async cancelLogin(): Promise<void> {
    this.closeCallbackServer()
    this.emitProgress('cancelled', 'Login cancelled')
  }

  /**
   * Process callback data
   */
  protected async processCallback(data: OAuthCallbackData): Promise<void> {
    throw new Error('Subclass must implement processCallback method')
  }

  /**
   * Validate token validity
   */
  async validateToken(credentials: Record<string, string>): Promise<TokenValidationResult> {
    throw new Error('Subclass must implement validateToken method')
  }

  /**
   * Refresh token
   */
  async refreshToken(credentials: Record<string, string>): Promise<CredentialInfo | null> {
    throw new Error('Subclass must implement refreshToken method')
  }

  /**
   * Get login URL
   */
  protected getLoginUrl(): string {
    return this.config.loginUrl || ''
  }

  /**
   * Get API URL
   */
  protected getApiUrl(): string {
    return this.config.apiUrl || ''
  }

  /**
   * Generate UUID
   */
  protected generateUUID(): string {
    return crypto.randomUUID()
  }

  /**
   * Generate MD5 hash
   */
  protected md5(input: string): string {
    return crypto.createHash('md5').update(input).digest('hex')
  }

  /**
   * Get current timestamp (seconds)
   */
  protected getTimestamp(): number {
    return Math.floor(Date.now() / 1000)
  }

  /**
   * Get current timestamp (milliseconds)
   */
  protected getTimestampMs(): number {
    return Date.now()
  }

  /**
   * Parse JWT token
   */
  protected parseJWT(token: string): Record<string, unknown> | null {
    try {
      const parts = token.split('.')
      if (parts.length !== 3) return null
      
      const payload = Buffer.from(parts[1], 'base64').toString('utf-8')
      return JSON.parse(payload)
    } catch {
      return null
    }
  }

  /**
   * Check if it is a JWT token
   */
  protected isJWT(token: string): boolean {
    return token.startsWith('eyJ') && token.split('.').length === 3
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.closeCallbackServer()
    this.progressCallback = null
  }
}

export default BaseOAuthAdapter
