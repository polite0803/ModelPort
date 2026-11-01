/**
 * 等待计划的运行时镜像（**无依赖**，除一个纯函数模块）。
 *
 * 存在的理由与 `providers/accountChannels/runtimeState.ts` 完全相同：
 * `channelPack/bridge.ts` 要知道「一笔渠道请求最多等多久」，但它不能去 import
 * `store/store`（→ electron-store → electron），否则 `node --test` 直接拉不动。
 * 于是写入方（代理启动与配置保存两处）把 `config.requestTimeout` 折算好放进来，
 * 读取方（bridge / forwarder）只读这一个对象，双方都不需要认识对方。
 *
 * 出厂值就是 `planRequestDeadlines(undefined)`，即默认 60s —— 所以「启动时序里漏了
 * 一次写入」最多让等待退回默认值，不会退回「永不超时」。
 */
import { planRequestDeadlines, type RequestDeadlinePlan } from './retryPolicy'

let current: RequestDeadlinePlan = planRequestDeadlines(undefined)

/** 由 `config.requestTimeout` 重算并装入镜像；返回新值供调用方记日志。 */
export function configureRequestDeadlines(requestTimeoutMs: number | undefined): RequestDeadlinePlan {
  current = planRequestDeadlines(requestTimeoutMs)
  return current
}

/** 当前生效的等待计划。 */
export function requestDeadlines(): RequestDeadlinePlan {
  return current
}
