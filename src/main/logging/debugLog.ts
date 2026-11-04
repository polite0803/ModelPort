/**
 * 主进程调试输出闸门
 *
 * 打包后的 Electron 主进程没有终端，`console.log` 只会落进平台的 stdout 捕获
 * （Windows 上任何能读进程输出的程序都能看到），而这里打的往往是账号名、
 * 映射到的模型名一类运行期情报。所以默认**静默**，只有显式开启时才输出。
 *
 * 为什么是 `NODE_ENV === 'development'` 而不是 `NODE_ENV !== 'production'`：
 * 打包产物里 `NODE_ENV` 根本没被设置（undefined），反向判断会让「生产环境」
 * 恰好落在开启分支上 —— 那是这条规则最容易写错的方向。
 */
const enabled =
  process.env.MODELPORT_DEBUG === '1' || process.env.NODE_ENV === 'development'

/** 当前是否处于调试输出状态（供需要提前跳过昂贵拼装的调用点使用）。 */
export function isDebugLogEnabled(): boolean {
  return enabled
}

/**
 * 受控调试输出。参数与 `console.log` 相同，但仅在开发态或 `MODELPORT_DEBUG=1`
 * 时真正写 stdout。
 */
export function debugLog(...args: unknown[]): void {
  if (!enabled) return
  // eslint-disable-next-line no-console
  console.log(...args)
}