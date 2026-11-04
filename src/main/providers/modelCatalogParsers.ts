/**
 * 三个第三方标准台账的解析器。
 *
 * 输入是 `unknown`（网络响应已经 `JSON.parse`），输出一律经过
 * `shared/modelCatalog.ts::sanitizeCatalogEntry`：类型、范围、模态集合都在那里收口。
 * 解析器本身不判断「可信度」，也不抓网络；单测用本地 fixture 直接喂对象。
 */
import {
  sanitizeCatalogEntry,
  type CatalogEntry,
  type CatalogPrice,
  type CatalogSourceId,
} from '../../shared/modelCatalog.ts'

const USD_PER_MILLION = 1_000_000
/** 与 `shared/modelCatalog.ts::MAX_PRICE_PER_MILLION` 同一口径：USD / 1M tokens 展示上限。 */
const MAX_PRICE_PER_MILLION = 10_000_000
/** 换算后保留 6 位小数：per-token 值常见到 1e-8，6 位已足够且不会引入浮点尾巴。 */
const PRICE_DECIMALS = 6

/**
 * LiteLLM/OpenRouter 的 per-token 价格 → USD / 1M tokens。
 *
 * 显式规则（口径写在这里，界面与采用 ledger 不再换算）：
 * - 只接受有限、非负的数值；
 * - 先按上限反推（`max / 1e6`），避免先乘后溢出；
 * - 乘以 1e6 后保留 {@link PRICE_DECIMALS} 位小数；
 * - 超出 `MAX_PRICE_PER_MILLION` 的值直接丢弃，不截断成上限（截断会伪造一个价格）。
 */
export function perTokenToPerMillion(perToken: unknown): number | undefined {
  if (typeof perToken !== 'number' || !Number.isFinite(perToken) || perToken < 0) return undefined
  if (perToken > MAX_PRICE_PER_MILLION / USD_PER_MILLION) return undefined
  const converted = perToken * USD_PER_MILLION
  if (!Number.isFinite(converted) || converted > MAX_PRICE_PER_MILLION) return undefined
  return Number(converted.toFixed(PRICE_DECIMALS))
}

function money(input: unknown, output: unknown): CatalogPrice | undefined {
  const inputPerMillion = perTokenToPerMillion(input)
  const outputPerMillion = perTokenToPerMillion(output)
  if (inputPerMillion === undefined && outputPerMillion === undefined) return undefined
  return {
    ...(inputPerMillion === undefined ? {} : { inputPerMillion }),
    ...(outputPerMillion === undefined ? {} : { outputPerMillion }),
    currency: 'USD',
  }
}

function booleanFlag(value: unknown): 'yes' | 'no' | undefined {
  return value === true ? 'yes' : value === false ? 'no' : undefined
}

function providerOf(id: string): string | undefined {
  const slash = id.indexOf('/')
  return slash > 0 ? id.slice(0, slash) : undefined
}

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * models.dev `/api.json`：`{ [providerId]: { models: { [modelId]: {...} } } }`。
 * `cost.input/output` 已经是 USD / 1M tokens，不再换算。
 */
export function parseModelsDev(raw: unknown): CatalogEntry[] {
  const root = objectOf(raw)
  if (!root) return []
  const providers = objectOf(root.providers) ?? root
  const entries: CatalogEntry[] = []

  for (const [providerId, providerValue] of Object.entries(providers)) {
    const provider = objectOf(providerValue)
    const models = provider && objectOf(provider.models)
    if (!models) continue
    for (const [key, modelValue] of Object.entries(models)) {
      const model = objectOf(modelValue)
      if (!model) continue
      const id = typeof model.id === 'string' && model.id.trim() ? model.id.trim() : key
      const limit = objectOf(model.limit)
      const cost = objectOf(model.cost)
      const modalities = objectOf(model.modalities)
      const entry = sanitizeCatalogEntry(
        {
          id,
          provider: providerId,
          contextTokens: limit?.context,
          maxOutputTokens: limit?.output,
          modalities: Array.isArray(modalities?.input) ? modalities.input : undefined,
          vision: booleanFlag(model.attachment),
          tools: booleanFlag(model.tool_call),
          price:
            typeof cost?.input === 'number' || typeof cost?.output === 'number'
              ? {
                  inputPerMillion: cost?.input,
                  outputPerMillion: cost?.output,
                  currency: 'USD',
                }
              : undefined,
        },
        'models.dev',
      )
      if (entry) entries.push(entry)
    }
  }
  return entries
}

