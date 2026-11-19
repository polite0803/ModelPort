/**
 * Codex catalog 的窗口改写：只动 `<slug>.context_window` 一个字段。
 *
 * catalog 的其余内容（`comp_hash`、`base_instructions`、官方条目）由 Codex 生成，
 * 网关既不该重写也无法伪造 —— 所以这里是「就地改一个键」，不是重建目录。
 *
 * 为什么放在 `shared/`：shell 的客户端同步与 daemon 的自动写入都要用它。两份实现
 * 各写一遍，迟早会出现「点了同步的值」与「自动写的值」不一致。
 */

export interface CatalogWindowChange {
  slug: string
  /** 改之前的数字；`null` 表示原本没有这个键或值不合法。 */
  before: number | null
  /** 改之后的数字；`null` 表示这一格被删掉（当前实现不会产生，保留给未来）。 */
  after: number | null
}

export interface CatalogRewrite {
  content: string
  changes: CatalogWindowChange[]
}

/**
 * 按 `advertised`（路由名 → 对外读数）改写 catalog 里同名条目的 `context_window`。
 *
 * - 读数是数字 → 写入；
 * - 读数是 `undefined`（该路由空池，没有可说的数）→ **保持原值不动**，不删除：
 *   空池是临时状态，删掉会让客户端在一次抖动里失去压缩点；
 * - catalog 里没有这个 slug（网关不服务的条目）→ 不动。
 *
 * 返回 `null` 表示一个字节都不需要改（调用方据此跳过写盘）。
 */
export function rewriteCatalogWindows(
  raw: string,
  advertised: ReadonlyMap<string, number | undefined>
): CatalogRewrite | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const doc = parsed as { models?: unknown }
  const models = doc?.models
  if (!Array.isArray(models)) return null
  const changes: CatalogWindowChange[] = []
  for (const entry of models) {
    if (entry === null || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const slug = record.slug
    if (typeof slug !== 'string' || !advertised.has(slug)) continue
    const target = advertised.get(slug)
    if (target === undefined) continue
    const current =
      typeof record.context_window === 'number' && record.context_window > 0
        ? record.context_window
        : null
    if (target === current) continue
    record.context_window = target
    changes.push({ slug, before: current, after: target })
  }
  if (changes.length === 0) return null
  return {
    content: JSON.stringify(parsed, null, 2) + (raw.endsWith('\n') ? '\n' : ''),
    changes,
  }
}