/**
 * buddy（腾讯 CodeBuddy / WorkBuddy）前缀缓存会话标识的派生（纯函数）。
 *
 * ## 为什么需要它（实测症状，2026-11-15）
 *
 * 旧实现把 `prompt_cache_key` 钉成构造时生成的一个随机 UUID，整个 worker
 * 生命周期里**所有账号、所有会话**共用同一个 key。两条并发会话（实测各约
 * 50 万 token 历史）于是挤在同一个缓存命名空间里互相驱逐：服务端按 key 分桶
 * 的 KV 缓存只保得住两条会话共有的那一块系统前缀（实测 128 token 地板），
 * 各自的历史前缀每轮都被对方挤掉，命中率被压到约 18%。
 *
 * 故改为**按会话身份确定性派生**：同一段对话（同一模型、同一账号、同一
 * system、同一首条 user 文本）恒得到同一个 key；不同会话拿到不同 key，
 * 各自的缓存前缀互不驱逐。维度照抄 `qoder-session.ts` / `gemini.ts`：
 * 吃 模型 / 账号 / system / **首条** user 文本，不吃轮数、后续文本、机器特征。
 * 首条而不是最后一条 —— 最后一条每轮都变，用它派生等于每轮换 key、缓存永不命中。
 *
 * ## 输出形态
 *
 * 32 位十六进制（sha256 前 32 字符），与旧实现 `randomUUID().replace(/-/g,'')`
 * 及 codearts 的 `prompt_cache_key` 同形。上游只把它当缓存命名空间字符串，
 * 不要求 UUID 形态；本函数保证的是「同输入同输出」这一语义，不是数值复刻。
 *
 * 本模块只依赖 node:crypto，因此可被 `node --test` 直接 import（与
 * `qoder-session.ts` / `usage-cache.ts` 同一套零依赖约定）。
 */
import { createHash } from 'node:crypto'

/** 派生输入。缺省字段用 null 参与哈希，不与空串混同（未下发与下发空串是两种语义）。 */
export interface BuddyCacheKeySeed {
  /** 模型 id。不同模型的缓存前缀不互通，必须是不同 key。 */
  model: string
  /** 账号标识（池账号 id）。不同账号的服务端缓存彼此独立。 */
  accountSeed?: string
  /** 系统提示（整段对话不变的那段）。 */
  systemText?: string
  /** **首条** user 文本（不是最后一条 —— 那是本轮提问，每轮都变）。 */
  firstUserText?: string
}

/** 域分隔标记，避免与其它派生函数的输入空间相撞。 */
const CACHE_KEY_DOMAIN = 'modelport-buddy-cache-v1'

/**
 * 按会话身份派生 `prompt_cache_key`（32 位十六进制，确定性）。
 *
 * 用 JSON 元组而不是分隔符拼接：每个位置都有确定类型（string | null），
 * 编码是单射的，`a|b` 与 `a`+`|b` 不会相撞。
 */
export function deriveBuddyCacheKey(seed: BuddyCacheKeySeed): string {
  const input = JSON.stringify([
    CACHE_KEY_DOMAIN,
    seed.model,
    seed.accountSeed ?? null,
    seed.systemText ?? null,
    seed.firstUserText ?? null,
  ])
  return createHash('sha256').update(input).digest('hex').slice(0, 32)
}