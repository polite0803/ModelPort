/**
 * 文心快码（Baidu Comate）的静态产品常量。
 *
 * 协议来源：百度官方 `@comate/comatecli` 2.0.0（MIT）。这里只复刻它公开的
 * SaaS 调用顺序：浏览器设备绑定拿 License，再用 License 调模型目录与
 * agent 执行接口。**不篡改** CLI 的产品名、版本号或身份头 —— 与其它渠道
 * 的 `upstreamIdentity` 披露口径一致。
 */
export interface ComateProductShape {
  id: 'comate'
  displayName: string
  vendor: string
  apiOrigin: string
  apiPrefix: string
  loginTrack: string
  clientName: string
  clientVersion: string
  freeModelId: string
  freeModelName: string
}

export const COMATE: ComateProductShape = {
  id: 'comate',
  displayName: '文心快码 (百度)',
  vendor: '百度',
  /** SaaS API 源站；所有路径都在 `/api` 下。 */
  apiOrigin: 'https://comate.baidu.com',
  apiPrefix: '/api',
  /** 登录页的 track 参数，官方 CLI 用 `COMATE_CLI`。 */
  loginTrack: 'COMATE_CLI',
  /** 客户端家族/版本，写入 `plugin-version: zulucli-<version>`。 */
  clientName: 'zulucli',
  clientVersion: '2.0.0',
  /**
   * 免费额度模型的内部 id。
   *
   * 它**不在** `/v2/api/models/available` 的返回里（该接口只列订阅模型），
   * 但试用/免费账号实际只能调用它；用付费模型 id 会得到 `QUOTA_EXCEED`，
   * 服务端提示升级。故目录里必须显式补这一条。
   */
  freeModelId: 'auto-free-individual',
  freeModelName: 'Auto-Free',
}

export type ComateProduct = typeof COMATE
