/**
 * 「全部补齐」的纯计划层：范围选取、exact/alias 自动采用字段、探测范围与成本估算。
 *
 * 这里不联网、不写盘、不读 store —— 主进程批量编排与界面预估共用同一套函数，
 * 保证「界面显示会发多少请求」就是执行时真正要发的量。
 */
import type {
  CatalogAdoption,
  CatalogAdoptionField,
  CatalogMatch,
  CatalogMatchConfidence,
} from './modelCatalog.ts'
import { catalogAdoptionKey } from './modelCatalog.ts'
import type { ProbeFailureKind } from './modelProbe.ts'
import type { Fact, ModelMetadataRow } from './modelMetadata.ts'
import { familyRuleLayer } from './modelFamilyRules.ts'
import {
  planContextProbe,
  planOutputProbe,
  type ProbePlan,
  type ProbeScope,
} from './modelProbe.ts'

/**
 * 自动采用字段：价格只展示，绝不进入自动采用。
 *
 * `reasoning` 于 2026-11-04 由用户拍板放开（原裁定是只允许逐字段手工采用），两个方向都收，
 * 但方向不同口径不同：
 * - `yes` 是补强：`inferred` 级（家族规则 / 第三方旁表）可以被它覆盖；
 * - `no` 是**排除性证据**，只在完全没有证据时写；行上已有任何已知值（含家族规则）就不动。
 *   实测依据（2026-11-04，一个 980 行的真实目录）：models.dev 说 `no` 的 183 行里 183 行
 *   没有相反证据，只有 8 行与家族规则冲突（deepseek-v3 / kimi-k2 那几族）；而由同一份
 *   models.dev 生成的 93 条旁表里 `reasoning: 'yes'` 的 83 条，原文 0 条说 `no`。
 *   原裁定担心的「社区台账的 false 只是按默认回答」在这份数据上不成立。
 *
 * 其余三道闸门不变：只有 exact / alias 匹配才自动采用（`highestAutoMatch`），
 * family / fuzzy 永不采用；批量目标仍限「被至少一条启用路由引用」的模型；已声明字段
 * （人工标记 / 上游声明 / 成本账本）永远不覆盖。
 */
export const CATALOG_BATCH_AUTO_FIELDS: readonly CatalogAdoptionField[] = [
  'contextTokens',
  'maxOutputTokens',
  'modalities',
  'vision',
  'tools',
  'reasoning',
] as const

export type CatalogBatchAdoptionField = (typeof CATALOG_BATCH_AUTO_FIELDS)[number]

/** 单模型计划：采用哪些字段、还要探测哪些 scope。 */
export interface CatalogBatchPlanItem {
  providerId: string
  displayName: string
  actualModelId: string
  /** 用于自动采用的最高置信度；`family` 不采用。 */
  matchConfidence?: CatalogMatchConfidence
  matchCatalogId?: string
  /** 只有 family 级候选、没有 exact/alias：只展示，不采用。 */
  familyCandidate: boolean
  adoptFields: CatalogBatchAdoptionField[]
  probeScopes: ProbeScope[]
  probePlans: ProbePlan[]
  probeRequests: number
  probeTokens: number
}

/** 预演合计（探测关闭时 requests/tokens 为 0）。 */
export interface CatalogBatchEstimate {
  models: number
  fields: number
  probeModels: number
  requests: number
  tokens: number
  exactModels: number
  aliasModels: number
  familyCandidates: number
  /** 因停用或未被任何路由引用而跳过、未进入计划的模型数。 */
  skippedDisabled: number
}

export type CatalogBatchStatus = 'running' | 'paused' | 'done' | 'cancelled' | 'failed'
export type CatalogBatchPhase = 'prepare' | 'matching' | 'probing' | 'backoff' | 'done'
/**
 * 单模型结果：`partial` 表示「有字段成功、也有字段失败」。
 * 它必须进入失败清单并参与退避，不能因为「有成功」就被折叠成 `done`。
 */
export type CatalogBatchCurrentStatus =
  | 'matching'
  | 'probing'
  | 'done'
  | 'partial'
  | 'skipped'
  | 'failed'

export interface CatalogBatchFailure {
  providerId: string
  displayName: string
  error?: string
}

