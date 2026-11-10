import { randomUUID } from 'node:crypto'
import { Service, type Context } from '@deepseek-ai/cordis'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { AccountPool } from './account-pool.js'
import { COMATE } from './comate-product.js'
import {
  COMATE_FREE_MODEL,
  comateLoginUrl,
  fetchComateModels,
  isComateLicenseValid,
  parseComateCredential,
  serializeComateCredential,
  type ComateCredential,
  type ComateModelEntry,
} from './comate.js'

/** 单凭据兜底 ref（适配器契约要求；实际登录一律写账号池的 `COMATE_ACCOUNT_*`）。 */
export const COMATE_CREDENTIAL_REF = 'COMATE_ACCOUNT_DEFAULT'

export interface ComateLoginResult {
  /** 凭据 JSON（`ComateCredential`），由 RPC 侧解析后回写账号昵称。 */
  access: string
  ref: CredentialRef
  loginUrl: string
  /** License 不过期，故恒为 false。 */
  refreshable: false
}

export interface StartedComateLogin {
  loginUrl: string
  result: Promise<ComateLoginResult>
  close: () => void
}

/** 登录轮询参数（官方 CLI 是 2s 一次、180s 超时）。 */
const LOGIN_POLL_INTERVAL_MS = 2_000
const LOGIN_TIMEOUT_MS = 180_000
const LOGIN_TIMEOUT_POLLS = Math.floor(LOGIN_TIMEOUT_MS / LOGIN_POLL_INTERVAL_MS)

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/**
 * 文心快码账号服务：浏览器设备绑定登录 + License 校验 + 模型目录。
 *
 * 登录协议来自官方 `@comate/comatecli`：先生成 `clientId`，让用户在浏览器里
 * 确认；随后轮询 `/client/generate/token` 换 token，再用 token 调
 * `/client/key` 换 License。License 本身不过期，因此没有 refresh_token，
 * 也没有静默续期。
 */
export class ComateAuth extends Service {
  private fetchImpl: typeof fetch = fetch

  constructor(ctx: Context, options: { fetcher?: typeof fetch } = {}) {
    super(ctx, 'comateAuth')
    if (options.fetcher) this.fetchImpl = options.fetcher
  }

  /**
   * 两步式登录：立即返回登录地址，后台轮询。
   *
   * 与其它浏览器渠道一样，不能 await 整个流程 —— 调用方必须在用户点击的
   * 手势窗口内 `window.open(loginUrl)`，否则会被弹窗拦截。
   */
  async startLogin(options: { refName?: string } = {}): Promise<StartedComateLogin> {
    const refName = options.refName ?? COMATE_CREDENTIAL_REF
    const clientId = randomUUID()
    const loginUrl = comateLoginUrl(clientId)
    // 官方 CLI 在开始登录前会清一次该 clientId 的旧绑定；新 UUID 下通常是空操作，
    // 但保留它以对齐真实客户端的行为（失败不影响登录）。
    void this.fetchImpl(
      `${COMATE.apiOrigin}${COMATE.apiPrefix}/client/logout?clientId=${encodeURIComponent(clientId)}`,
      { headers: { 'Content-Type': 'application/json' } },
    ).catch(() => {})
    let closed = false

    const result = this.pollForLicense(clientId, loginUrl, refName, () => closed)
    // 结果可能早于调用方 await 而落定；先挂空处理器避免未处理拒绝。
    result.catch(() => {})

    return {
      loginUrl,
      result,
      close: () => { closed = true },
    }
  }

