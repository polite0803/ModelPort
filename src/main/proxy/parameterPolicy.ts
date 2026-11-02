import type { ChatCompletionRequest } from './types'

/**
 * 内置适配器无法生效、但 OpenAI 兼容客户端默认就会带的参数。
 * 静默丢弃即可，报 400 只会让客户端整体不可用；
 * response_format 也只是“希望模型输出 JSON”的提示，靠提示词同样能满足。
 */
const STRIPPED_FOR_BUILTIN = [
  'stream_options',
  'response_format',
  'top_p',
  'stop',
  'frequency_penalty',
  'presence_penalty',
  'max_tokens',
  'seed',
  'logit_bias',
  'logprobs',
  'top_logprobs',
  'prediction',
  'modalities',
  'audio',
  'service_tier',
  'reasoning',
  'top_k',
] as const

export function findUnsupportedParameter(
  request: ChatCompletionRequest,
  provider: { type?: string }
): string | null {
  if (provider.type !== 'builtin') return null

  // 只有 n > 1 会真正改变响应结构，内置适配器无法满足
  if (typeof request.n === 'number' && request.n > 1) return 'n'

  return null
}

/**
 * 对内置供应商剥离无法生效的采样参数，返回新对象、不修改入参；
 * 自定义供应商原样透传，避免误删它们能识别的字段。
 */
export function stripUnsupportedForBuiltin<T extends ChatCompletionRequest>(
  request: T,
  provider: { type?: string }
): T {
  if (provider.type !== 'builtin') return request

  const raw = request as ChatCompletionRequest & Record<string, unknown>
  if (!STRIPPED_FOR_BUILTIN.some(name => raw[name] !== undefined)) return request

  const next: Record<string, unknown> = { ...raw }
  for (const name of STRIPPED_FOR_BUILTIN) {
    delete next[name]
  }
  return next as T
}

export function unsupportedParameterError(param: string) {
  return {
    error: {
      message: `Parameter "${param}" is not supported by built-in providers`,
      type: 'invalid_request_error',
      param,
      code: 'unsupported_parameter',
    },
  }
}