/** 主进程持有的批量任务快照；渲染层只订阅，不参与编排。 */
export interface CatalogBatchSnapshot {
  jobId: string
  status: CatalogBatchStatus
  phase: CatalogBatchPhase
  startedAt: string
  updatedAt: string
  totalModels: number
  /** 已处理（成功 + 跳过 + 失败）。 */
  processedModels: number
  currentModel?: string
  currentProviderId?: string
  currentStatus?: CatalogBatchCurrentStatus
  elapsedMs: number
  estimatedRemainingMs?: number
  success: number
  skipped: number
  failed: number
  /** 有成功也有失败的单模型数；同时计入 `failed` 与失败清单。 */
  partial: number
  adoptedFields: number
  /** 探测成功的字段数（context / output 各算一项，不再按模型计数）。 */
  measuredFields: number
  exactAdoptedModels: number
  aliasAdoptedModels: string[]
  familyCandidates: number
  failedModels: CatalogBatchFailure[]
  /** 计划阶段被过滤掉的停用 / 未被路由引用模型数。 */
  skippedDisabled: number
  probeEnabled: boolean
  /**
   * 本次任务的范围：供应商 id（渠道 / 聚合条目）。缺省表示全目录补齐。
   * 进度面板靠它说明「这一轮只跑了 TRAE」，而不是让人以为全库补完了。
   */
  providerScope?: string
  /** 内部节奏：第几批 / 共几批，界面不展示。 */
  batchIndex: number
  batchTotal: number
  requestsSent: number
  requestLimit: number
  backoffUntil?: string
  lastError?: string
}

export interface CatalogBatchStartResult {
  success: boolean
  jobId?: string
  snapshot?: CatalogBatchSnapshot
  error?: string
}

export interface CatalogBatchStartInput {
  probe: boolean
  /** 仅重试上一任务的失败项；主进程按 jobId 查内存记录。 */
  retryFailedOf?: string
  /**
   * 范围收口：只处理该供应商（渠道 id / 聚合条目 id）的模型。
   * 省略 = 全目录。估算与启动必须传同一个范围，否则确认弹窗里的数字与实际跑的不符。
   */
  providerId?: string
}

function isDeclaredFact(fact: Fact<unknown>): boolean {
  return fact.state === 'known' && fact.confidence === 'declared'
}

function factValue<T>(fact: Fact<T>): T | undefined {
  return fact.state === 'known' ? fact.value : undefined
}

function shouldProbeFact(fact: Fact<number>): boolean {
  if (fact.state !== 'known') return true
  // measured 已有新鲜读数；declared 保持原值；只有 inferred 还需要实测补强。
  return fact.confidence === 'inferred'
}

/**
 * 条目是否带有这个字段、且这个值可以进批量（空值不算）。
 *
 * `reasoning` 两个方向都可以进批量，但 `no` 还要再过一道「行上没有任何已知值」的闸门
 * （见 `planCatalogBatchItem` 里的 `reasoningNoNeedsEmptySlot`）：它是排除性证据，
 * 不能覆盖家族规则或旁表已经给出的 `yes`。
 */
function autoAdoptable(match: CatalogMatch, field: CatalogBatchAdoptionField): boolean {
  const entry = match.entry
  switch (field) {
    case 'contextTokens':
      return entry.contextTokens !== undefined
    case 'maxOutputTokens':
      return entry.maxOutputTokens !== undefined
    case 'modalities':
      return Array.isArray(entry.modalities) && entry.modalities.length > 0
    case 'vision':
    case 'tools':
      return entry[field] === 'yes' || entry[field] === 'no'
    case 'reasoning':
      return entry.reasoning === 'yes' || entry.reasoning === 'no'
    default:
      return false
  }
}

function rowDeclared(row: ModelMetadataRow, field: CatalogBatchAdoptionField): boolean {
  switch (field) {
    case 'contextTokens':
      return isDeclaredFact(row.contextTokens)
    case 'maxOutputTokens':
      return isDeclaredFact(row.maxOutputTokens)
    case 'modalities':
      return isDeclaredFact(row.modalities)
    case 'vision':
      return isDeclaredFact(row.vision)
    case 'tools':
      return isDeclaredFact(row.tools)
    case 'reasoning':
      return isDeclaredFact(row.reasoning)
    default:
      return true
  }
}

