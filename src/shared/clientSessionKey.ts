/**
 * 客户端提供的「这一轮属于哪个会话」的稳定标识。
 *
 * ## 为什么需要它
 *
 * 路由的会话粘性原来只用内容指纹（`autoRouting.ts::conversationKey` = system 文本
 * 与**首条 user 消息**的哈希）。agent 客户端会自己压历史：Codex desktop 撞到上下文
 * 预算后把历史换成一份「交接摘要」，摘要**就是新的首条用户消息** —— 指纹变，粘性
 * 丢，这一轮就被打分重新派到别家去（2026-11-03 实测一轮会话内
 * raccoon → qodercn → loomy，换完那轮 `attempts=2`，每轮 13–41 秒）。
 * 摘要不该换模型，稳定标识才该说了算。
 *
 * ## 口径
 *
 * 只认**会话/线程粒度**的字段。入向协议（`/v1/responses`、`/v1/messages`）先在这里
 * 解析一次，再经 `X-ModelPort-Session-Id` / `-Source` 回环头交给 `/v1/chat/completions`，
 * 所以那条头的值优先——同一条链上只留这一份「谁是会话」的判断。回环之后按
 * `prompt_cache_key` → `user` → `metadata.user_id` → 请求头 `session_id` 取第一个非空。
 * 刻意不收 `installation_id` / `window-id` 这类**比会话更粗**的标识：那会把同一
 * 窗口里的两段不同对话钉到同一个候选上，比原来的问题更糟。
 *
 * 都不存在时返回 `undefined`，调用方回落到内容指纹 —— 与加这个模块之前的行为逐字一致。
 * 值本身绝不进日志，只进来源标签与哈希。回环头是外部可伪造的：来源标签只接受已知值，
 * 认不出的降级成 `session_id_header`，不把伪造值写成 body 字段的来源。
 */

export type ClientSessionSource = 'prompt_cache_key' | 'user' | 'metadata_user_id' | 'session_id_header'

export interface ClientSessionKey {
  value: string
  source: ClientSessionSource
}

type Headers = Record<string, string | string[] | undefined> | undefined

const LOOPBACK_SESSION_HEADER = 'x-modelport-session-id'
const LOOPBACK_SESSION_SOURCE_HEADER = 'x-modelport-session-source'

const SOURCES: readonly ClientSessionSource[] = ['prompt_cache_key', 'user', 'metadata_user_id', 'session_id_header']

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function headerOf(headers: Headers, name: string): string {
  if (!headers) return ''
  // Node 已把入向头名小写，这里只补下划线/连字符两种拼法：带下划线的头常被中间的
  // 代理丢掉，客户端实际发的是连字符形态。
  const raw = headers[name] ?? headers[name.replace(/_/g, '-')]
  const first = Array.isArray(raw) ? raw[0] : raw
  return typeof first === 'string' ? first.trim() : ''
}

export function clientSessionKey(input: { body?: unknown; headers?: Headers }): ClientSessionKey | undefined {
  // 入向协议（Responses / Anthropic）已经按下述优先级解析过一次，并经回环头把结果
  // 带给 `/v1/chat/completions`。先认它：一条链上只有一份「谁是会话」的判断，
  // 不然两处口径会漂。来源标签只接受已知值——头是外部可伪造的，认不出的标签
  // 降级成 `session_id_header`，不把伪造值写成 body 字段来源。
  const forwarded = headerOf(input.headers, LOOPBACK_SESSION_HEADER)
  if (forwarded !== '') {
    const label = headerOf(input.headers, LOOPBACK_SESSION_SOURCE_HEADER)
    const source = SOURCES.find(candidate => candidate === label)
    return { value: forwarded, source: source ?? 'session_id_header' }
  }

  const body = input.body && typeof input.body === 'object' && !Array.isArray(input.body)
    ? input.body as Record<string, unknown>
    : {}

  const cacheKey = textOf(body.prompt_cache_key)
  if (cacheKey !== '') return { value: cacheKey, source: 'prompt_cache_key' }

  const user = textOf(body.user)
  if (user !== '') return { value: user, source: 'user' }

  const metadata = body.metadata
  const metadataUser = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? textOf((metadata as Record<string, unknown>).user_id)
    : ''
  if (metadataUser !== '') return { value: metadataUser, source: 'metadata_user_id' }

  const header = headerOf(input.headers, 'session_id')
  if (header !== '') return { value: header, source: 'session_id_header' }

  return undefined
}
