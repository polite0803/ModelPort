/**
 * 聚合目录的**逐模型消耗信号**旁表 —— 由 scripts/build-aggregate-pricing.mjs 生成，请勿手改。
 * 要更新就带 --payload 抓一次 models.dev 的 api.json 重建快照，再重新生成。
 *
 * 两套信号，口径完全不同，消费方（`shared/aggregateCost.ts`）必须分开读：
 *
 * 1. `AGGREGATE_PRICE` —— models.dev 的**第三方**按 token 美元标价（USD / 1M）。
 *    只用来回答"这条有标价 / 这条零价"，不排序、不换算、不当倍率。
 * 2. `AGGREGATE_OFFICIAL_FREE` —— 取证回执里**官方页面点名免费**的模型 id
 *    （带 docUrl + asOf）。这是官方口径，但只有"是/否"，没有数字。
 *
 * ⚠️ 零价 ≠ 免费。订阅制端点（`AGGREGATE_PLAN_ENTRIES` 里那几家）在 models.dev
 * 上的边际价就是 0，因为额度已买断在套餐里；把它当免费会让人以为能不花钱无限用。
 * 这个区分必须由 `aggregateCostOf()` 做，不要在界面里自己判价格。
 *
 * 快照：models.dev https://models.dev/api.json
 * 复核日期 2026-10-29；23 家有标价 / 91 条模型，
 * 其中 42 条零价。官方免费清单：16 家 / 46 条
 * （回执里另有 0 条不在本目录模型清单内，已丢弃，不给发不出去的模型打标）。
 */

export interface AggregateModelPrice {
  /** 输入侧单价，USD / 1M tokens */
  input: number
  /** 输出侧单价，USD / 1M tokens */
  output: number
  cacheRead?: number
  cacheWrite?: number
}

export interface AggregateEntryPrice {
  /** 对齐到的 models.dev 供应商 id（与本目录的 entryId 常常不同名） */
  modelsDevProviderId: string
  models: Record<string, AggregateModelPrice>
}

export interface AggregateOfficialFree {
  models: string[]
  /** 官方页面 URL；空串表示回执没给出可复核的出处 */
  docUrl: string
  asOf: string
}

export const AGGREGATE_PRICE_SOURCE = {
  name: 'models.dev',
  url: 'https://models.dev/api.json',
  asOf: '2026-10-29',
  currency: 'USD',
  unit: 'per-million-tokens',
} as const

