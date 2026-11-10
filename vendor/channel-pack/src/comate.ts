import { randomUUID } from 'node:crypto'
import { arch, hostname, platform, release } from 'node:os'
import { COMATE } from './comate-product.js'

/**
 * Comate 账号凭据。
 *
 * License 是一串不透明的 UUID；`displayName` 来自登录接口，仅用于面板昵称。
 * 它**不会过期**（`refreshable` 恒为 false），所以没有 refresh_token。
 */
export interface ComateCredential {
  license: string
  displayName?: string
  /** 登录完成时刻（毫秒），仅用于展示/排查。 */
  authenticatedAt?: number
}

/** 目录条目（已把上游的 K 单位换算成 token）。 */
export interface ComateModelEntry {
  id: string
  name: string
  /** 上游 `maxContextWindow`（单位 K）× 1024；缺失表示上游没说。 */
  contextWindow?: number
  supportsImage: boolean
  supportsThinking: boolean
}

/** 免费额度模型。窗口/输出上限上游没有给，故不编造。 */
export const COMATE_FREE_MODEL: ComateModelEntry = {
  id: COMATE.freeModelId,
  name: COMATE.freeModelName,
  supportsImage: false,
  supportsThinking: true,
}

/**
 * Comate 免费额度的**可观测状态**。
 *
 * 上游没有“剩余积分”数字（`daily_cost` 对试用账号返回 null），所以这里不编造
 * 余额，而是记录**最近一次 Auto-Free 请求的真实结果**：
 * - `available`：最近一次 Auto-Free 成功出流；
 * - `limited`：最近一次 Auto-Free 收到 `QUOTA_EXCEED`；
 * - `unknown`：本轮还没有 Auto-Free 请求，或记录已超过免费额度的 1 小时窗口。
 *
 * 面板据此显示“可用 / 已用尽 / 待确认”，用户发送一条消息即可刷新感知。
 */
export type ComateFreeQuotaStatus = 'available' | 'limited' | 'unknown'

export interface ComateFreeQuotaReading {
  status: ComateFreeQuotaStatus
  /** 最近一次能证明该状态的请求时刻（毫秒）。 */
  lastAt?: number
  /** 上游限额文案或状态说明。 */
  note?: string
}

interface ComateFreeQuotaRecord {
  status: 'available' | 'limited'
  at: number
  note?: string
}

const FREE_QUOTA_TTL_MS = 60 * 60 * 1_000
const freeQuotaRecords = new Map<string, ComateFreeQuotaRecord>()

/** 记录一次 Auto-Free 请求的真实结果（适配器在成功/限额时调用）。 */
export function recordComateFreeQuota(
  license: string,
  status: 'available' | 'limited',
  note?: string,
): void {
  if (license.length === 0) return
  freeQuotaRecords.set(license, {
    status,
    at: Date.now(),
    ...note !== undefined && note.length > 0 ? { note } : {},
  })
}

/**
 * 读取免费额度状态。
 *
 * ⚠️ 超过 1 小时窗口的记录降级为 `unknown`：免费额度按小时重置，旧的成功/失败
 * 都不能代表当前这一小时；保留 `lastAt`/`note` 让界面说明“上次读数的时间”。
 */
export function readComateFreeQuota(license: string): ComateFreeQuotaReading {
  const record = freeQuotaRecords.get(license)
  if (record === undefined) return { status: 'unknown' }
  if (Date.now() - record.at > FREE_QUOTA_TTL_MS) {
    return {
      status: 'unknown',
      lastAt: record.at,
      ...record.note !== undefined ? { note: record.note } : {},
    }
  }
  return {
    status: record.status,
    lastAt: record.at,
    ...record.note !== undefined ? { note: record.note } : {},
  }
}

/** 解析凭据 JSON；兼容「直接存 License 字符串」的历史/手工写入。 */
export function parseComateCredential(raw: string | undefined): ComateCredential | undefined {
  if (typeof raw !== 'string' || raw.trim().length === 0) return undefined
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{')) {
    return { license: trimmed }
  }
  try {
    const parsed = JSON.parse(trimmed) as Partial<ComateCredential>
    if (typeof parsed.license !== 'string' || parsed.license.length === 0) return undefined
    return {
      license: parsed.license,
      ...typeof parsed.displayName === 'string' && parsed.displayName.length > 0
        ? { displayName: parsed.displayName }
        : {},
      ...typeof parsed.authenticatedAt === 'number' && Number.isFinite(parsed.authenticatedAt)
        ? { authenticatedAt: parsed.authenticatedAt }
        : {},
    }
  } catch {
    return undefined
  }
}

/** 序列化凭据写盘。 */
export function serializeComateCredential(credential: ComateCredential): string {
  return JSON.stringify({
    license: credential.license,
    ...credential.displayName !== undefined ? { displayName: credential.displayName } : {},
    ...credential.authenticatedAt !== undefined ? { authenticatedAt: credential.authenticatedAt } : {},
  })
}

/** 官方 CLI 在 SaaS 登录页上展示的设备串：`<用户名> <主机名> (<平台> <架构> <发行版>)`。 */
export function comateDeviceLabel(): string {
  const user = (() => {
    try {
      return process.env.USER ?? process.env.USERNAME ?? 'modelport'
    } catch {
      return 'modelport'
    }
  })()
  return `${user} ${hostname()} (${platform()} ${arch()} ${release()})`
}

