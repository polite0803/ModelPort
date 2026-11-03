/**
 * 聚合目录的账号级额度读数**解析层**。
 *
 * 这个文件里没有任何 I/O：它不发请求、不读配置存储、也不碰磁盘。
 * 发请求那一步在 `manager.ts`（它复用既有的 `buildProbeHeaders` 鉴权通路），
 * 这里只负责「报文进、读数出」和「几把 Key 的读数折成条目级的一行」。
 *
 * 为什么解析要单独成一层并且把「解析不出来」当一等状态：
 * 下面两个 reader 期望的字段名来自转录记录（`docs/plan/PLAN-port-freellmapi-free-token.md` §1
 * 第 3 行），本轮没有真机报文核对。字段对不上时返回 `unexpected-shape` 并带上报文摘要，
 * 让界面把这个未知显示成未知 —— 不许挑一个"看起来像"的字段填上去，那会把一个没验证过的
 * 猜测变成路由决策。`limit: null` 同样不许读成 0：OpenRouter 用它表示"这把 Key 没有花费上限"。
 */

import type { AggregateQuotaProbe } from '../../../shared/aggregate.ts'
import type {
  AggregateCreditKeyRow,
  AggregateCreditReading,
  AggregateCreditSnapshot,
  AggregateCreditUnit,
} from '../../../shared/aggregateCredit.ts'

/** 报文摘要的硬上限：够看清形状，不够塞进日志一整页。 */
const RAW_SUMMARY_LIMIT = 240

/** 数值容忍：有限数字，或整体就是一个十进制数的字符串（上游偶尔把余额写成 `"0.00"`）。 */
function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return undefined
    const parsed = Number(text)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 报文摘要：截断到 `RAW_SUMMARY_LIMIT`，并把传入的密钥字面量替换成掩码。
 * 摘要是要进界面、进日志的，所以"不含 Key"在这里做，不指望调用方记得脱敏。
 */
export function summarizePayload(payload: unknown, secrets: readonly string[] = []): string {
  let text: string
  try {
    text = typeof payload === 'string' ? payload : JSON.stringify(payload) ?? String(payload)
  } catch {
    text = String(payload)
  }
  for (const secret of secrets) {
    if (secret && secret.length >= 4) text = text.split(secret).join('••••')
  }
  return text.length > RAW_SUMMARY_LIMIT ? `${text.slice(0, RAW_SUMMARY_LIMIT)}…` : text
}

/**
 * OpenRouter `GET /api/v1/key`：`data.limit` / `data.limit_remaining`，单位美元。
 *
 * `limit === null` → `unlimited: true`，并且**不再给 remaining**：无上限不是一个余额，
 * 把它读成 0 会让这家排到最后，读成"很大"又等于替上游发明了一个数。
 */
export function readOpenRouterKey(
  payload: unknown,
  secrets: readonly string[] = []
): AggregateCreditReading {
  const raw = () => summarizePayload(payload, secrets)
  if (!isRecord(payload)) {
    return { ok: false, reason: 'unexpected-shape', detail: `no object at the top level · ${raw()}` }
  }
  const data = payload.data
  if (!isRecord(data)) {
    return { ok: false, reason: 'unexpected-shape', detail: `no "data" object · ${raw()}` }
  }

  const hasLimit = 'limit' in data
  const hasRemaining = 'limit_remaining' in data
  if (!hasLimit && !hasRemaining) {
    return { ok: false, reason: 'unexpected-shape', detail: `neither "limit" nor "limit_remaining" · ${raw()}` }
  }

  const limitRaw = data.limit
  let unlimited = false
  let limit: number | undefined
  if (limitRaw === null || limitRaw === undefined) {
    // 只有明确写了 null（或缺席）才叫"没有上限"；字符串 "unlimited" 之类一律算形状不认识。
    unlimited = limitRaw === null
    limit = undefined
  } else {
    const parsed = asFiniteNumber(limitRaw)
    if (parsed === undefined) {
      return { ok: false, reason: 'unexpected-shape', detail: `"limit" is not a number · ${raw()}` }
    }
    limit = parsed
  }

  let remaining: number | undefined
  if (hasRemaining) {
    if (unlimited) {
      // 无上限时 remaining 的语义是"已花"而不是"还剩"，不参与排序，也不显示成余额。
      remaining = undefined
    } else {
      const parsed = asFiniteNumber(data.limit_remaining)
      if (parsed === undefined) {
        return { ok: false, reason: 'unexpected-shape', detail: `"limit_remaining" is not a number · ${raw()}` }
      }
      remaining = parsed
    }
  }

  return {
    ok: true,
    unit: 'USD',
    unlimited,
    ...(remaining === undefined ? {} : { remaining }),
    ...(limit === undefined ? {} : { limit }),
    raw: raw(),
  }
}

/**
 * SiliconFlow `GET /v1/user/info`：余额，单位人民币。
 *
 * 转录记录只留下了「余额（CNY 计）」和端点路径，**没留下 JSON 路径**，所以这里只认
 * `balance` 这一个字段名，容忍两种信封（`{ data: { balance } }` 与顶层 `{ balance }`）——
 * 那是同一字段的嵌套差异，不是"猜一个近似字段"。`total_balance` / `recharge_amount` /
 * `gift_amount` 这些相邻名字一律不读：它们是不是同一条余额没有任何证据。
 * 真机第一次点这个按钮时要核对的就是这个名字。
 *
 * 2026-11-03：上游已把 `/user/info` 下线（HTTP 410），registry 不再声明该端点，
 * 所以本 reader 当前没有调用方。函数留着：官方替代端点上线时字段名要重新取证，
 * 那时整个 reader 都得重写，现在删掉只是制造无意义的 diff。
 */
