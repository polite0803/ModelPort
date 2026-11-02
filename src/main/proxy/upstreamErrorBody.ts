/**
 * 上游 4xx 的响应体读取。
 *
 * 为什么要有这一层：流式请求走 `responseType: 'stream'`，4xx 时 axios 交回来的是
 * 一条流而不是已解析的 JSON。旧代码在这条流上做键查找，全都落空，最后
 * `JSON.stringify(流)` 因循环引用抛错 ⇒ 客户端只拿到字面量 `Unknown error`。
 * 2026-11-02 实测：Claude Desktop 的一笔请求被 OVH 拒掉，真实原因写在上游顶层
 * `message` 里（`feature 'extra arguments: {"user":…}' is not currently supported`），
 * 整条链路上一个字节都没留下；按文案判定的换家判据也因此一条都不命中。
 */

import type { UpstreamErrorDetails } from './types.ts'

/** 只读到这个字节数：错误体再长也不是给人整段读的。 */
const MAX_ERROR_BYTES = 32 * 1024

/** 原文进日志的上限：读取上限是 32KB，但一条日志不该被整份 HTML 撑满。 */
const MAX_ERROR_BODY_LOG_CHARS = 4_000

/** 读取超时：上游挂着不结束时要能退回状态码，而不是把请求拖到自己的截止线上。 */
const READ_TIMEOUT_MS = 3_000

/**
 * 上游交回来的错误体是一条 Node 可读流（`IncomingMessage`），但这里的调用只用到
 * 事件与 `destroy`，所以按能力声明，不绑定具体类 —— 测试里的 `PassThrough` 同样满足。
 */
interface ErrorBodyStream extends NodeJS.ReadableStream {
  destroy?: () => void
}

function isReadableStream(value: unknown): value is ErrorBodyStream {
  return typeof value === 'object' && value !== null && typeof (value as NodeJS.ReadableStream).on === 'function'
}

function drain(stream: ErrorBodyStream): Promise<string | null> {
  return new Promise(resolve => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false

    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stream.destroy?.()
      // 按字节硬截断：单个 chunk 就可能远超上限，而这句话要同时进请求日志与客户端的
      // 错误体，不能按「读够了就不再读」以外的口径留成长块。
      const text = Buffer.concat(chunks).subarray(0, MAX_ERROR_BYTES).toString('utf8')
      resolve(text === '' ? null : text)
    }

    // 超时也交回已经读到的部分：半句原因仍然比 `Unknown error` 有用。
    const timer = setTimeout(finish, READ_TIMEOUT_MS)

    stream.on('data', (chunk: Buffer | string) => {
      if (settled) return
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      chunks.push(buf)
      size += buf.length
      if (size >= MAX_ERROR_BYTES) finish()
    })
    stream.on('end', finish)
    stream.on('error', finish)
    stream.on('close', finish)
  })
}

/**
 * 把 4xx 的响应体归一成「可查键的东西」：流读成文本并尽量按 JSON 解析，其余原样返回。
 * 一个字节都没读到（空流 / 出错 / 超时前没数据）返回 `null`，由 `pickUpstreamErrorMessage`
 * 退回状态码 —— 不能把那条流交回键查找，否则只会 dump 出它的内部状态当「原因」。
 */
export async function readUpstreamErrorData(data: unknown): Promise<unknown> {
  if (!isReadableStream(data)) return data
  const text = await drain(data)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * 从已解析的上游错误体里取那句人能读的话。
 *
 * 键的顺序按实测分布排：`error.message`（OpenAI 形状）→ `message`（OVH 这类顶层
 * 文案）→ `msg`；都没有就把整个体贴出来，最后才是 `HTTP <状态码>`。
 */
export function pickUpstreamErrorMessage(payload: unknown, status: number): string {
  return pickUpstreamErrorDetails(payload, status).message
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function codeOf(value: unknown): string | number | null | undefined {
  if (typeof value === 'string' || typeof value === 'number') return value
  return value === null ? null : undefined
}

/** 原文只进日志/诊断；调用方负责不要把它直接拼进客户端可见文案。 */
export function summarizeUpstreamErrorBody(payload: unknown): string | undefined {
  if (payload === null || payload === undefined) return undefined
  let text: string | undefined
  if (typeof payload === 'string') {
    text = payload
  } else {
    try {
      text = JSON.stringify(payload)
    } catch {
      text = undefined
    }
  }
  if (text === undefined || text === '') return undefined
  return text.slice(0, MAX_ERROR_BODY_LOG_CHARS)
}

/**
 * 从上游错误体里取结构化字段，而不是只取一句话。
 *
 * 覆盖三种实际形状：
 * - OpenAI 兼容：`{error:{message,type,param,code,metadata}}`
 * - Claude：`{type:"error",error:{type,message}}`（内部 `type` 是错误类，不是信封类）
 * - Gemini / 顶层消息：`{error:{code,message,status}}`、`{message}`、`{msg}`
 *
 * `type/code/param` 只在**上游真的给了**时出现；没给就留给路由层按状态码兜底，
 * 避免伪造一个看起来来自上游的机读字段。
 */
export function pickUpstreamErrorDetails(payload: unknown, status: number): UpstreamErrorDetails {
  const fallback = `HTTP ${status}`
  if (typeof payload === 'string') {
    return { message: payload.trim() || fallback }
  }
  if (!payload || typeof payload !== 'object') {
    return { message: fallback }
  }

  const record = payload as Record<string, unknown>
  const nested = record.error
  if (nested && typeof nested === 'object') {
    const error = nested as Record<string, unknown>
    const message =
      textOf(error.message)
      ?? textOf(error.error)
      ?? textOf(record.message)
      ?? textOf(record.msg)
      ?? fallback
    const type = textOf(error.type) ?? textOf(error.status)
    const param =
      typeof error.param === 'string' || error.param === null ? error.param : undefined
    const code = codeOf(error.code)
    return {
      message,
      ...(type === undefined ? {} : { type }),
      ...(param === undefined ? {} : { param }),
      ...(code === undefined ? {} : { code }),
      ...(error.metadata === undefined ? {} : { metadata: error.metadata }),
    }
  }
  if (typeof nested === 'string' && nested.trim() !== '') {
    return { message: nested.trim() }
  }

  const message = textOf(record.message) ?? textOf(record.msg) ?? textOf(record.detail) ?? fallback
  const type = textOf(record.type)
  const param = typeof record.param === 'string' || record.param === null ? record.param : undefined
  const code = codeOf(record.code)
  return {
    message,
    ...(type === undefined ? {} : { type }),
    ...(param === undefined ? {} : { param }),
    ...(code === undefined ? {} : { code }),
  }
}
