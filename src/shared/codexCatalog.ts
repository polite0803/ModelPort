/**
 * Codex catalog 的逐字段改写：只动 `context_window` 与 `input_modalities`。
 *
 * catalog 的其余内容（`comp_hash`、`base_instructions`、官方条目）由 Codex 生成，
 * 网关既不该重写也无法伪造 —— 所以这里是「就地改几个键」，不是重建目录。
 *
 * 为什么放在 `shared/`：shell 的客户端同步与 daemon 的自动写入都要用它。两份实现
 * 各写一遍，迟早会出现「点了同步的值」与「自动写的值」不一致。
 */

export interface CatalogChange {
  slug: string
  field: 'context_window' | 'input_modalities'
  /** 改之前的值描述；`null` 表示原本没有或值不合法。 */
  before: string | null
  after: string | null
}

export interface CatalogRewrite {
  content: string
  changes: CatalogChange[]
}

/** 一条路由对外的两项可广告事实；`undefined` = 这一格没有读数，不动。 */
export interface CatalogAdvertisement {
  contextWindow?: number | undefined
  /**
   * 这条路由**还能不能收图**：池内至少有一个候选没有被明确标成不支持时为 true；
   * `undefined` 表示不判断。判据与选路一致（附图请求会被过滤到能收图的候选），
   * 写成「每个候选都支持」会让一个明确不支持的模型把整条路由降成 text-only。
   */
  vision?: boolean | undefined
}

function visionList(advertised: boolean): string[] {
  return advertised ? ['text', 'image'] : ['text']
}

function sameList(current: unknown, target: string[]): boolean {
  if (!Array.isArray(current) || current.length !== target.length) return false
  return target.every((value, index) => current[index] === value)
}

/**
 * 按 `advertised`（路由名 → 对外读数）改写 catalog 里同名条目的两格。
 *
 * - 读数是数字/布尔 → 写入；
 * - 读数是 `undefined`（空池，没有可说的数）→ **保持原值不动**，不删除：空池是临时
 *   状态，删掉会让客户端在一次抖动里失去压缩点或以为突然不支持图片；
 * - catalog 里没有这个 slug（网关不服务的条目）→ 不动。
 *
 * 返回 `null` 表示一个字节都不需要改（调用方据此跳过写盘）。
 */
export function rewriteCatalog(
  raw: string,
  advertised: ReadonlyMap<string, CatalogAdvertisement>
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
  const changes: CatalogChange[] = []
  for (const entry of models) {
    if (entry === null || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const slug = record.slug
    if (typeof slug !== 'string' || !advertised.has(slug)) continue
    const target = advertised.get(slug)
    if (target === undefined) continue

    const window = target.contextWindow
    if (window !== undefined) {
      const current =
        typeof record.context_window === 'number' && record.context_window > 0
          ? record.context_window
          : null
      if (window !== current) {
        record.context_window = window
        changes.push({
          slug,
          field: 'context_window',
          before: current === null ? null : String(current),
          after: String(window),
        })
      }
    }

    const vision = target.vision
    if (vision !== undefined) {
      const list = visionList(vision)
      if (!sameList(record.input_modalities, list)) {
        const before = Array.isArray(record.input_modalities)
          ? record.input_modalities.join('+')
          : null
        record.input_modalities = list
        changes.push({
          slug,
          field: 'input_modalities',
          before,
          after: list.join('+'),
        })
      }
    }
  }
  if (changes.length === 0) return null
  return {
    content: JSON.stringify(parsed, null, 2) + (raw.endsWith('\n') ? '\n' : ''),
    changes,
  }
}