function probePlanForRow(row: ModelMetadataRow, scope: 'context' | 'output'): ProbePlan {
  const fact = scope === 'context' ? row.contextTokens : row.maxOutputTokens
  const familyHint = familyRuleLayer(row.actualModelId)?.hint
  const hintTokens = fact.state === 'known'
    ? fact.value
    : scope === 'context'
      ? familyHint?.contextTokens
      : familyHint?.maxOutputTokens
  const hintSource: 'declared' | 'family-rule' | undefined = fact.state === 'known'
    ? 'declared'
    : hintTokens === undefined
      ? undefined
      : 'family-rule'
  return scope === 'context'
    ? planContextProbe({ hintTokens, hintSource })
    : planOutputProbe({ hintTokens, hintSource })
}

function highestAutoMatch(matches: readonly CatalogMatch[]): CatalogMatch | undefined {
  return matches.find((match) => match.confidence === 'exact')
    ?? matches.find((match) => match.confidence === 'alias')
}

/**
 * 一个模型的可执行计划。exact/alias 自动采用；family 只计数、不采用。
 * 已声明字段（人工标记 / 上游声明 / 成本账本）永远不进入 adoptFields。
 */
export function planCatalogBatchItem(
  row: ModelMetadataRow,
  matches: readonly CatalogMatch[],
  adoptions: readonly CatalogAdoption[] = [],
): CatalogBatchPlanItem {
  const auto = highestAutoMatch(matches)
  const adoptedKeys = new Set(
    adoptions.map((item) => catalogAdoptionKey(item.providerId, item.displayName, item.field)),
  )
  const adoptFields: CatalogBatchAdoptionField[] = []
  if (auto) {
    for (const field of CATALOG_BATCH_AUTO_FIELDS) {
      if (rowDeclared(row, field)) continue
      if (!autoAdoptable(auto, field)) continue
      // `reasoning:'no'` 是排除性证据：只写进完全不知道的格子，不覆盖家族规则/旁表给出的 yes。
      if (field === 'reasoning' && auto.entry.reasoning === 'no' && row.reasoning.state === 'known') {
        continue
      }
      // 去重键与 adoption ledger 共用 `catalogAdoptionKey`：断点续跑和预演都按
      // 「provider/model/field」判断，不按 catalogId 判断（换了匹配条目也不重复写）。
      if (adoptedKeys.has(catalogAdoptionKey(row.providerId, row.displayName, field))) continue
      adoptFields.push(field)
    }
  }

  const probeScopes: ProbeScope[] = []
  const probePlans: ProbePlan[] = []
  const adoptedSet = new Set(adoptFields)
  const alreadyAdopted = (field: CatalogBatchAdoptionField): boolean =>
    adoptedKeys.has(catalogAdoptionKey(row.providerId, row.displayName, field))
  if (
    !adoptedSet.has('contextTokens')
    && !alreadyAdopted('contextTokens')
    && shouldProbeFact(row.contextTokens)
  ) {
    probeScopes.push('context')
    probePlans.push(probePlanForRow(row, 'context'))
  }
  if (
    !adoptedSet.has('maxOutputTokens')
    && !alreadyAdopted('maxOutputTokens')
    && shouldProbeFact(row.maxOutputTokens)
  ) {
    probeScopes.push('output')
    probePlans.push(probePlanForRow(row, 'output'))
  }

  return {
    providerId: row.providerId,
    displayName: row.displayName,
    actualModelId: row.actualModelId,
    matchConfidence: auto?.confidence,
    matchCatalogId: auto?.entry.catalogId,
    familyCandidate: auto === undefined && matches.some((match) => match.confidence === 'family' || match.confidence === 'fuzzy'),
    adoptFields,
    probeScopes,
    probePlans,
    probeRequests: probePlans.reduce((sum, plan) => sum + plan.requestCount, 0),
    probeTokens: probePlans.reduce(
      (sum, plan) =>
        sum + plan.estimatedInputTokens + plan.estimatedOutputTokens,
      0,
    ),
  }
}

