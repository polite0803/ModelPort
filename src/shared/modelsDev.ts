/**
 * models.dev 目录读取器（纯函数，无 electron / axios）。
 *
 * 存在的理由：`aggregate/registry.ts` 的模型清单是**手抄 + 人工核验**的，
 * 每加一家就要重抄一遍，新模型上市到出现在列表里要等一次发版。models.dev
 * 把这些元数据聚合起来，于是这里只需要回答"某一家有哪些聊天模型"。
 *
 * 三条纪律：
 *
 * 1. **形状不认识就说形状不认识**（返回 null），不返回空数组。空数组会被上层
 *    说成"这家没有模型"，用户会去换 Key —— 与 `modelListReaders.ts` 同一条理由。
 * 2. **只按 `type` 过滤，不按名字猜。** `type` 缺省才是聊天模型；embedding /
 *    reranking / transcription / image / video 一律不进候选，因为它们放进
 *    `/v1/models` 只会被客户端当成聊天模型发过来。
 * 3. **这里只读 id 与展示名。** context / cost / tool_call 之类的数字属于能力与
 *    额度，各有各的权威（`modelCapabilities.ts`、`aggregateQuota.ts`）；
 *    在解析层顺手抄一份就会造出第二个真相，之后两边必然打架。
 */

import type { FetchedModel } from './types.ts'

/** models.dev 的整份目录。它是第三方的聚合清单，只作补充，不覆盖上游真实响应。 */
export const MODELS_DEV_URL = 'https://models.dev/api.json'

type Payload = Record<string, unknown>

/** 允许出现的"聊天"类型标记；缺省视为聊天。 */
const NON_CHAT_TYPE = new Set(['embedding', 'reranking', 'transcription', 'image', 'video', 'speech'])

/**
 * 目录 id 与 models.dev 键名不一致的几家。
 *
 * 只收**实测过是同一家**的：102 个条目里 68 个没有同 id 的键，其中大多数只是叫法不同
 * （`together` / `togetherai`、`vertex` / `google-vertex`），按名字相似去猜会把别家的
 * 清单拉进来。这里一条一条加，加之前先看那份切片的模型 id 是不是同一个命名空间。
 */
const MODELS_DEV_PROVIDER_IDS: Record<string, string> = {
  // 同为 `@cf/...` 模型命名空间；Cloudflare 的 OpenAI 兼容面不提供 GET /models（405）。
  cloudflare: 'cloudflare-workers-ai',
}

function modelsDevKey(providerId: string): string {
  return MODELS_DEV_PROVIDER_IDS[providerId] ?? providerId
}

function asRecord(value: unknown): Payload | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Payload)
    : null
}

function text(entry: Payload, key: string): string | undefined {
  const value = entry[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

export interface ModelsDevProvider {
  id: string
  name: string
  /** 该家声明的默认端点；仅用于展示，绝不自动覆盖用户已存的 baseUrl。 */
  api?: string
  doc?: string
}

/**
 * 取出某一家的目录切片。`payload` 是 models.dev 的整份 `api.json`
 * （`{ providerId: { name, api, models: { modelId: {...} } } }`）。
 */
export function readModelsDevProvider(payload: unknown, providerId: string): ModelsDevProvider | null {
  const root = asRecord(payload)
  if (!root) return null

  const provider = asRecord(root[modelsDevKey(providerId)])
  if (!provider) return null

  // models 必须是对象；缺失或形状不对都算"读不懂"，不是"没有模型"。
  if (!asRecord(provider.models)) return null

  return {
    id: text(provider, 'id') ?? providerId,
    name: text(provider, 'name') ?? providerId,
    api: text(provider, 'api'),
    doc: text(provider, 'doc'),
  }
}

/**
 * 列出某一家的聊天模型。顺序沿用 payload 里的键序（models.dev 按发布新旧排），
 * 重复 id 只留第一次出现的那条。
 */
export function listModelsDevModels(payload: unknown, providerId: string): FetchedModel[] {
  const root = asRecord(payload)
  if (!root) return []
  const provider = asRecord(root[modelsDevKey(providerId)])
  if (!provider) return []
  const models = asRecord(provider.models)
  if (!models) return []

  const result: FetchedModel[] = []
  const seen = new Set<string>()

  for (const [key, raw] of Object.entries(models)) {
    const model = asRecord(raw)
    if (!model) continue

    const type = text(model, 'type')
    if (type && NON_CHAT_TYPE.has(type.toLowerCase())) continue

    const actualModelId = text(model, 'id') ?? (key.trim() || undefined)
    if (!actualModelId || seen.has(actualModelId)) continue
    seen.add(actualModelId)

    result.push({
      displayName: text(model, 'name') ?? actualModelId,
      actualModelId,
    })
  }

  return result
}

export type SyncModelSource = 'upstream' | 'models.dev' | 'none'

export interface SyncModelPlan {
  source: SyncModelSource
  /** 去空白、去重后的上游模型 id，保持来源顺序。 */
  ids: string[]
}

/**
 * 决定这次同步用哪一份清单。
 *
 * `upstream` 是**三态**，不是"有没有模型"：
 * - `null`   = 探测失败（没有 modelsUrl、401、网络错误）→ 才允许退到 models.dev；
 * - `[]`     = 探测成功但上游一条没报 → 这是上游的明确回答，**不许**换成第三方清单；
 * - `[...]`  = 上游清单，永远优先。
 *
 * 这条三态是必要的：把 `[]` 也当成"读不到"，等于在上游真没有模型时用第三方目录
 * 伪造一份，请求会发给一个上游并不提供的模型。
 */
export function planSyncModelIds(input: {
  upstream: FetchedModel[] | null
  modelsDev: FetchedModel[] | null
}): SyncModelPlan {
  const source: SyncModelSource =
    input.upstream !== null ? 'upstream' : input.modelsDev !== null ? 'models.dev' : 'none'
  const rows = input.upstream ?? input.modelsDev ?? []

  const ids: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const id = (row.actualModelId ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }

  return { source, ids }
}