  private async pollForLicense(
    clientId: string,
    loginUrl: string,
    refName: string,
    isClosed: () => boolean,
  ): Promise<ComateLoginResult> {
    const tokenUrl = `${COMATE.apiOrigin}${COMATE.apiPrefix}/client/generate/token?clientId=${encodeURIComponent(clientId)}`
    const keyUrl = `${COMATE.apiOrigin}${COMATE.apiPrefix}/client/key?clientId=${encodeURIComponent(clientId)}`

    for (let poll = 0; poll < LOGIN_TIMEOUT_POLLS; poll += 1) {
      if (isClosed()) throw new Error('登录已取消')
      try {
        const tokenResponse = await this.fetchImpl(tokenUrl, { headers: { 'Content-Type': 'application/json' } })
        if (tokenResponse.ok) {
          const tokenBody = await tokenResponse.json() as { status?: string; data?: unknown; message?: string }
          if (tokenBody.status === 'OK' && typeof tokenBody.data === 'string' && tokenBody.data.length > 0) {
            const keyResponse = await this.fetchImpl(keyUrl, {
              headers: { 'Content-Type': 'application/json', token: tokenBody.data },
            })
            if (keyResponse.ok) {
              const keyBody = await keyResponse.json() as {
                status?: string
                data?: { key?: unknown; displayName?: unknown }
              }
              const license = keyBody.data?.key
              if (keyBody.status === 'OK' && typeof license === 'string' && license.length > 0) {
                if (!await isComateLicenseValid(license, this.fetchImpl)) {
                  throw new Error('Comate 登录成功但 License 校验未通过，请重新授权')
                }
                const credential: ComateCredential = {
                  license,
                  ...typeof keyBody.data?.displayName === 'string' && keyBody.data.displayName.length > 0
                    ? { displayName: keyBody.data.displayName }
                    : {},
                  authenticatedAt: Date.now(),
                }
                await this.ctx.credentials.set(credentialRef(refName), serializeComateCredential(credential))
                return {
                  access: serializeComateCredential(credential),
                  ref: credentialRef(refName),
                  loginUrl,
                  refreshable: false,
                }
              }
            }
          }
        }
      } catch (error) {
        // License 校验失败是终态，立即抛；网络抖动继续轮询。
        if (error instanceof Error && error.message.includes('License 校验未通过')) throw error
      }
      await sleep(LOGIN_POLL_INTERVAL_MS)
    }
    throw new Error('Comate 登录超时（180 秒内未在浏览器中确认）')
  }

  /**
   * 校验某个账号的 License。
   *
   * License 不会过期，也没有续期材料；这里只做一次有效性检查。账号池的
   * `refreshable` 恒为 false，调度器不会周期性调用本方法。
   */
  async refreshAccountCredential(refName: string, pool?: AccountPool, accountId?: string): Promise<void> {
    const credential = await this.readCredential(refName)
    if (credential === undefined) throw new Error('凭据未配置')
    if (!await isComateLicenseValid(credential.license, this.fetchImpl)) {
      throw new Error('Comate License 已失效，请重新登录')
    }
    if (pool !== undefined && accountId !== undefined) {
      await pool.updateAccount(accountId, { refreshable: false })
    }
  }

  /** 用账号池里第一个可解析的 License 拉模型目录。 */
  async refreshModels(pool: AccountPool): Promise<ComateModelEntry[]> {
    const credential = await this.firstUsableCredential(pool)
    if (credential === undefined) return [COMATE_FREE_MODEL]
    try {
      return await fetchComateModels(credential, this.fetchImpl)
    } catch (error) {
      this.ctx.logger?.warn?.(
        `[comate] 模型目录拉取失败：${error instanceof Error ? error.message : String(error)}`,
      )
      throw error
    }
  }

  private async readCredential(refName: string): Promise<ComateCredential | undefined> {
    const resolved = await this.ctx.credentials.resolve(credentialRef(refName))
    if (!resolved) return undefined
    return parseComateCredential(resolved.value)
  }

  private async firstUsableCredential(pool: AccountPool): Promise<ComateCredential | undefined> {
    for (const entry of pool.listAccountsByProvider(COMATE.id)) {
      const resolved = await this.ctx.credentials.resolve(credentialRef(entry.credentialRef))
      if (!resolved) continue
      const credential = parseComateCredential(resolved.value)
      if (credential?.license) return credential
    }
    return undefined
  }
}
