/**
 * 客户端提前断开时，Node 在**响应写侧**抛出的 socket 错误。
 *
 * 这类错误不是服务端故障：客户端（IDE / CLI / 浏览器）在 SSE 流式响应中途
 * 取消或关闭连接，Koa 把它交给 `app.on('error')`，原先一律记成 500
 * `Server error`，把「用户取消」污染成「网关报错」。判据必须窄：只认这三个
 * socket 错误码，真实的上游读错误仍由 forwarder 正常记录为请求失败。
 */
export function isClientDisconnectError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'ECONNRESET'
    || code === 'EPIPE'
    || code === 'ERR_STREAM_PREMATURE_CLOSE'
}