export const AGGREGATE_PRICE: Record<string, AggregateEntryPrice> = {
  'alibaba_cloud': {
    modelsDevProviderId: 'alibaba',
    models: {
      'qwen3-coder-plus': { input: 1, output: 5 },
      'qwen3.5-plus': { input: 0.4, output: 2.4 },
    },
  },
  'cline_pass': {
    modelsDevProviderId: 'cline-pass',
    models: {
      'cline-pass/deepseek-v4-flash': { input: 0.14, output: 0.28, cacheRead: 0.0028 },
      'cline-pass/deepseek-v4-pro': { input: 0.66, output: 1.98, cacheRead: 0.022 },
      'cline-pass/glm-5.2': { input: 1.4, output: 4.4, cacheRead: 0.26 },
      'cline-pass/kimi-k2.6': { input: 0.95, output: 4, cacheRead: 0.16 },
      'cline-pass/kimi-k2.7-code': { input: 0.95, output: 4, cacheRead: 0.19 },
      'cline-pass/kimi-k3': { input: 3, output: 15, cacheRead: 0.3 },
      'cline-pass/mimo-v2.5': { input: 0.14, output: 0.28, cacheRead: 0.0028 },
      'cline-pass/mimo-v2.5-pro': { input: 1.74, output: 3.48, cacheRead: 0.0145 },
      'cline-pass/minimax-m3': { input: 0.3, output: 1.2, cacheRead: 0.06 },
      'cline-pass/qwen3.7-max': { input: 2.5, output: 7.5, cacheRead: 0.5, cacheWrite: 3.125 },
      'cline-pass/qwen3.7-plus': { input: 0.4, output: 1.6, cacheRead: 0.04, cacheWrite: 0.5 },
    },
  },
  'deepseek': {
    modelsDevProviderId: 'deepseek',
    models: {
      'deepseek-v4-flash': { input: 0.15, output: 0.6, cacheRead: 0.003 },
      'deepseek-v4-flash-vision-exp': { input: 0.15, output: 0.6, cacheRead: 0.003 },
      'deepseek-v4-pro': { input: 0.66, output: 1.98, cacheRead: 0.022 },
    },
  },
  'glm-cn': {
    modelsDevProviderId: 'zhipuai-coding-plan',
    models: {
      'glm-4.6v': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      'glm-5.3': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      'glm-5.3-flash': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  },
  'kilo': {
    modelsDevProviderId: 'kilo',
    models: {
      'kilo-auto/free': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      'nvidia/nemotron-3-ultra-550b-a55b:free': { input: 0, output: 0 },
    },
  },
  'kimi_code': {
    modelsDevProviderId: 'kimi-code-plan-cn',
    models: {
      'k3': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      'kimi-for-coding': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      'kimi-for-coding-highspeed': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  },
  'morph': {
    modelsDevProviderId: 'morph',
    models: {
      'morph-dsv4flash': { input: 0.141953, output: 0.399625, cacheRead: 0.035937 },
      'morph-v3-fast': { input: 0.8, output: 1.2 },
      'morph-v3-large': { input: 0.9, output: 1.9 },
    },
  },
  'nvidia_nim': {
    modelsDevProviderId: 'nvidia',
    models: {
      'moonshotai/kimi-k2.6': { input: 0, output: 0 },
      'nvidia/nemotron-3-ultra-550b-a55b': { input: 0, output: 0 },
    },
  },
  'ollama_cloud': {
    modelsDevProviderId: 'ollama-cloud',
    models: {
      'gpt-oss:120b': { input: 0.15, output: 0.6, cacheRead: 0.014 },
      'minimax-m3': { input: 0.6, output: 2.4, cacheRead: 0.12 },
    },
  },
  'open_router': {
    modelsDevProviderId: 'openrouter',
    models: {
      'openrouter/free': { input: 0, output: 0 },
    },
  },
  'opper': {
    modelsDevProviderId: 'opper',
    models: {
      'claude-sonnet-4-6': { input: 3.3, output: 16.5, cacheRead: 0.33, cacheWrite: 4.125 },
    },
  },
  'orcarouter': {
    modelsDevProviderId: 'orcarouter',
    models: {
      'deepseek/deepseek-v4-flash-free': { input: 0, output: 0 },
    },
  },
  'poolside': {
    modelsDevProviderId: 'poolside',
    models: {
      'poolside/laguna-s-2.1': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      'poolside/laguna-xs-2.1': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  },
  'qwencloud': {
    modelsDevProviderId: 'alibaba-token-plan',
    models: {
      'deepseek-v4-pro': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      'glm-5.2': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      'qwen3.6-flash': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      'qwen3.7-max': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      'qwen3.7-plus': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      'qwen3.8-max-preview': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  },
  'qwencloud_coding': {
    modelsDevProviderId: 'alibaba-coding-plan',
    models: {
      'glm-4.7': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      'glm-5': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      'kimi-k2.5': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      'MiniMax-M2.5': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      'qwen3-coder-next': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      'qwen3-coder-plus': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      'qwen3.5-plus': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  },
  'sambanova': {
    modelsDevProviderId: 'sambanova',
    models: {
      'Meta-Llama-3.3-70B-Instruct': { input: 0.6, output: 1.2 },
    },
  },
  'sensenova': {
    modelsDevProviderId: 'sensenova',
    models: {
      'deepseek-v4-flash': { input: 0, output: 0, cacheRead: 0 },
      'deepseek-v4-pro': { input: 0, output: 0, cacheRead: 0 },
      'deepseek-v4.1-flash': { input: 0, output: 0, cacheRead: 0 },
      'glm-5.2': { input: 0, output: 0, cacheRead: 0 },
      'kimi-k3': { input: 0, output: 0, cacheRead: 0 },
      'sensenova-6.8-flash-lite': { input: 0, output: 0, cacheRead: 0 },
    },
  },
  'siliconflow': {
    modelsDevProviderId: 'siliconflow',
    models: {
      'deepseek-ai/DeepSeek-R1': { input: 0.5, output: 2.18 },
      'deepseek-ai/DeepSeek-V3.1': { input: 0.27, output: 1 },
      'deepseek-ai/DeepSeek-V3.1-Terminus': { input: 0.27, output: 1 },
      'deepseek-ai/DeepSeek-V3.2': { input: 0.27, output: 0.42, cacheRead: 0.135 },
      'deepseek-ai/DeepSeek-V3.2-Exp': { input: 0.27, output: 0.41 },
      'deepseek-ai/DeepSeek-V4-Flash': { input: 0.13, output: 0.28, cacheRead: 0.028 },
      'deepseek-ai/DeepSeek-V4-Pro': { input: 1.50162, output: 3.135, cacheRead: 0.135 },
      'inclusionAI/Ling-flash-2.0': { input: 0.14, output: 0.57 },
      'MiniMaxAI/MiniMax-M2.5': { input: 0.3, output: 1.2, cacheRead: 0.03 },
      'moonshotai/Kimi-K2.5': { input: 0.45, output: 2.25, cacheRead: 0.07 },
      'moonshotai/Kimi-K2.6': { input: 0.77, output: 3.4, cacheRead: 0.14 },
      'openai/gpt-oss-120b': { input: 0.05, output: 0.45 },
      'Qwen/Qwen3-32B': { input: 0.14, output: 0.57 },
      'Qwen/Qwen3.5-122B-A10B': { input: 0.26, output: 2.08 },
      'Qwen/Qwen3.5-397B-A17B': { input: 0.39, output: 2.34 },
      'zai-org/GLM-5': { input: 0.95, output: 2.55, cacheRead: 0.2 },
      'zai-org/GLM-5.1': { input: 1.19, output: 3.74, cacheRead: 0.6, cacheWrite: 0 },
    },
  },
  'tokenrouter': {
    modelsDevProviderId: 'tokenrouter',
    models: {
      'z-ai/glm-5.3-free': { input: 0, output: 0 },
    },
  },
  'wandb': {
    modelsDevProviderId: 'wandb',
    models: {
      'openai/gpt-oss-20b': { input: 0.03, output: 0.13, cacheRead: 0.03 },
    },
  },
  'xiaomi-tokenplan': {
    modelsDevProviderId: 'xiaomi-token-plan-sgp',
    models: {
      'mimo-v2.5': { input: 0, output: 0, cacheRead: 0 },
      'mimo-v2.5-pro': { input: 0, output: 0, cacheRead: 0 },
    },
  },
  'zai': {
    modelsDevProviderId: 'zai-coding-plan',
    models: {
      'glm-4.7': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      'glm-5-turbo': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      'glm-5.2': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      'glm-5.3': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      'glm-5.3-flash': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  },
  'zai_api': {
    modelsDevProviderId: 'zai',
    models: {
      'glm-4.6v': { input: 0.3, output: 0.9, cacheRead: 0.05, cacheWrite: 0 },
      'glm-4.7': { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0 },
      'glm-4.7-flash': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      'glm-5': { input: 1, output: 3.2, cacheRead: 0.2, cacheWrite: 0 },
      'glm-5-turbo': { input: 1.2, output: 4, cacheRead: 0.24, cacheWrite: 0 },
      'glm-5.1': { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
      'glm-5.2': { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
      'glm-5.3': { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
      'glm-5.3-flash': { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 },
    },
  },
}

export const AGGREGATE_OFFICIAL_FREE: Record<string, AggregateOfficialFree> = {
  'bazaarlink': {
    models: ['auto:free'],
    docUrl: 'https://bazaarlink.ai/pricing',
    asOf: '2026-10-29',
  },
  'cerebras': {
    models: ['gpt-oss-120b'],
    docUrl: 'https://inference-docs.cerebras.ai/support/rate-limits',
    asOf: '2026-10-29',
  },
  'cloudflare': {
    models: ['@cf/meta/llama-3.2-1b-instruct', '@cf/meta/llama-3.2-3b-instruct', '@cf/meta/llama-3.1-8b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct-awq', '@cf/mistralai/mistral-small-3.1-24b-instruct', '@cf/meta/llama-3.1-70b-instruct-fp8-fast', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', '@cf/moonshotai/kimi-k2.5', '@cf/moonshotai/kimi-k2.6', '@cf/zai-org/glm-4.7-flash', '@cf/qwen/qwq-32b', '@cf/qwen/qwen2.5-coder-32b-instruct'],
    docUrl: 'https://developers.cloudflare.com/workers-ai/platform/pricing/',
    asOf: '2026-10-29',
  },
  'cohere': {
    models: ['command-r-plus-08-2024', 'command-r-08-2024', 'command-a-03-2025', 'command-a-plus-05-2026'],
    docUrl: 'https://docs.cohere.com/docs/rate-limits',
    asOf: '2026-10-29',
  },
  'kilo': {
    models: ['kilo-auto/free', 'nvidia/nemotron-3-super-120b-a12b:free', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'kwaipilot/kat-coder-pro-v2.5:free'],
    docUrl: 'https://kilo.ai/docs/getting-started/rate-limits-and-costs',
    asOf: '2026-10-29',
  },
  'nararoute': {
    models: ['kimi-k3-free'],
    docUrl: 'https://router.bynara.id/',
    asOf: '2026-10-29',
  },
  'nvidia_nim': {
    models: ['minimaxai/minimax-m2.7', 'minimaxai/minimax-m3', 'z-ai/glm-5.2', 'deepseek-ai/deepseek-v4-pro', 'deepseek-ai/deepseek-v4-flash', 'moonshotai/kimi-k2.6', 'nvidia/nemotron-3-ultra-550b-a55b', 'nvidia/nemotron-3-super-120b-a12b'],
    docUrl: 'https://docs.nvidia.com/nim/cosmos/1.0.0/EULA.html',
    asOf: '2026-10-29',
  },
  'open_router': {
    models: ['openrouter/free'],
    docUrl: 'https://openrouter.ai/docs/api-reference/limits',
    asOf: '2026-10-29',
  },
  'opencode_zen': {
    models: ['big-pickle', 'jev-1.13-free', 'mimo-v2.6-flash-free', 'nemotron-3-ultra-free', 'nemotron-3.5-lightning-free'],
    docUrl: 'https://opencode.ai/docs/zen',
    asOf: '2026-10-29',
  },
  'orcarouter': {
    models: ['deepseek/deepseek-v4-flash-free'],
    docUrl: '',
    asOf: '2026-10-29',
  },
  'qiniu': {
    models: ['qiniu/conatus-free'],
    docUrl: 'https://www.qiniu.com/ai/free-models/conatus-2026',
    asOf: '2026-10-29',
  },
  'sambanova': {
    models: ['Meta-Llama-3.3-70B-Instruct'],
    docUrl: 'https://docs.sambanova.ai/docs/en/models/rate-limits',
    asOf: '2026-10-29',
  },
  'tokenrouter': {
    models: ['moonshotai/kimi-k3-free', 'z-ai/glm-5.3-free'],
    docUrl: '',
    asOf: '2026-10-29',
  },
  'xkiro': {
    models: ['qwen/qwen3.7-flash:free'],
    docUrl: 'https://xkiro.com/',
    asOf: '2026-10-29',
  },
  'zai_api': {
    models: ['glm-4.7-flash'],
    docUrl: 'https://docs.z.ai/guides/llm/glm-5.3.md',
    asOf: '2026-10-29',
  },
  'zenmux': {
    models: ['deepseek/deepseek-v4-flash-free'],
    docUrl: '',
    asOf: '2026-10-29',
  },
}

export function aggregatePriceOf(entryId: string, modelId: string): AggregateModelPrice | undefined {
  return AGGREGATE_PRICE[entryId]?.models?.[modelId]
}

export function isZeroPrice(price: AggregateModelPrice | undefined): boolean {
  return price !== undefined && price.input === 0 && price.output === 0
}

export function officialFreeEvidenceOf(entryId: string, modelId: string): AggregateOfficialFree | undefined {
  const row = AGGREGATE_OFFICIAL_FREE[entryId]
  return row !== undefined && row.models.includes(modelId) ? row : undefined
}
