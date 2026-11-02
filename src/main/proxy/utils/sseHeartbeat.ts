/**
 * SSE 心跳。
 *
 * 客户端（Codex/Claude Code/各类 SDK）通常有自己的「响应头超时」与「空流超时」。
 * 上游的 prefill 或长思考可能几十秒没有任何 token；没有心跳时，客户端会先把
 * 连接判死，用户看到的是「网关又错了」，而上游其实还在正常生成。
 *
 * 心跳用 SSE 注释帧（`: PING`）：所有 SSE 客户端都按注释忽略，不改变任何
 * 协议事件，也不会被当成正文。
 */

export const DEFAULT_SSE_PING_INTERVAL_MS = 15_000

interface SseSink {
  write(chunk: string): boolean
  destroyed?: boolean
  writableEnded?: boolean
}

export interface SseHeartbeat {
  stop(): void
  /** Number of ping comments actually written; surfaced in the request log. */
  pingCount(): number
}

export function startSseHeartbeat(
  target: SseSink,
  intervalMs: number = DEFAULT_SSE_PING_INTERVAL_MS,
): SseHeartbeat {
  if (!(intervalMs > 0)) return { stop: () => {}, pingCount: () => 0 }

  let timer: NodeJS.Timeout | undefined
  let pings = 0
  const stop = (): void => {
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }

  timer = setInterval(() => {
    if (target.destroyed || target.writableEnded) {
      stop()
      return
    }
    try {
      target.write(': PING\n\n')
      pings += 1
    } catch {
      stop()
    }
  }, intervalMs)
  timer.unref?.()

  return { stop, pingCount: () => pings }
}
