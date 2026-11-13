/**
 * 粘贴 key 的入库前检查（纯函数，可被 node --test 直接 import）。
 *
 * ⚠️ 这里只挡「明显没粘贴对」，**不猜 key 的形状**。2026-11-13：用户从
 * opencode.ai/auth 复制的真 key 被上一版 `^sk-[A-Za-z0-9_-]{20,}$` 拒掉，
 * 而 `sk-` 前缀只是我们自己的假设 —— 官方文档（docs/zen）从未声明过 key
 * 的格式，key 是否可用只有上游的 200/401 说了算。
 *
 * 真实格式（用户实测）：`oc_sk_` 前缀。**仍然不据此收紧校验** —— 这正是
 * 旧 `sk-` 假设翻车的同一种错：前缀会变，而上游的 401 永远是权威。
 *
 * 保留的判据都不依赖形状假设：
 * - 空串 / 只有空白；
 * - 太短（< 8）—— 明显的半截粘贴；
 * - 含空白或非 ASCII —— 复制时带进换行、全角字符、零宽字符的典型症状；
 * - 超长（> 512）—— 多半把整段配置粘了进来。
 *
 * 复制自网页的零宽字符（U+200B–U+200D、U+FEFF）在判空之前先剥掉：
 * 它们不可见，也绝不可能是 key 的一部分（`String.prototype.trim` 不处理
 * ZWSP，这正是「看着没问题却过不了形状校验」的常见成因）。
 */
export const API_KEY_MAX_LENGTH = 512

export function normalizeOpencodeApiKey(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/[\u200B-\u200D\uFEFF]/g, '').trim() : ''
}

/** 返回给用户看的拒绝原因；`undefined` 表示可以入库。 */
export function opencodeApiKeyShapeError(key: string): string | undefined {
  if (key.length === 0) return '请先填入 API key，或者改点「加一条匿名槽」'
  if (key.length < 8) return 'API key 太短，像是没粘完整：请在 opencode.ai/auth 复制整行'
  if (key.length > API_KEY_MAX_LENGTH) {
    return `API key 过长（${key.length} 字符）：确认没有把整段配置粘进来`
  }
  if (/\s/.test(key)) return 'API key 中间有空格或换行：请确认复制的是完整的一行'
  if (!/^[\x21-\x7E]+$/.test(key)) {
    return 'API key 含有非 ASCII 字符（多半是复制时带进了全角或隐藏字符）'
  }
  return undefined
}

/** `account.refresh` 的纯判据结果：要不要写、写成什么。 */
export interface OpencodeCredentialRefreshPlan {
  /** true = 匿名槽（凭据是字面量 `public`），没有可刷新/可校验的东西。 */
  anonymous: boolean
  /** 需要回写的凭据 JSON；`undefined` = 存储值已规范，不必写。 */
  writeValue?: string
}

/**
 * OpenCode 账号刷新凭据的**判据部分**（纯函数，见 `refreshAccountCredential` 的接线）。
 *
 * 静态 API key 没有续期端点：能做的只有「重读该账号自己的凭据」这一步，
 * 所以这里只负责解析、校验、规范化，网络与存储交给调用方。
 *
 * ⚠ 本模块**不 import 任何 vendor 内部模块**（`opencode-product.ts` 用了 `.js`
 * 后缀的相对导入，node 的 TS 直跑解析不到）—— 匿名槽字面量因此由调用方传入，
 * 单一口径仍是 `OPENCODE.anonymousKey`。
 *
 * @param raw          该账号 `credentialRef` 里的原始 JSON 字符串。
 * @param refName      只用于错误文案，让用户知道是哪条账号。
 * @param anonymousKey 匿名槽的凭据字面量（`OPENCODE.anonymousKey`）。
 */
export function planOpencodeCredentialRefresh(
  raw: string,
  refName: string,
  anonymousKey: string,
): OpencodeCredentialRefreshPlan {
  let parsed: { api_key?: unknown }
  try {
    parsed = JSON.parse(raw) as { api_key?: unknown }
  } catch {
    throw new Error(`OpenCode 账号（${refName}）的凭据已损坏，请删除该账号后重新粘贴 API key`)
  }
  const apiKey = normalizeOpencodeApiKey(parsed?.api_key)
  if (apiKey === anonymousKey) return { anonymous: true }
  if (apiKey.length === 0) {
    throw new Error(`OpenCode 账号（${refName}）的凭据里没有 API key，请删除该账号后重新粘贴`)
  }
  const shapeError = opencodeApiKeyShapeError(apiKey)
  if (shapeError !== undefined) throw new Error(shapeError)
  if (apiKey === parsed.api_key) return { anonymous: false }
  return { anonymous: false, writeValue: JSON.stringify({ ...parsed, api_key: apiKey }) }
}