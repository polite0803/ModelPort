/**
 * 聚合目录里少数端点的服务条款冲突提示。
 *
 * 这里的每一条都是**逐字复核过原文**的（复核日期见 `asOf`，出处见 `docUrl`）。判定标准只有一条：
 * 我没能从官方页面读到那句话，就不写进这里——宁可少标一家，也不替厂商编一条限制。
 * 2026-11-12 补齐国内订阅套餐时，讯飞星辰与腾讯 Token Plan 的页面只读到转述（"禁止自动化脚本"
 * 之类），没有可逐字引用的整句，因此**有意不列**：缺一条警告比引一段自己编的话要好。
 * 因此 `zai`（`api.z.ai/api/coding/paas/v4`，端点形状与智谱套餐同源）暂未列入：
 * 它的 devpack 页面没有对偶条款，需要另找条款页后补。
 *
 * 用户裁定（2026-10-29）：**条目保留 + 显式条款警告**，不停服务、不撤目录。
 * 本仓不做任何客户端指纹伪装来绕过这些限制。
 */

export type TermsScope = 'all-requests' | 'free-tier-models'

export interface AggregateTermsWarning {
  entryId: string
  /** 这条限制在什么情况下咬人 */
  scope: TermsScope
  /** 厂商原文，逐字引用 */
  quote: string
  /** 我实际读到那句话的页面 */
  docUrl: string
  /** 复核日期 */
  asOf: string
}

export const AGGREGATE_TERMS_WARNINGS: AggregateTermsWarning[] = [
  {
    entryId: 'opencode_zen',
    scope: 'free-tier-models',
    quote: 'Free-tier chat models require OpenCode; use paid models or Go from other clients.',
    docUrl: 'https://opencode.ai/docs/zen',
    asOf: '2026-10-29',
  },
  {
    entryId: 'qwencloud_coding',
    scope: 'all-requests',
    quote:
      "This plan is for interactive use in programming tools such as Claude Code, Qoder, Qoder CN, and OpenClaw. Do not use the plan's API key for automated scripts, application backends, or other non-interactive scenarios. Using the API key outside the permitted scope is a violation that may result in subscription suspension or API key revocation.",
    docUrl: 'https://www.alibabacloud.com/help/en/model-studio/coding-plan',
    asOf: '2026-10-29',
  },
  {
    entryId: 'glm-cn',
    scope: 'all-requests',
    quote: '套餐仅限在官方支持的指定工具与产品环境中使用。在除规定工具外调用 API，不可享用 Coding 套餐的额度。',
    docUrl: 'https://docs.bigmodel.cn/cn/coding-plan/overview',
    asOf: '2026-10-29',
  },
  {
    entryId: 'bailian_coding_plan',
    scope: 'all-requests',
    quote:
      '严禁 API 调用：仅限在编程工具（如 Claude Code、Qoder、OpenClaw 等）中使用，禁止以 API 调用的形式用于自动化脚本、自定义应用程序后端或任何非交互式批量调用场景。将套餐 API Key 用于允许范围之外的调用将被视为违规或滥用，可能会导致订阅被暂停或 API Key 被封禁。',
    docUrl: 'https://help.aliyun.com/zh/model-studio/coding-plan-overview',
    asOf: '2026-11-12',
  },
  {
    entryId: 'tencent_coding_plan',
    scope: 'all-requests',
    quote:
      '严禁 API 调用：仅限在编程工具（例如：Claude Code、CodeBuddy Code、OpenClaw 等）中使用，禁止以 API 调用的形式用于自动化脚本、自定义应用程序后端或任何非交互式批量调用场景。将套餐 API Key 用于允许范围之外的调用将被视为违规或滥用，可能会导致订阅被暂停或 API Key 被封禁。',
    docUrl: 'https://cloud.tencent.com/document/product/1823/130092',
    asOf: '2026-11-12',
  },
  {
    entryId: 'qianfan_coding_plan',
    scope: 'all-requests',
    quote:
      '套餐额度仅可在编程工具（如 Claude Code、Qwen Code 等）中使用。禁止以 API 调用的形式用于自动化脚本、自定义应用程序后端或任何非交互式批量调用场景。',
    docUrl: 'https://cloud.baidu.com/doc/qianfan/s/imlg0beiu',
    asOf: '2026-11-12',
  },
  {
    entryId: 'qianfan_token_plan',
    scope: 'all-requests',
    quote: '仅限在兼容的AI编程和智能体工具中交互式使用，不可用于自动化脚本或应用后端。',
    docUrl: 'https://cloud.baidu.com/doc/qianfan/s/Dmrabu8b6',
    asOf: '2026-11-12',
  },
  {
    entryId: 'jd_coding_plan',
    scope: 'all-requests',
    quote:
      '仅支持在指定 AI 编程工具中使用，包括 Claude Code、OpenCode、OpenClaw、Roo Code、Cursor。若在非编程工具中使用 Coding Plan 的 BaseURL 与 API Key，将无法消耗额度，且可能被识别为滥用。',
    docUrl: 'https://docs.jdcloud.com/cn/jdaip/vs-codingplan',
    asOf: '2026-11-12',
  },
]

const WARNINGS_BY_ENTRY = new Map(AGGREGATE_TERMS_WARNINGS.map(w => [w.entryId, w]))

export function getTermsWarning(entryId: string): AggregateTermsWarning | undefined {
  return WARNINGS_BY_ENTRY.get(entryId)
}

/** 只受免费档约束的条目，配上具体免费模型数才能说清"哪几个模型不能这样用"。 */
export function termsWarningModelIds(
  warning: AggregateTermsWarning,
  freeModelIds: string[]
): string[] {
  return warning.scope === 'free-tier-models' ? freeModelIds : []
}
