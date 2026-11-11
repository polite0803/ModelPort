/**
 * 「走系统代理」开关的写后广播。
 *
 * 渠道运行时是独立 Worker，读不到宿主的 store；而配置写入有多个入口（IPC
 * `config:update`、通用 `store:set('config')`、备份恢复、重置、管理 API）。
 * 把「写完之后通知」放在 store 的几条写路径上，比在每个入口手工补一次更不容易漏。
 *
 * 这个模块刻意不 import 任何东西：`store.ts` 会 import 它，而订阅方（渠道管理器）
 * 已经 import 了 `store.ts`，反向依赖会成环。
 */
type Sink = (map: Record<string, boolean>) => void

let sink: Sink | null = null

export function setChannelSystemProxySink(next: Sink | null): void {
  sink = next
}

/**
 * 落盘后把归一过的开关表推给订阅方。
 *
 * 通知失败只吞掉：开关的权威在 `data.json`，渠道运行时下次 spawn 会重新读一次，
 * 所以「少推一次」是可恢复的；而一次配置写入不能因为 Worker 正好在重启就失败。
 */
export function publishChannelSystemProxy(map: Record<string, boolean> | undefined): void {
  try {
    sink?.(map ?? {})
  } catch {
    // 见函数注释：异步推送是尽力而为，权威值在配置里。
  }
}