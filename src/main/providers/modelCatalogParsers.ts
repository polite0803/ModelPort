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

function perMillion(perToken: unknown): number | undefined {
  if (typeof perToken !== 'number' || !Number.isFinite(perToken) || perToken < 0) return undefined
  return Number((perToken * USD_PER_MILLION).toFixed(6))
}

function money(input: unknown, output: unknown): CatalogPrice | undefined {
  const inputPerMillion = perMillion(input)
  const outputPerMillion = perMillion(output)
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
 * 价格是「每 token」美元，这里换算成 USD / 1M 供展示；换算只发生一次，
 * 且不会进入任何路由/额度计算。
 */
export function parseLiteLLM(raw: unknown): CatalogEntry[] {
  const root = objectOf(raw)
  if (!root) return []
  const entries: CatalogEntry[] = []

  for (const [id, value] of Object.entries(root)) {
    if (id === 'sample_spec') continue
    const info = objectOf(value)
    if (!info) continue
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
