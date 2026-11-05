/**
 * 账号渠道改名时，模型显示名与引用它的配置怎么跟着走。
 *
 * 渠道展示名不只是标签：模型对外名是 `<渠道名> / <上游展示名>`
 * （`accountChannels/manager.ts::applyChannel`），而路由的 `pinModels` /
 * `includeModels` / `excludeModels` 与模型停用标记都按这个**显示名**存的。
 * 只改渠道名而不迁移，会得到三种静默损坏：
 *
 * - 路由钉住的模型消失（`pinModels` 指向一个再也不会出现的名字）；
 * - 用户手工排除的模型悄悄回到候选池（`excludeModels` 失配）；
 * - 用户关掉的模型重新对外广告（停用标记失配）。
 *
 * 所以改名必须配一次显示名迁移；本模块只做纯字符串规划，写入留给调用方。
 */

/** Model display names are built as `${channelName} / ${upstreamName}`. */
export const CHANNEL_MODEL_SEPARATOR = ' / '

/**
 * Display names the account-channel catalogue used before 2026-11-05.
 *
 * Kept as data (not deleted after the migration) because the migration runs on
 * every sync and must stay idempotent: it looks for these prefixes in the
 * stored catalogue and route refs and rewrites whatever it finds. `from` must
 * never equal the channel's current `name`, or the pass would rewrite nothing
 * forever while looking correct.
 */
export const CHANNEL_DISPLAY_RENAMES: ReadonlyArray<{ id: string; from: string }> = [
  { id: 'buddy', from: 'CodeBuddy (腾讯)' },
  { id: 'workbuddy', from: 'WorkBuddy (腾讯)' },
]

/**
 * @returns the name under `to` when `name` sits under `from`, else `undefined`
 */
export function renamedDisplayName(name: string, from: string, to: string): string | undefined {
  if (from === to) return undefined
  const prefix = `${from}${CHANNEL_MODEL_SEPARATOR}`
  if (!name.startsWith(prefix)) return undefined
  return `${to}${CHANNEL_MODEL_SEPARATOR}${name.slice(prefix.length)}`
}

/**
 * Rewrite `displayName` inside a list of `{ providerId, displayName }` refs.
 *
 * Returns the original array when nothing matched, so callers can skip the
 * write instead of re-saving an identical route.
 */
export function renameDisplayNameRefs<T extends { displayName: string }>(
  refs: readonly T[] | undefined,
  from: string,
  to: string,
): T[] | undefined {
  if (refs === undefined || refs.length === 0) return undefined
  let changed = false
  const next = refs.map((ref) => {
    const renamed = renamedDisplayName(ref.displayName, from, to)
    if (renamed === undefined) return ref
    changed = true
    return { ...ref, displayName: renamed }
  })
  return changed ? next : undefined
}