/**
 * LiteLLM `model_prices_and_context_window.json`：`{ [modelId]: {...} }`。
 *
 * 口径（真实响应里 4,500+ 条，约 1/4 不是对话模型）：
 * - 键可能带 provider 前缀（`azure/...`、`watsonx/core42/...`），前缀只用于展示来源；
 * - `mode` 决定用途：只取 `chat` / `vision`；`embedding`、`rerank`、`image_generation`
 *   等不是对话模型，混进来只会稀释候选。缺失 `mode` 的老条目按对话模型保留；
 * - 价格是「每 token」美元，这里经 {@link perTokenToPerMillion} 一次性换算；
 * - 上下文/输出上限按 `max_input_tokens` / `max_output_tokens` 直取（老的 `max_tokens`
 *   是同义字段），不做「上下文减输出」之类的二次推断。
 */
const LITELLM_CHAT_MODES: ReadonlySet<string> = new Set(['chat', 'vision'])

export function parseLiteLLM(raw: unknown): CatalogEntry[] {
  const root = objectOf(raw)
  if (!root) return []
  const entries: CatalogEntry[] = []

  for (const [id, value] of Object.entries(root)) {
    if (id === 'sample_spec') continue
    const info = objectOf(value)
    if (!info) continue
    // 只保留对话/视觉模型；有 `mode` 但不是这两类的一律跳过。
    if (typeof info.mode === 'string' && !LITELLM_CHAT_MODES.has(info.mode)) continue
    const maxOutput = info.max_output_tokens ?? info.max_tokens
    const entry = sanitizeCatalogEntry(
      {
        id,
        provider: providerOf(id),
        contextTokens: info.max_input_tokens,
        maxOutputTokens: maxOutput,
        vision: booleanFlag(info.supports_vision),
        tools: booleanFlag(info.supports_function_calling),
        modalities:
          info.supports_vision === true ? ['text', 'image'] : undefined,
        price: money(info.input_cost_per_token, info.output_cost_per_token),
      },
      'litellm',
    )
    if (entry) entries.push(entry)
  }
  return entries
}

/**
 * OpenRouter `/models`：`{ data: [{ id, context_length, pricing, architecture, ... }] }`。
 * `pricing.prompt/completion` 是字符串形式的「每 token」美元。
 */
export function parseOpenRouter(raw: unknown): CatalogEntry[] {
  const root = objectOf(raw)
  if (!root || !Array.isArray(root.data)) return []
  const entries: CatalogEntry[] = []

  for (const item of root.data) {
    const model = objectOf(item)
    if (!model) continue
    const id = typeof model.id === 'string' ? model.id.trim() : ''
    if (id.length === 0) continue
    const architecture = objectOf(model.architecture)
    const supported = Array.isArray(model.supported_parameters)
      ? model.supported_parameters
      : []
    const pricing = objectOf(model.pricing)
    const prompt = typeof pricing?.prompt === 'string' ? Number(pricing.prompt) : undefined
    const completion =
      typeof pricing?.completion === 'string' ? Number(pricing.completion) : undefined
    const modalities = Array.isArray(architecture?.input_modalities)
      ? architecture.input_modalities
      : undefined
    const entry = sanitizeCatalogEntry(
      {
        id,
        provider: providerOf(id),
        contextTokens: model.context_length,
        maxOutputTokens: objectOf(model.top_provider)?.max_completion_tokens,
        modalities,
        vision: Array.isArray(modalities) && modalities.includes('image') ? 'yes' : undefined,
        tools: supported.includes('tools') ? 'yes' : undefined,
        price: money(prompt, completion),
      },
      'openrouter',
    )
    if (entry) entries.push(entry)
  }
  return entries
}

export function parseCatalogPayload(source: CatalogSourceId, raw: unknown): CatalogEntry[] {
  switch (source) {
    case 'models.dev':
      return parseModelsDev(raw)
    case 'litellm':
      return parseLiteLLM(raw)
    case 'openrouter':
      return parseOpenRouter(raw)
  }
}
