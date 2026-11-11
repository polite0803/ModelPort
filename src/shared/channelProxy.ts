/**
 * 按渠道的「走系统代理」开关（`AppConfig.channelSystemProxy`）。
 *
 * 语义是**布尔开关**，不是代理地址：打开 = 该渠道沿用应用已经探到的系统代理链
 * （环境代理 → 宿主机代理文件 → Windows 系统代理，见渠道包 `channel-fetch.ts`）；
 * 关闭 = 该渠道跳过这几层直连。
 *
 * **缺省条目按「走系统代理」读**（`!== false`）。这不是随手定的默认值：升级前
 * 所有渠道本来就走那条自动出口，若把缺省读成「直连」，一次升级就会静默改掉
 * 正在工作的出网路径 —— 用户看到的只是一堆渠道突然连不上。所以开关只记录
 * 用户**显式关掉**的渠道，界面把缺省渲染成「开」。
 *
 * 写入侧（`config:update`、管理 API）必须把坏值连同原因拒掉；读取侧只做丢弃
 * （`data.json` 手坏不该把整份配置读挂）。两种口径分开，避免「保存成功、那一格
 * 却没生效」——本仓库反复出过的缺陷形态。
 */

/** 渠道数上限：在册 15 家，留足余量即可。 */
const MAX_ENTRIES = 64

/** 键名必须像渠道 id（与 `catalogue.ts` 的 id 同一字符集）。 */
const CHANNEL_ID = /^[a-z0-9][a-z0-9-]{0,40}$/

/** 某渠道是否走系统代理；缺省 = 走。 */
export function channelUsesSystemProxy(
  map: Record<string, boolean> | undefined,
  channel: string,
): boolean {
  return map?.[channel] !== false
}

/**
 * 读取侧归一：只留下键名合法、值为布尔（含 `"true"`/`"false"` 字符串）的条目。
 *
 * 永远返回新对象；不合法的条目静默丢弃，让界面回到缺省（走系统代理），
 * 而不是因为一格手坏把整份配置读挂。
 */
export function sanitizeChannelSystemProxyMap(value: unknown): Record<string, boolean> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const map: Record<string, boolean> = {}
  let count = 0
  for (const [channel, raw] of Object.entries(value as Record<string, unknown>)) {
    if (count >= MAX_ENTRIES) break
    if (!CHANNEL_ID.test(channel)) continue
    const flag = typeof raw === 'boolean' ? raw : raw === 'true' ? true : raw === 'false' ? false : undefined
    if (flag === undefined) continue
    map[channel] = flag
    count += 1
  }
  return map
}

export type ChannelSystemProxyWriteCheck =
  | { ok: true; map: Record<string, boolean> }
  | { ok: false; errors: string[] }

/**
 * 写入侧校验：整批拒绝，不静默丢弃。
 *
 * 「保存成功但那一格没生效」正是本仓库反复出过的缺陷形态，所以只允许两种结果：
 * 全部写入，或把每一条的原因原样返回给调用方。
 */
export function validateChannelSystemProxyWrite(value: unknown): ChannelSystemProxyWriteCheck {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['channelSystemProxy 必须是「渠道 id → 布尔」的对象'] }
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MAX_ENTRIES) {
    return { ok: false, errors: [`channelSystemProxy 条目过多（上限 ${MAX_ENTRIES}）`] }
  }
  const errors: string[] = []
  const map: Record<string, boolean> = {}
  for (const [channel, raw] of entries) {
    if (!CHANNEL_ID.test(channel)) {
      errors.push(`channelSystemProxy 的键「${channel}」不是合法的渠道 id`)
      continue
    }
    if (typeof raw !== 'boolean') {
      errors.push(`channelSystemProxy.${channel} 必须是 true 或 false`)
      continue
    }
    map[channel] = raw
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, map }
}