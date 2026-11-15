/**
 * 火山方舟 Agent Plan 在线模型目录（开放接口 ListArkAgentPlanModel）。
 *
 * 存在的理由：`/api/plan/v3` 这条订阅计费通路**没有** GET /models（实测 404），
 * 于是聚合条目的在线同步在这家永远读不到上游清单，只能停在手抄基线。厂商把
 * 程序化清单放在另一个开放接口上：
 *   POST https://ark.cn-beijing.volcengineapi.com/?Action=ListArkAgentPlanModel&Version=2024-01-01
 * 仅支持 Access Key（IAM AK/SK，HMAC-SHA256 V4 签名），与聊天用的 ark- Bearer Key
 * 不是一回事。AK/SK 从环境变量读（VOLCENGINE_ACCESS_KEY_ID / VOLCENGINE_SECRET_ACCESS_KEY，
 * 兼容 VOLC_ACCESSKEY / VOLC_SECRETKEY），不落盘、不进界面。
 *
 * 纪律同 `modelsDev.ts`：形状不认识就返回 null（不是空数组）；只有 Datas 真是数组
 * 才视为厂商的明确回答。读到的清单是上游自己的答案，调用方可据此 removeMissing。
 */

import { createHmac, createHash } from 'node:crypto'
import axios from 'axios'
import type { FetchedModel } from '../../../shared/types'

const HOST = 'ark.cn-beijing.volcengineapi.com'
const REGION = 'cn-beijing'
const SERVICE = 'ark'
const ACTION = 'ListArkAgentPlanModel'
const VERSION = '2024-01-01'
const TIMEOUT_MS = 20000

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex')
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

export interface VolcengineSignedHeaders {
  [key: string]: string
  Host: string
  'Content-Type': string
  'X-Date': string
  'X-Content-Sha256': string
  Authorization: string
}

/** 纯函数：给定时间与请求要素，产出 V4 签名头。导出供单测钉死形状。 */
export function signVolcengineV4(input: {
  accessKeyId: string
  secretAccessKey: string
  method: string
  path: string
  query: Record<string, string>
  body: string
  now: Date
}): VolcengineSignedHeaders {
  const xDate = input.now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const date = xDate.slice(0, 8)
  const payloadHash = sha256Hex(input.body)

  const headerPairs: Record<string, string> = {
    'content-type': 'application/json',
    host: HOST,
    'x-content-sha256': payloadHash,
    'x-date': xDate,
  }
  const signedHeaders = Object.keys(headerPairs).sort().join(';')
  const canonicalHeaders = Object.keys(headerPairs)
    .sort()
    .map(key => `${key}:${headerPairs[key]}\n`)
    .join('')
  const canonicalQuery = Object.keys(input.query)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(input.query[key])}`)
    .join('&')

  const canonicalRequest = [
    input.method,
    input.path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const scope = `${date}/${REGION}/${SERVICE}/request`
  const stringToSign = ['HMAC-SHA256', xDate, scope, sha256Hex(canonicalRequest)].join('\n')

  const kDate = hmac(input.secretAccessKey, date)
  const kRegion = hmac(kDate, REGION)
  const kService = hmac(kRegion, SERVICE)
  const kSigning = hmac(kService, 'request')
  const signature = hmac(kSigning, stringToSign).toString('hex')

  return {
    Host: HOST,
    'Content-Type': 'application/json',
    'X-Date': xDate,
    'X-Content-Sha256': payloadHash,
    Authorization: `HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}

/** 读取 ListArkAgentPlanModel 响应：Datas[].ModelID。形状不对返回 null。 */
export function readArkAgentPlanModels(payload: unknown): FetchedModel[] | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
  const datas = (payload as Record<string, unknown>).Datas
  if (!Array.isArray(datas)) return null

  const result: FetchedModel[] = []
  const seen = new Set<string>()
  for (const raw of datas) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    const row = raw as Record<string, unknown>
    const id = typeof row.ModelID === 'string' ? row.ModelID.trim() : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    const name = typeof row.ModelName === 'string' && row.ModelName.trim() !== '' ? row.ModelName.trim() : id
    result.push({ actualModelId: id, displayName: name })
  }
  return result
}

/** 在线取 Agent Plan 清单。任何失败返回 null，调用方保留原有降级路径。 */
export async function fetchArkAgentPlanModels(
  edition: 'personal' | 'enterprise',
  accessKeyId: string,
  secretAccessKey: string,
): Promise<FetchedModel[] | null> {
  const body = JSON.stringify({ Edition: edition })
  const query = { Action: ACTION, Version: VERSION }
  const headers = signVolcengineV4({
    accessKeyId,
    secretAccessKey,
    method: 'POST',
    path: '/',
    query,
    body,
    now: new Date(),
  })
  try {
    const response = await axios.post(`https://${HOST}/`, body, {
      params: query,
      headers,
      timeout: TIMEOUT_MS,
      validateStatus: () => true,
    })
    if (response.status >= 400) return null
    return readArkAgentPlanModels(response.data)
  } catch {
    return null
  }
}

/** 从环境变量读 Access Key；缺任一则返回 null（不启用在线目录）。 */
export function volcengineAccessKeyFromEnv(): { accessKeyId: string; secretAccessKey: string } | null {
  const accessKeyId = process.env.VOLCENGINE_ACCESS_KEY_ID ?? process.env.VOLC_ACCESSKEY
  const secretAccessKey = process.env.VOLCENGINE_SECRET_ACCESS_KEY ?? process.env.VOLC_SECRETKEY
  if (!accessKeyId || !secretAccessKey) return null
  return { accessKeyId, secretAccessKey }
}