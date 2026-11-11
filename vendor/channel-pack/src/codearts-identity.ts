/**
 * 码道账号的**稳定身份**：华为云账号名 + account_id。
 *
 * ## 为什么必须从 refresh_token 里读
 *
 * 码道的登录凭据是**临时** STS 凭据（`access_key_id` + `security_token` + 一小时级
 * `expires_at`），每次登录都会换发一套 ⇒ 拿它做账号名或判重都把同一账号当成新的
 * （真实报障：重新登录后面板出现 `codearts-8900729b` 这类无法辨认的条目，用户
 * 分不清「重复登录」还是「另一个账号」）。旧的 ticket 登录流程偶尔回传
 * `user_name`，新式 IAM OAuth 流程（`oauth.ts`）**一个身份字段都不回传**，只有
 * refresh_token 的 JWT 载荷里带着 `user_profile`（base64url 编码的 JSON）：
 *
 * ```
 * { account_id: '01a1c71d…', account_name: 'hw086287662933786',
 *   principal_id: '01a1c71d…', principal_is_root_user: true,
 *   principal_urn: 'iam::01a1c71d…:user:hw086287662933786' }
 * ```
 *
 * token 轮换时 `user_profile` 不变（它描述的是登录主体，不是令牌本身），因此
 * 适合做展示名与判重键；同一账号换机器/换浏览器重新登录也仍然是同一个值。
 *
 * ## 为什么解析失败一律返回 undefined
 *
 * 凭据可能来自旧版 ticket 流程（没有 refresh_token）、可能被外部截断，也可能
 * JWT 结构将来变化。此时**放弃识别**，由调用方回退到既有昵称 —— 宁可显示
 * 账号 id，也不能把半截字符串当成名字，更不能拿空值去删账号。
 *
 * 这里**不校验签名**：数据只用于本地展示与判重，而写入凭据的能力本身就等价于
 * 控制该账号，验签不会增加任何安全性。
 */
import type { CodeArtsCredential } from './types.js'

/** 码道账号的稳定身份。 */
export interface CodeArtsIdentity {
  /** 华为云账号 ID（`account_id`），重新登录不变 —— 判重用。 */
  accountId: string
  /** 华为云账号名（`account_name`），如 `hw086287662933786` —— 展示用。 */
  accountName: string
}

/** 把 base64url 片段解成 JSON 对象；任何异常都返回 undefined。 */
function decodeJsonSegment(segment: unknown): Record<string, unknown> | undefined {
  if (typeof segment !== 'string' || segment.length === 0) return undefined
  for (const text of [(): string => Buffer.from(segment, 'base64url').toString('utf8'), (): string => segment]) {
    try {
      const parsed = JSON.parse(text()) as unknown
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // 换下一种解形态
    }
  }
  return undefined
}

/** 从 refresh_token（JWT）里读身份。 */
export function readCodeArtsIdentityFromRefreshToken(
  refreshToken: unknown,
): CodeArtsIdentity | undefined {
  if (typeof refreshToken !== 'string') return undefined
  const segments = refreshToken.split('.')
  if (segments.length !== 3) return undefined
  const payload = decodeJsonSegment(segments[1])
  if (payload === undefined) return undefined
  const profile = decodeJsonSegment(payload.user_profile)
  if (profile === undefined) return undefined
  const accountId = typeof profile.account_id === 'string' ? profile.account_id.trim() : ''
  const accountName = typeof profile.account_name === 'string' ? profile.account_name.trim() : ''
  if (accountId.length === 0 || accountName.length === 0) return undefined
  return { accountId, accountName }
}

/**
 * 读取一份码道凭据的身份。
 *
 * 优先用凭据里已固化的 `account_id` / `account_name`（登录与续期时写入），
 * 缺失时回退解码 `refresh_token` —— 这条回退让**升级前已登录**的账号无需重新
 * 登录就能显示账号名。
 */
export function codeartsIdentity(credential: unknown): CodeArtsIdentity | undefined {
  if (typeof credential !== 'object' || credential === null || Array.isArray(credential)) return undefined
  const record = credential as Partial<CodeArtsCredential>
  const accountId = typeof record.account_id === 'string' ? record.account_id.trim() : ''
  const accountName = typeof record.account_name === 'string' ? record.account_name.trim() : ''
  if (accountId.length > 0 && accountName.length > 0) return { accountId, accountName }
  return readCodeArtsIdentityFromRefreshToken(record.refresh_token)
}

/**
 * 展示名：账号名 → 旧 ticket 凭据的 `user_name` → 调用方给的默认值（通常是账号 id）。
 *
 * `user_name` 只出现在旧 ticket 凭据里（没有 refresh_token），新式 OAuth 流程
 * 不返回任何身份字段，所以两条来源都要留。
 */
export function codeartsDisplayName(credential: unknown, fallback: string): string {
  const identity = codeartsIdentity(credential)
  if (identity !== undefined) return identity.accountName
  const record = typeof credential === 'object' && credential !== null && !Array.isArray(credential)
    ? credential as Partial<CodeArtsCredential>
    : undefined
  const userName = typeof record?.user_name === 'string' ? record.user_name.trim() : ''
  return userName.length > 0 ? userName : fallback
}