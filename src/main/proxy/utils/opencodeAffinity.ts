import { createHash } from 'node:crypto'

/**
 * OpenCode 上游要求的**会话亲和头**。
 *
 * ## 为什么需要（2026-11-11 16:51 实测）
 *
 * `codex` 线路按分数首选 `opencode_go/kimi-k3.1-pro`，上游直接 400
 * `Request is missing x-opencode-session and cannot be routed efficiently`。
 * 聚合这一路（`forwarder.ts::buildHeaders`）此前从不发任何会话头，所以这个账号
 * **每一次**都被闸在门外。
 *
 * ## 取值口径（同日晚间受控探测，见下）
 *
 * 用仓库存着的这把 key 对 `https://opencode.ai/zen/go/v1/chat/completions`
 * 逐档发请求，只读状态码：
 *
 * | 发什么 | 上游答 |
 * |-|-|
 * | 什么都不发 | 400 `MissingSessionID` |
 * | 单个 `x-opencode-session`，值是普通随机 id | 403 `An active OpenCode Go subscription is required…` |
 * | 四个同值头（`x-opencode-session` / `x-opencode-session-id` / `x-session-affinity` / `x-session-id`） | 同上 403 |
 * | 四个同值头 + `x-opencode-project` + `x-opencode-client: cli` | 同上 403 |
 * | 四个同值头（值改成渠道包那套 CLI 铸造形状 `ses_+12hex+14base62`）+ project + client | 同上 403 |
 *
 * 两条结论：**值的形状随便**（不需要复刻官方 CLI 的 id 铸造算法），**project 与
 * client 头也不是过闸所需**。所以这里只补上游点名要的那四个同值头，
 * 不多发 `x-opencode-project` / `x-opencode-client` / `user-agent` —— 那三样是
 * 「这台机器是 OpenCode 客户端」的身份声明，闸已经不需要它，发它就是无必要地
 * 冒充别的软件。同理也**不发 `x-opencode-request`**（v1 专用，v2 收到即 403）。
 *
 * ## 为什么必须稳定，不能每次随机
 *
 * 这句报错说的是「routed efficiently」：上游拿它把同一会话钉在同一后端。每次现造
 * 等于把同一会话看成 N 个会话，亲和性反向失效（渠道包 `deriveSessionId` 的注释里
 * 写过同一件事）。所以取值优先用**客户端自己的会话标识**（`prompt_cache_key` /
 * `user` / `metadata.user_id`，与 `clientSessionKey` 同一口径），拿不到才回落到
 * 账号级稳定值。两者都是哈希派生、可重复计算，本模块**不持有任何跨请求状态**。
 *
 * ## 这个修复不能让它可用
 *
 * 探测里 403 那句是账号事实：这把 key 没有 OpenCode Go 订阅。补头只是把
 * 「我们漏发了头」这个假信号换成「这个账号没资格」这个真信号 —— 报错变准，
 * 订阅资格不因此产生。
 */

/** 上游点名要的四个同值头。 */
const AFFINITY_HEADERS = [
  'x-opencode-session',
  'x-opencode-session-id',
  'x-session-affinity',
  'x-session-id',
] as const

const AFFINITY_PREFIX_LENGTH = 12

/**
 * 这个 provider 的上游是不是 OpenCode。
 *
 * 按**解析后的主机名**判，不按 provider id 判：id 是我们起的，主机名才是上游。
 * 只认 `opencode.ai` 及其子域，别的域一个头都不加。
 */
export function isOpencodeUpstream(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return host === 'opencode.ai' || host.endsWith('.opencode.ai')
  } catch {
    return false
  }
}

/** 客户端自己声明的会话标识（与 `clientSessionKey` 的 body 侧优先级一致）。 */
function clientConversationValue(request: unknown): string {
  if (request === null || typeof request !== 'object') return ''
  const body = request as Record<string, unknown>
  for (const field of ['prompt_cache_key', 'user']) {
    const value = body[field]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  const metadata = body.metadata
  if (metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const userId = (metadata as Record<string, unknown>).user_id
    if (typeof userId === 'string' && userId.trim() !== '') return userId.trim()
  }
  return ''
}

function hash128(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * 该会话/账号的亲和值：`mp-` + 24 位小写 hex。
 *
 * 纯派生、可重复：同一会话在同一账号上永远得到同一个值，跨重启也一致，
 * 所以不需要缓存表（也就没有「跨请求状态无界」那一类泄漏）。
 */
export function opencodeAffinityValue(input: {
  request?: unknown
  accountId?: string
}): string {
  const conversation = clientConversationValue(input.request)
  const seed = conversation !== ''
    ? `conversation:${conversation}`
    : `account:${input.accountId ?? ''}`
  return `mp-${hash128(seed).slice(0, AFFINITY_PREFIX_LENGTH * 2)}`
}

/**
 * 要发往 OpenCode 上游的会话亲和头；非 OpenCode 上游返回 `undefined`。
 */
export function opencodeAffinityHeaders(input: {
  baseUrl?: string
  request?: unknown
  accountId?: string
}): Record<string, string> | undefined {
  if (!isOpencodeUpstream(input.baseUrl)) return undefined
  const value = opencodeAffinityValue(input)
  const headers: Record<string, string> = {}
  for (const name of AFFINITY_HEADERS) headers[name] = value
  return headers
}
