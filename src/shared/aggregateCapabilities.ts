/**
 * 聚合目录的**第三方能力**旁表 —— 由 scripts/build-aggregate-capabilities.mjs 生成，请勿手改。
 * 要更新就带 --payload 抓一次 models.dev 的 api.json 重建快照，再重新生成。
 *
 * 只回答一件事：这条模型的 tools / reasoning / 输入模态 / 上下文窗口，第三方是否
 * 有声明。它是能力解析里**最低**的一层自动证据（排在厂商官方、供应商同步、静态表
 * 之后），只填前面都没说的字段，永远不覆盖已有标注；用户的手工标注又在它之上。
 *
 * 口径：只有 `tool_call: true` / `reasoning: true` 才算证据，`false` 与缺失一律
 * 不写 —— 社区目录里的 false 更可能是「没填」，把它当「不支持」会误筛。
 *
 * 快照：models.dev https://models.dev/api.json，复核日期 2026-10-31；
 * 24 家 / 93 条模型：tools 90、reasoning 83、
 * 输入模态 93、上下文窗口 93。
 */

import type { ModelCapabilityHint } from './types.ts'

export interface AggregateCapabilityRow {
  /** 对齐到的 models.dev 供应商 id（与本目录的 entryId 常常不同名） */
  modelsDevProviderId: string
  models: Record<string, ModelCapabilityHint>
}

