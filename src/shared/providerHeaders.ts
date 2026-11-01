/**
 * 厂商自定义头里不允许出现的名字（一律小写比较）。
 *
 * 保存侧（`providers/custom.ts` 的 `validateHeaders`）与转发侧（`proxy/forwarder.ts` 的
 * `buildHeaders`）共用这一份：写两份清单迟早会漂移，漂移的结果是「保存时放行、转发时才滤」
 * 或者反过来，两边各按一套规则行为不一致。
 *
 * 理由逐条：`Host` 伪造会绕过虚拟主机与网关路由；`Content-Length` / `Transfer-Encoding`
 * 与真实请求体不一致时是在上游代理面前做请求走私；`Connection` / `Upgrade` / `Proxy-*`
 * 属连接级语义，不该由一份厂商配置决定。
 */
export const FORBIDDEN_PROVIDER_HEADER_NAMES = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'upgrade',
  'te',
  'trailer',
  'proxy-authorization',
  'proxy-connection',
])

export function isForbiddenProviderHeader(name: string): boolean {
  return FORBIDDEN_PROVIDER_HEADER_NAMES.has(name.trim().toLowerCase())
}
