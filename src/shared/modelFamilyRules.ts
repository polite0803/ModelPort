/**
 * 家族规则：按模型名/家族推导可解释的默认值。
 *
 * 与 `main/proxy/modelCapabilities.ts` 的静态表互补：静态表按精确模型名，本表按家族前缀。
 * 每条规则必须写清 `evidence`（依据与适用家族），禁止在 provider 文件里散落硬编码。
 *
 * 规则只产出**可据家族解释**的字段：
 * - 分类（tools / reasoning / vision / modalities）来自家族公开能力声明；
 * - 数值（contextTokens / maxOutputTokens）只在家族有稳定公开口径时写，且置信度为
 *   `inferred` —— 对外 `/v1/models` 永远不会输出这一层（见设计文档 §6）。
 */
import type { ModelCapabilityHint } from './types.ts'
import type { MetadataLayer } from './modelMetadata.ts'

export interface ModelFamilyRule {
  id: string
  /** 人类可读的家族名，用于界面证据文案。 */
  family: string
  /** 已归一化（小写、去掉 provider 前缀）的模型名匹配。 */
  pattern: RegExp
  hint: ModelCapabilityHint
  /** 依据：公开口径 / 仓库内旁表 / 家族声明。 */
  evidence: string
}

export const MODEL_FAMILY_RULES: readonly ModelFamilyRule[] = [
  {
    id: 'openai-gpt-oss',
    family: 'OpenAI gpt-oss',
    pattern: /^gpt[-_]?oss(?:[-_.]|$)/,
    hint: { tools: 'yes', reasoning: 'yes', contextTokens: 131072 },
    evidence:
      'OpenAI gpt-oss 系列公开 128K (131072) 上下文，原生工具调用与 reasoning 通道；与 docs/data 旁表口径一致',
  },
  {
    id: 'moonshot-kimi-k2',
    family: 'Moonshot Kimi K2.x',
    pattern: /^kimi[-_]?k2(?:[._-]|$)/,
    hint: {
      tools: 'yes',
      reasoning: 'yes',
      vision: 'yes',
      modalities: ['text', 'image'],
      contextTokens: 262144,
    },
    evidence:
      '月之暗面 Kimi K2.x 公开 256K (262144) 上下文、图片输入与工具调用；与 models.dev 旁表一致',
  },
  {
    id: 'qwen3-coder',
    family: 'Qwen3-Coder',
    pattern: /^qwen[-_]?3(?:[._]\d+)?[-_]?coder/,
    hint: { tools: 'yes', contextTokens: 262144 },
    evidence: '阿里云 Qwen3-Coder 公开 256K (262144) 上下文与函数调用',
  },
  {
    id: 'zhipu-glm-5',
    family: '智谱 GLM-5',
    pattern: /^glm[-_]?5(?:[._-]|$)/,
    hint: { tools: 'yes', reasoning: 'yes' },
    evidence: '智谱 GLM-5 系列声明原生工具调用与 reasoning 输出',
  },
  {
    id: 'deepseek-v3-v4',
    family: 'DeepSeek V3/V4',
    pattern: /^deepseek[-_]?v(?:3|4)(?:[._-]|$)/,
    hint: { tools: 'yes', reasoning: 'yes' },
    evidence: 'DeepSeek V3/V4 声明函数调用与 reasoning_content 通道',
  },
  {
    id: 'anthropic-claude',
    family: 'Anthropic Claude',
    pattern: /^claude(?:[-_.]|$)/,
    hint: {
      tools: 'yes',
      vision: 'yes',
      modalities: ['text', 'image'],
      contextTokens: 200000,
    },
    evidence: 'Anthropic Claude 系列公开 200K 上下文、图片输入与原生工具调用',
  },
  {
    id: 'google-gemini',
    family: 'Google Gemini',
    pattern: /^gemini(?:[-_.]|$)/,
    hint: { tools: 'yes', vision: 'yes', modalities: ['text', 'image'] },
    evidence: 'Google Gemini 声明图片输入与函数调用',
  },
]

/** 归一化模型名：取最后一个 `/` 之后，小写并去掉首尾空白。 */
export function normalizeFamilyModelName(modelId: string): string {
  const slash = modelId.lastIndexOf('/')
  const tail = slash >= 0 ? modelId.slice(slash + 1) : modelId
  return tail.trim().toLowerCase()
}

/** 返回命中的家族规则（按表顺序；同名家族取第一条）。 */
export function matchFamilyRules(modelId: string): ModelFamilyRule[] {
  const normalized = normalizeFamilyModelName(modelId)
  if (!normalized) return []
  return MODEL_FAMILY_RULES.filter((rule) => rule.pattern.test(normalized))
}

/** 把家族规则折成一层证据；没有命中时返回 `undefined`。 */
export function familyRuleLayer(modelId: string): MetadataLayer | undefined {
  const rules = matchFamilyRules(modelId)
  if (rules.length === 0) return undefined
  const hint = rules.reduce<ModelCapabilityHint>(
    (merged, rule) => ({ ...merged, ...rule.hint }),
    {},
  )
  return {
    source: 'family-rule',
    confidence: 'inferred',
    evidence: rules.map((rule) => `${rule.family}: ${rule.evidence}`).join('；'),
    hint,
  }
}
