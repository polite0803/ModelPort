/**
 * 聚合线路的思考回灌。
 *
 * DeepSeek 官方端点要求「带 `tool_calls` 的 assistant 历史必须回传当轮
 * `reasoning_content`」，而客户端不回传（实测 92%），于是整段对话在下一轮 400：
 * `The reasoning_content in the thinking mode must be passed back to the API.`
 *
 * 渠道包在 `channelPack/worker.ts` 里已有同一机制，但它只覆盖 `type: 'account'`
 * 的渠道；客户端直连聚合 `deepseek`（api.deepseek.com）走的是 `forwarder.ts` 的
 * 通用 openai-chat 分支，从来没有接过这一步。本模块补上这条通路：
 *
 * - 观测点放在 chat 路由（`routes/chat.ts`），因为那里能同时看到「上游原始 SSE」
 *   与「网关实际下发给客户端的帧」，且不需要给转发器再包一层流；
 * - 回灌点放在转发器（`forwarder.ts`），在请求体组装前的那一刻改入站历史。
 *
 * 缓存本体在 `channelPack/reasoningReplay.ts`（同一个类、同一套判据）。
 */
import { StringDecoder } from 'node:string_decoder'
import { ReasoningReplayCache, reasoningReplayEnabled } from '../channelPack/reasoningReplay.ts'
import type { ChatCompletionRequest } from './types'
import type { Provider } from '../store/types'

/** 进程内共享：同一个进程的观测与回灌必须落在同一份缓存上。 */
const replayCache = new ReasoningReplayCache()

/**
 * 只有 DeepSeek 官方端点会被回填。
 *
 * 为什么按端点而不是按模型：需要回传思考是**远端**的校验，同一模型在别家
 * （百炼、渠道包）未必认这个字段；反过来，端点对了就不必维护一张模型清单。
 * 账号渠道由渠道包的 `worker.ts` 自己观测，这里排除掉，避免双重观测。
 */
export function isDeepSeekEndpoint(endpoint: string | undefined): boolean {
  if (!endpoint) return false
  try {
    return new URL(endpoint).hostname.toLowerCase() === 'api.deepseek.com'
  } catch {
    return false
  }
}

/** 这条线路要不要做思考回灌（开关 + 端点 + 非账号渠道）。 */
export function reasoningEchoApplies(
  provider: Pick<Provider, 'apiEndpoint' | 'type'>,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (provider.type === 'account') return false
  if (!reasoningReplayEnabled(env)) return false
  return isDeepSeekEndpoint(provider.apiEndpoint)
}

/**
 * 补回客户端丢掉的本轮思考；返回**新的** request（不改入参）。
 *
 * `injected` 是补回的轮数，调用方据此决定要不要记一行日志。
 */
export function injectReasoningEcho(
  request: ChatCompletionRequest,
): { request: ChatCompletionRequest; injected: number } {
  const recovered = replayCache.recover(request.messages)
  if (recovered.injected === 0) return { request, injected: 0 }
  return {
    request: { ...request, messages: recovered.messages as ChatCompletionRequest['messages'] },
    injected: recovered.injected,
  }
}

export interface ReasoningEchoObserver {
  push(chunk: Buffer | string): void
  finish(): void
}

/**
 * 一条流一个观测器。
 *
 * 按**行**切帧而不是按块：一个块里可能是半帧，也可能有好几帧。`reasoning_content`
 * 是 UTF-8 中文，跨块切断时必须用 `StringDecoder` 续上，否则半截多字节字符会被
 * 写成替换字符并原样回灌给上游。
 */
export function createReasoningEchoObserver(): ReasoningEchoObserver {
  const replay = replayCache.createReplay()
  const decoder = new StringDecoder('utf8')
  let carry = ''
  let finished = false

  return {
    push(chunk) {
      if (finished) return
      const text = typeof chunk === 'string' ? chunk : decoder.write(chunk)
      if (text.length === 0) return
      carry += text
      const cut = carry.lastIndexOf('\n')
      if (cut < 0) return
      replay.observeSseChunk(carry.slice(0, cut + 1))
      carry = carry.slice(cut + 1)
    },
    finish() {
      if (finished) return
      finished = true
      const tail = carry + decoder.end()
      carry = ''
      if (tail.length > 0) replay.observeSseChunk(tail)
      // 失败/被取消也要提交：下一轮同样需要这份思考（与 worker.ts 同口径）。
      replay.commit()
    },
  }
}

/** 非流式响应体：`choices[0].message` 里已带完整的思考与工具调用 id。 */
export function recordReasoningEchoCompletion(body: unknown): void {
  const replay = replayCache.createReplay()
  replay.observeCompletion(body)
  replay.commit()
}