/** 登录页地址。`device` 必须整体 URL 编码。 */
export function comateLoginUrl(clientId: string): string {
  const track = encodeURIComponent(COMATE.loginTrack)
  const device = encodeURIComponent(comateDeviceLabel())
  return `${COMATE.apiOrigin}/zh/login?track=${track}&clientId=${encodeURIComponent(clientId)}&device=${device}`
}

/** 所有 Comate API 共用的请求头。License 按官方 CLI 的方式 URL 编码后放进两个登录名头。 */
export function comateHeaders(license: string, traceId = randomUUID()): Record<string, string> {
  const encoded = encodeURIComponent(license)
  return {
    'Content-Type': 'application/json',
    'User-Agent': `${COMATE.clientName}/${COMATE.clientVersion}`,
    'login-name': encoded,
    'Uuap-login-name': encoded,
    'X-Source': 'COMATE',
    'plugin-version': `${COMATE.clientName}-${COMATE.clientVersion}`,
    'x-skip-fcnap': 'yes',
    'X-Trace-Id': traceId,
  }
}

/**
 * agent 执行接口强制要求的 `uploadBaseInfo`。
 *
 * 缺这个字段服务端会直接回 `参数uploadBaseInfo不能为空`（实测 2026-11-11）。
 * 值全部来自当前进程/机器，不伪造其它 IDE。
 */
export function comateUploadBaseInfo(license: string): Record<string, unknown> {
  return {
    os: platform() === 'win32' ? 'Windows' : platform() === 'darwin' ? 'Mac OS' : 'Linux',
    osVersion: release(),
    extName: COMATE.clientName,
    extVersion: COMATE.clientVersion,
    ideType: COMATE.clientName,
    ideName: COMATE.clientName,
    ideVersion: COMATE.clientVersion,
    username: license,
    license,
    pluginVersion: COMATE.clientVersion,
    device: `modelport-${hostname()}`,
    triggerSource: '',
  }
}

/** `{username, ide, ideVersion, pluginVersion}` 是每个 autowork 请求都要带的基础字段。 */
export function comateClientInfo(license: string): Record<string, string> {
  return {
    username: license,
    ide: COMATE.clientName,
    ideVersion: COMATE.clientVersion,
    pluginVersion: COMATE.clientVersion,
  }
}

interface ComateModelWire {
  modelId?: unknown
  displayName?: unknown
  maxContextWindow?: unknown
  supportImage?: unknown
  supportThinking?: unknown
}

/**
 * 拉取账号可用的模型目录。
 *
 * ⚠️ `maxContextWindow` 的单位是 **K token**（实测：GLM-4.7 返回 200、
 * Deepseek V4 Flash 返回 1024），这里统一乘 1024 换成 token；非正数一律
 * 不写进条目（「没说」不是「0」）。
 */
export async function fetchComateModels(
  credential: ComateCredential,
  fetcher: typeof fetch = fetch,
): Promise<ComateModelEntry[]> {
  const response = await fetcher(`${COMATE.apiOrigin}${COMATE.apiPrefix}/v2/api/models/available`, {
    method: 'POST',
    headers: comateHeaders(credential.license),
    body: JSON.stringify({
      ...comateClientInfo(credential.license),
      type: 'ZULU',
      rootRepo: '',
      submodules: [],
      zuluVersion: COMATE.clientVersion,
      source: 'plugin',
      ideType: COMATE.clientName,
    }),
  })
  if (!response.ok) {
    throw new Error(`Comate 模型目录请求失败：HTTP ${response.status}`)
  }
  const body = await response.json() as { status?: string; message?: string; data?: { models?: ComateModelWire[] } }
  if (body.status !== 'OK') {
    throw new Error(`Comate 模型目录返回异常：${body.message ?? body.status ?? 'unknown'}`)
  }
  const models = Array.isArray(body.data?.models) ? body.data.models : []
  const mapped = models.flatMap((model): ComateModelEntry[] => {
    if (typeof model.modelId !== 'string' || model.modelId.length === 0) return []
    // 官方 CLI 会过滤掉 `auto`：它不是可用模型 id（免费额度另有内部 id）。
    if (model.modelId.toLowerCase() === 'auto') return []
    const contextK = typeof model.maxContextWindow === 'number' ? model.maxContextWindow : Number(model.maxContextWindow)
    const contextWindow = Number.isFinite(contextK) && contextK > 0 ? Math.round(contextK * 1024) : undefined
    return [{
      id: model.modelId,
      name: typeof model.displayName === 'string' && model.displayName.length > 0
        ? model.displayName
        : model.modelId,
      ...contextWindow !== undefined ? { contextWindow } : {},
      // 图片：无论上游是否声明，本适配器都不发送图片；声明支持却发不出去
      // 比不声明更糟（客户端会以为图片被看到了）。
      supportsImage: false,
      supportsThinking: model.supportThinking === true,
    }]
  })
  return [COMATE_FREE_MODEL, ...mapped.filter(model => model.id !== COMATE_FREE_MODEL.id)]
}

/** 校验 License 是否仍有效（官方 CLI 登录后/续期时使用的端点）。 */
export async function isComateLicenseValid(
  license: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const response = await fetcher(
    `${COMATE.apiOrigin}${COMATE.apiPrefix}/key/valid/${encodeURIComponent(license)}`,
    { headers: { 'Content-Type': 'application/json' } },
  )
  if (!response.ok) return false
  const body = await response.json() as { status?: string; data?: unknown }
  return body.status === 'OK' && body.data === true
}