export function readSiliconFlowUserInfo(
  payload: unknown,
  secrets: readonly string[] = []
): AggregateCreditReading {
  const raw = () => summarizePayload(payload, secrets)
  if (!isRecord(payload)) {
    return { ok: false, reason: 'unexpected-shape', detail: `no object at the top level · ${raw()}` }
  }

  const envelope = isRecord(payload.data) ? payload.data : payload
  if (!('balance' in envelope) && !('balance' in payload)) {
    return { ok: false, reason: 'unexpected-shape', detail: `no "balance" field · ${raw()}` }
  }

  const source = 'balance' in envelope ? envelope : payload
  const parsed = asFiniteNumber(source.balance)
  if (parsed === undefined) {
    return { ok: false, reason: 'unexpected-shape', detail: `"balance" is not a number · ${raw()}` }
  }

  return { ok: true, unit: 'CNY', unlimited: false, remaining: parsed, raw: raw() }
}

/** 这个 reader 的计数域：美元还是人民币。折算成同一个数是被明确禁止的。 */
export function creditUnitOfReader(reader: AggregateQuotaProbe['reader']): AggregateCreditUnit {
  return reader === 'openrouter-key' ? 'USD' : 'CNY'
}

/**
 * 抓取层唯一的入口：先把可能是字符串的报文转成 JSON，再按目录声明的 reader 分派。
 * `not-json` 与 `unexpected-shape` 分开：前者是"上游这次没按 JSON 答"（可能是 HTML 错误页），
 * 后者是"按 JSON 答了但字段不是我们记下的那几个"。界面给出的补救动作不同。
 */
export function parseQuotaProbe(
  reader: AggregateQuotaProbe['reader'],
  payload: unknown,
  secrets: readonly string[] = []
): AggregateCreditReading {
  let value = payload
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return {
        ok: false,
        reason: 'not-json',
        detail: `body is not JSON · ${summarizePayload(payload, secrets)}`,
      }
    }
  }
  return reader === 'openrouter-key' ? readOpenRouterKey(value, secrets) : readSiliconFlowUserInfo(value, secrets)
}

/**
 * 几把 Key 的读数折成条目级的一行。
 *
 * 只有「尝试过的每一把都问出了可比较的余额，而且没有一把被跳过」才 `ok: true`。
 * 理由是条目级的 `remaining <= 0` 会被 `quotaBlockReason` 拿去停用这家**所有**账号，
 * 所以它必须建立在"全部问过了"的证据上：
 * - 某一把没答出来（网络、非 JSON、形状不认识）→ 证据不齐，这一行不成立；
 * - 某一把只回了帽没回余额 → 同样不成立；
 * - 超过单次上限、有 Key 根本没问 → 也不成立。这与 `undocumented` 不参与预检是同一条
 *   纪律：把"不知道"当成"没有额度"，会让一家还有余额的 Key 被一次没问过的读数挡死。
 *
 * 成立时 `remaining` / `limit` 取余额最高的那把，于是 `remaining <= 0` 恰好等价于
 * "每一把都是 0"；只要有一把报了无上限，整行就是 `unlimited`，闸门随之不生效。
 */
export function buildCreditSnapshot(input: {
  asOf: string
  unit: AggregateCreditUnit
  rows: AggregateCreditKeyRow[]
  accounts: number
  skipped: number
}): AggregateCreditSnapshot {
  const { asOf, unit, rows, accounts, skipped } = input

  const firstFailure = rows.find(row => !row.reading.ok)
  if (rows.length === 0 || firstFailure || skipped > 0) {
    return {
      asOf,
      unit,
      unlimited: false,
      ok: false,
      ...(firstFailure && !firstFailure.reading.ok ? { reason: firstFailure.reading.reason } : {}),
      accounts,
      skipped,
    }
  }

  if (rows.some(row => row.reading.ok && row.reading.unlimited)) {
    return { asOf, unit, unlimited: true, ok: true, accounts, skipped }
  }

  const remainings = rows.map(row => (row.reading.ok ? row.reading.remaining : undefined))
  if (remainings.some(remaining => typeof remaining !== 'number')) {
    // 上游答了，但没答出一个能比较的余额：不是"没钱"，是"没问出来"。
    return { asOf, unit, unlimited: false, ok: false, reason: 'unexpected-shape', accounts, skipped }
  }

  let best = 0
  for (const [index, remaining] of remainings.entries()) {
    if ((remaining ?? Number.NEGATIVE_INFINITY) > (remainings[best] ?? Number.NEGATIVE_INFINITY)) best = index
  }
  const representative = rows[best].reading
  const limit = representative.ok ? representative.limit : undefined

  return {
    asOf,
    unit,
    unlimited: false,
    remaining: remainings[best],
    ...(limit === undefined ? {} : { limit }),
    ok: true,
    accounts,
    skipped,
  }
}
