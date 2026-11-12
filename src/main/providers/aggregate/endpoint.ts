/**
 * 聚合端点地址的请求期展开。
 *
 * 目录里少数上游把账号写进 URL（Cloudflare 的 `{account_id}`、Vertex 的
 * `{project_id}/{location}`），占位符的值跟着**每把 Key**走：同一家可以存多把
 * 来自不同账号的 Key，换账号时地址必须一起换。所以模板原样落盘在
 * `provider.apiEndpoint`，真正发请求前才用该账号的凭据展开。
 *
 * 展开失败不静默：`missing` 一定回到调用方，由它给出「缺哪个字段」的原因，
 * 而不是把带 `{...}` 的地址丢给 axios 换回一句 Invalid URL。
 */

import type { Account, Provider } from '../../store/types.ts'
import { expandAggregatePathVars, missingAggregatePathVars } from '../../../shared/aggregate.ts'

export interface ResolvedAggregateEndpoint {
  /** 展开后的地址；`missing` 非空时仍是模板，调用方必须先判定再发请求 */
  url: string
  /** 缺失值的占位符名（空数组 = 可以直接发） */
  missing: string[]
}

/**
 * 用账号凭据展开端点地址。不传账号（无 Key 条目、状态探测）时按空凭据展开，
 * 于是带占位符的地址会把缺失项如实报出来。
 */
export function resolveAggregateEndpoint(
  provider: Pick<Provider, 'apiEndpoint'>,
  credentials?: Account['credentials']
): ResolvedAggregateEndpoint {
  const base = (provider.apiEndpoint ?? '').trim()
  const values = credentials ?? {}
  return {
    url: expandAggregatePathVars(base, values),
    missing: missingAggregatePathVars(base, values),
  }
}

/** 缺字段时给界面/客户端读的一句话；调用方把它当成失败原因而不是网络错误。 */
export function aggregateEndpointMissingMessage(missing: readonly string[]): string {
  return `Endpoint is missing ${missing.join(', ')} — fill it when adding the key`
}