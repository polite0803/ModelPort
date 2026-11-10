/**
 * `jose` 的最小替身：只实现 CodeArts OAuth DPoP 用到的 ES256 子集。
 *
 * 上游 `oauth.ts` 依赖 `jose` 的 `generateKeyPair` / `exportJWK` / `importJWK` /
 * `SignJWT`。本仓库不引入新依赖，这里用 Node 内置 Web Crypto 实现同样的语义：
 * - WebCrypto 的 ECDSA 签名输出是 IEEE P1363（r||s），与 JWS ES256 要求的格式一致；
 * - `exportJWK` 只保留 `kty/crv/x/y/d`，因为 `importKey('jwk', …)` 会拒绝
 *   `key_ops` / `ext` 与导入参数不一致的 JWK。
 *
 * ⚠️ 只覆盖当前上游的调用面；若升级上游后其使用面扩大，缺失会由 esbuild 的
 * 导入检查直接暴露，不会静默降级。
 */

const ES256 = { name: 'ECDSA', namedCurve: 'P-256' } as const

/** JWK 的最小形状（只承载 EC P-256 成员）。 */
export type JoseJwk = Record<string, unknown>

/** 生成 ES256（P-256）密钥对。 */
export async function generateKeyPair(
  alg: 'ES256',
  options: { extractable?: boolean; crv?: 'P-256' } = {},
): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }> {
  if (alg !== 'ES256' || (options.crv !== undefined && options.crv !== 'P-256')) {
    throw new Error(`jose-compat: unsupported algorithm ${alg}/${options.crv ?? ''}`)
  }
  const pair = (await crypto.subtle.generateKey(
    ES256,
    options.extractable ?? true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  return { privateKey: pair.privateKey, publicKey: pair.publicKey }
}

/** 导出公钥/私钥 JWK；私钥只有存在 `d` 时才带上。 */
export async function exportJWK(key: CryptoKey): Promise<JoseJwk> {
  const jwk = await crypto.subtle.exportKey('jwk', key)
  const out: JoseJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }
  if (jwk.d !== undefined) out.d = jwk.d
  return out
}

/** 从 JWK 导入用于签名的私钥。 */
export async function importJWK(
  jwk: JoseJwk,
  alg: 'ES256',
  options: { extractable?: boolean } = {},
): Promise<CryptoKey> {
  if (alg !== 'ES256') throw new Error(`jose-compat: unsupported algorithm ${alg}`)
  return crypto.subtle.importKey(
    'jwk',
    jwk as JsonWebKey,
    ES256,
    options.extractable ?? false,
    ['sign'],
  )
}

/** JWS 的 base64url 编码（无填充）。 */
function encodeSegment(value: string | Uint8Array): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  return Buffer.from(bytes).toString('base64url')
}

/** 只覆盖上游用到的链式调用：`setProtectedHeader(…).sign(key)`。 */
export class SignJWT {
  private header: Record<string, unknown> = { alg: 'ES256' }

  constructor(private readonly payload: Record<string, unknown>) {}

  setProtectedHeader(header: Record<string, unknown>): this {
    this.header = header
    return this
  }

  async sign(key: CryptoKey): Promise<string> {
    const signingInput = `${encodeSegment(JSON.stringify(this.header))}.${encodeSegment(JSON.stringify(this.payload))}`
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      new TextEncoder().encode(signingInput),
    )
    return `${signingInput}.${encodeSegment(new Uint8Array(signature))}`
  }
}
