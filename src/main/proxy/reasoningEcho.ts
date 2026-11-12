/**
 * 思考回灌：观测下行 SSE → 按 `tool_call.id` 缓存 → 下一轮补回入站历史。
 *
 * DeepSeek 官方端点要求「带 `tool_calls` 的 assistant 历史必须回传当轮
 * `reasoning_content`」，而客户端不回传（实测 92%），于是整段对话在下一轮 400：
 * `The reasoning_content in the thinking mode must be passed back to the API.`
 *
 * 2026-11-12：账号渠道与聚合/直连线路合并到**同一条主线程泳道**。
 *
 * - 观测点放在路由（`routes/chat.ts`、`routes/completions.ts`）—— 那是下行 SSE
 *   的唯一出口，两条泳道（worker 组装好的渠道包 SSE、聚合线路的原始 SSE）
 *   都在这里过手；
 * - 回灌点放在转发器（`forwarder.ts`）：通用分支在请求体组装前改，账号渠道在
 *   派发给 worker 之前改；
 * - 渠道包的 `worker.ts` 不再自己观测/补回：它跑在独立的 `worker_threads` 里，
 *   和主线程各有一份 Map，跨泳道切换时上一轮的思考找不到（会话换家即 400）。
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
 * 账号渠道例外：它由 {@link reasoningEchoApplies} 整类放行，因为渠道包里
 * 每个上游各自要不要这个字段无从枚举，补一个它不认的字段也只是多一个属性。
 */
export function isDeepSeekEndpoint(endpoint: string | undefined): boolean {
  if (!endpoint) return false
  try {
    return new URL(endpoint).hostname.toLowerCase() === 'api.deepseek.com'
  } catch {
    return false
  }
}

/**
 * 这条线路要不要做思考回灌（开关 + 线路）。
 *
 * **账号渠道一律要做**：渠道包跑在独立的 worker 线程里，看不见本进程这份缓存，
 * 所以补回改由主线程在派发前完成（`forwarder.ts::forwardAccountChannel`），
 * 观测点就是下发给客户端的那份 SSE（chat / completions 路由）。两条泳道共用
 * 同一张 id 表 —— 上一轮由账号渠道发出、下一轮落到聚合线路（或反向）时，
 * 那份思考同样补得回来。
 *
 * 聚合/直连线路只认 `api.deepseek.com`：需要回传思考是**那个端点**的校验，
 * 同一模型在别家未必认这个字段。
 */
export function reasoningEchoApplies(
  provider: Pick<Provider, 'type'> & { apiEndpoint?: string },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!reasoningReplayEnabled(env)) return false
  if (provider.type === 'account') return true
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