export const AGGREGATE_CAPABILITIES: Record<string, AggregateCapabilityRow> = {
  'alibaba_cloud': {
    modelsDevProviderId: 'alibaba',
    models: {
      'qwen3-coder-plus': { tools: 'yes', modalities: ['text'], contextTokens: 1048576 },
      'qwen3.5-plus': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image', 'video'], contextTokens: 1000000 },
    },
  },
  'cline_pass': {
    modelsDevProviderId: 'cline-pass',
    models: {
      'cline-pass/deepseek-v4-flash': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 1000000 },
      'cline-pass/deepseek-v4-pro': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 1000000 },
      'cline-pass/glm-5.2': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 1000000 },
      'cline-pass/kimi-k2.6': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image', 'video'], contextTokens: 262144 },
      'cline-pass/kimi-k2.7-code': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image', 'video'], contextTokens: 262144 },
      'cline-pass/kimi-k3': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image', 'video'], contextTokens: 1048576 },
      'cline-pass/mimo-v2.5': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image', 'audio', 'video'], contextTokens: 1048576 },
      'cline-pass/mimo-v2.5-pro': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 1048576 },
      'cline-pass/minimax-m3': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image', 'video'], contextTokens: 1048576 },
      'cline-pass/qwen3.7-max': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 1000000 },
      'cline-pass/qwen3.7-plus': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image', 'video'], contextTokens: 1000000 },
    },
  },
  'deepseek': {
    modelsDevProviderId: 'deepseek',
    models: {
      'deepseek-v4-flash': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image'], contextTokens: 1048576 },
      'deepseek-v4-flash-vision-exp': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image'], contextTokens: 1048576 },
      'deepseek-v4-pro': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 1048576 },
    },
  },
  'glm-cn': {
    modelsDevProviderId: 'zhipuai-coding-plan',
    models: {
      'glm-4.6v': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image', 'video'], contextTokens: 128000 },
      'glm-5.3': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 1000000 },
      'glm-5.3-flash': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image', 'video', 'pdf'], contextTokens: 1000000 },
    },
  },
  'kilo': {
    modelsDevProviderId: 'kilo',
    models: {
      'kilo-auto/free': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 256000 },
      'nvidia/nemotron-3-ultra-550b-a55b:free': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 1000000 },
    },
  },
  'kimi_code': {
    modelsDevProviderId: 'kimi-code-plan-cn',
    models: {
      'k3': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image', 'video'], contextTokens: 1048576 },
      'kimi-for-coding': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image', 'video'], contextTokens: 1048576 },
      'kimi-for-coding-highspeed': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image', 'video'], contextTokens: 262144 },
    },
  },
  'morph': {
    modelsDevProviderId: 'morph',
    models: {
      'morph-dsv4flash': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 1048576 },
      'morph-v3-fast': { modalities: ['text'], contextTokens: 262144 },
      'morph-v3-large': { modalities: ['text'], contextTokens: 262144 },
    },
  },
  'nvidia_nim': {
    modelsDevProviderId: 'nvidia',
    models: {
      'moonshotai/kimi-k2.6': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image', 'video'], contextTokens: 262144 },
      'nvidia/nemotron-3-ultra-550b-a55b': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 1000000 },
    },
  },
  'ollama_cloud': {
    modelsDevProviderId: 'ollama-cloud',
    models: {
      'gpt-oss:120b': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 131072 },
      'minimax-m3': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image', 'video'], contextTokens: 512000 },
    },
  },
  'open_router': {
    modelsDevProviderId: 'openrouter',
    models: {
      'openrouter/free': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image'], contextTokens: 200000 },
    },
  },
  'opper': {
    modelsDevProviderId: 'opper',
    models: {
      'claude-sonnet-4-6': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image', 'pdf'], contextTokens: 1000000 },
    },
  },
  'orcarouter': {
    modelsDevProviderId: 'orcarouter',
    models: {
      'deepseek/deepseek-v4-flash-free': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 1000000 },
    },
  },
  'ovh': {
    modelsDevProviderId: 'ovhcloud',
    models: {
      'gpt-oss-120b': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 131072 },
      'gpt-oss-20b': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 131072 },
    },
  },
  'poolside': {
    modelsDevProviderId: 'poolside',
    models: {
      'poolside/laguna-s-2.1': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 1048576 },
      'poolside/laguna-xs-2.1': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 262144 },
    },
  },
  'qwencloud': {
    modelsDevProviderId: 'alibaba-token-plan',
    models: {
      'deepseek-v4-pro': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 1000000 },
      'glm-5.2': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 1000000 },
      'qwen3.6-flash': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image', 'video'], contextTokens: 1000000 },
      'qwen3.7-max': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 1000000 },
      'qwen3.7-plus': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image', 'video'], contextTokens: 1000000 },
      'qwen3.8-max-preview': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image', 'video'], contextTokens: 1000000 },
    },
  },
  'qwencloud_coding': {
    modelsDevProviderId: 'alibaba-coding-plan',
    models: {
      'glm-4.7': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 202752 },
      'glm-5': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 202752 },
      'kimi-k2.5': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image', 'video'], contextTokens: 262144 },
      'MiniMax-M2.5': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 196608 },
      'qwen3-coder-next': { tools: 'yes', modalities: ['text'], contextTokens: 262144 },
      'qwen3-coder-plus': { tools: 'yes', modalities: ['text'], contextTokens: 1000000 },
      'qwen3.5-plus': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image', 'video'], contextTokens: 1000000 },
    },
  },
  'sambanova': {
    modelsDevProviderId: 'sambanova',
    models: {
      'Meta-Llama-3.3-70B-Instruct': { tools: 'yes', modalities: ['text'], contextTokens: 131072 },
    },
  },
  'sensenova': {
    modelsDevProviderId: 'sensenova',
    models: {
      'deepseek-v4-flash': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 1000000 },
      'deepseek-v4-pro': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 1048576 },
      'deepseek-v4.1-flash': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image'], contextTokens: 1048576 },
      'glm-5.2': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 1000000 },
      'kimi-k3': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image'], contextTokens: 1048576 },
      'sensenova-6.8-flash-lite': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image'], contextTokens: 262144 },
    },
  },
  'siliconflow': {
    modelsDevProviderId: 'siliconflow',
    models: {
      'deepseek-ai/DeepSeek-R1': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 164000 },
      'deepseek-ai/DeepSeek-V3.1': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 164000 },
      'deepseek-ai/DeepSeek-V3.1-Terminus': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 164000 },
      'deepseek-ai/DeepSeek-V3.2': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 164000 },
      'deepseek-ai/DeepSeek-V3.2-Exp': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 164000 },
      'deepseek-ai/DeepSeek-V4-Flash': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 1000000 },
      'deepseek-ai/DeepSeek-V4-Pro': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 1000000 },
      'inclusionAI/Ling-flash-2.0': { tools: 'yes', modalities: ['text'], contextTokens: 131000 },
      'MiniMaxAI/MiniMax-M2.5': { tools: 'yes', modalities: ['text'], contextTokens: 197000 },
      'moonshotai/Kimi-K2.5': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image'], contextTokens: 262000 },
      'moonshotai/Kimi-K2.6': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image'], contextTokens: 262000 },
      'openai/gpt-oss-120b': { reasoning: 'yes', modalities: ['text'], contextTokens: 131000 },
      'Qwen/Qwen3-32B': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 131000 },
      'Qwen/Qwen3.5-122B-A10B': { tools: 'yes', vision: 'yes', modalities: ['text', 'image'], contextTokens: 262144 },
      'Qwen/Qwen3.5-397B-A17B': { tools: 'yes', modalities: ['text'], contextTokens: 262144 },
      'zai-org/GLM-5': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 205000 },
      'zai-org/GLM-5.1': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 205000 },
    },
  },
  'tokenrouter': {
    modelsDevProviderId: 'tokenrouter',
    models: {
      'z-ai/glm-5.3-free': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 1000000 },
    },
  },
  'wandb': {
    modelsDevProviderId: 'wandb',
    models: {
      'openai/gpt-oss-20b': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 131072 },
    },
  },
  'xiaomi-tokenplan': {
    modelsDevProviderId: 'xiaomi-token-plan-sgp',
    models: {
      'mimo-v2.5': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image', 'audio', 'video'], contextTokens: 1048576 },
      'mimo-v2.5-pro': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 1048576 },
    },
  },
  'zai': {
    modelsDevProviderId: 'zai-coding-plan',
    models: {
      'glm-4.7': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 204800 },
      'glm-5-turbo': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 200000 },
      'glm-5.2': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 1000000 },
      'glm-5.3': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 1000000 },
      'glm-5.3-flash': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image', 'video', 'pdf'], contextTokens: 1000000 },
    },
  },
  'zai_api': {
    modelsDevProviderId: 'zai',
    models: {
      'glm-4.6v': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image', 'video'], contextTokens: 128000 },
      'glm-4.7': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 204800 },
      'glm-4.7-flash': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 200000 },
      'glm-5': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 204800 },
      'glm-5-turbo': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 200000 },
      'glm-5.1': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 200000 },
      'glm-5.2': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 1000000 },
      'glm-5.3': { tools: 'yes', reasoning: 'yes', modalities: ['text'], contextTokens: 1000000 },
      'glm-5.3-flash': { tools: 'yes', reasoning: 'yes', vision: 'yes', modalities: ['text', 'image', 'video', 'pdf'], contextTokens: 1000000 },
    },
  },
}

/**
 * 聚合条目的第三方能力标注。查不到就是查不到 —— 返回 `undefined`，不返回空对象：
 * 空对象在解释「这条为什么被筛掉」时会被当成「有第三方证据但什么都没说」。
 */
export function aggregateThirdPartyHint(
  entryId: string,
  modelId: string
): ModelCapabilityHint | undefined {
  return AGGREGATE_CAPABILITIES[entryId]?.models[modelId]
}