export function estimateCatalogBatchPlan(
  items: readonly CatalogBatchPlanItem[],
  skippedDisabled = 0,
): CatalogBatchEstimate {
  return {
    models: items.length,
    fields: items.reduce((sum, item) => sum + item.adoptFields.length, 0),
    probeModels: items.filter((item) => item.probeScopes.length > 0).length,
    requests: items.reduce((sum, item) => sum + item.probeRequests, 0),
    tokens: items.reduce((sum, item) => sum + item.probeTokens, 0),
    exactModels: items.filter((item) => item.matchConfidence === 'exact').length,
    aliasModels: items.filter((item) => item.matchConfidence === 'alias').length,
    familyCandidates: items.filter((item) => item.familyCandidate).length,
    skippedDisabled,
  }
}

/** 单模型结果：主进程编排与单测共用这一份判定，避免「有成功就 done」的折叠。 */
export interface CatalogBatchRowOutcome {
  status: 'done' | 'partial' | 'failed' | 'skipped'
  adopted: number
  measuredFields: number
  alias: boolean
  error?: string
  errorKind?: ProbeFailureKind
}

/**
 * 三态判定的唯一入口：
 * - `done`：没有失败（全部成功或声明级跳过，含“没有可做的事”）；
 * - `partial`：既有成功又有失败 —— 必须保留 error/errorKind，进失败清单，参与退避；
 * - `failed`：只有失败；
 * - `skipped`：用户取消中断。
 */
export function classifyCatalogBatchRow(input: {
  adopted: number
  measuredFields: number
  adoptFields: number
  probeScopes: number
  errors: readonly string[]
  errorKind?: ProbeFailureKind
  alias: boolean
  aborted?: boolean
}): CatalogBatchRowOutcome {
  const alias = input.alias
  if (input.aborted === true) {
    return {
      status: 'skipped',
      adopted: input.adopted,
      measuredFields: input.measuredFields,
      alias,
    }
  }
  const hasFailure = input.errors.length > 0
  const hasSuccess = input.adopted > 0 || input.measuredFields > 0
  const hasWork = input.adoptFields > 0 || input.probeScopes > 0
  const error = hasFailure ? input.errors.join('; ') : undefined
  if (hasFailure && hasSuccess) {
    return {
      status: 'partial',
      adopted: input.adopted,
      measuredFields: input.measuredFields,
      alias,
      error,
      ...(input.errorKind ? { errorKind: input.errorKind } : {}),
    }
  }
  if (hasFailure) {
    return {
      status: 'failed',
      adopted: input.adopted,
      measuredFields: input.measuredFields,
      alias,
      error,
      ...(input.errorKind ? { errorKind: input.errorKind } : {}),
    }
  }
  if (hasSuccess || !hasWork) {
    return { status: 'done', adopted: input.adopted, measuredFields: input.measuredFields, alias }
  }
  return { status: 'skipped', adopted: 0, measuredFields: 0, alias: false }
}

/** 429 退避：2s 起，×2 递增，上限 30s；被中断的 sleep 不算完成。 */
export function catalogBatchBackoffDelayMs(
  streak: number,
  baseMs = 2_000,
  maxMs = 30_000,
  factor = 2,
): number {
  return Math.min(baseMs * factor ** Math.max(0, streak), maxMs)
}

/** 失败清单按 (providerId, displayName) 去重：重复 resume / 重跑不会增长同一行。 */
export function mergeCatalogBatchFailure(
  list: readonly CatalogBatchFailure[],
  failure: CatalogBatchFailure,
): CatalogBatchFailure[] {
  return [
    ...list.filter(
      (item) =>
        batchModelKey(item.providerId, item.displayName)
        !== batchModelKey(failure.providerId, failure.displayName),
    ),
    failure,
  ]
}

/** 「已有 active job」的判定；并发 start 用它拒绝第二个任务。 */
export function isCatalogBatchActive(status: CatalogBatchStatus): boolean {
  return status === 'running' || status === 'paused'
}

/** 给失败列表用：同一模型只记一条。 */
export function batchModelKey(providerId: string, displayName: string): string {
  return `${providerId}\u0000${displayName}`
}

/** 已知的探测读数不需要重测；取消后重跑靠这个跳过已完成的 scope。 */
export function factNeedsProbe(fact: Fact<number>): boolean {
  return shouldProbeFact(fact)
}

export { factValue }
