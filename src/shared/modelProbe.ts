/**
 * 探测 sidecar：手动实测结果的落盘格式、阶梯计划与区间判定。
 *
 * sidecar 是衍生数据（`~/.modelport/derived/model-probes.json`），删除只会让
 * `probe` 层缺席；它不参与目录同步，也不会覆盖手工标注。
 *
 * 这一层是纯函数：阶梯怎么选、什么时候算超限、429 为什么不能当上限，
 * 都在这里定死，主进程只负责发请求和落盘（见 `providers/modelProbeRunner.ts`）。
 */
import type { MetadataLayer } from './modelMetadata.ts'

export const MODEL_PROBE_TTL_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000
export const MODEL_PROBE_TTL_MS = MODEL_PROBE_TTL_DAYS * DAY_MS

export type ProbeFreshness = 'fresh' | 'expired'

/** 探测范围：能力/上下文/输出。三者的失败语义不同。 */
export type ProbeScope = 'capability' | 'context' | 'output'

/**
 * 一次探测的结论状态。
 * - `measured`：拿到了可判定区间；
 * - `inconclusive`：429 / 401 / 403 / 5xx / 网络 / 超时——**不写任何上限**；
 * - `suspect`：请求成功但内容明显被裁，不升级为结论；
 * - `deferred`：本地并发已满或额度不足，本次跳过，不算失败。
 */
export type ProbeStatus = 'measured' | 'inconclusive' | 'suspect' | 'deferred'

/** 「≥ 下界、< 上界」。两端都可缺席：全档通过时只有下界，首档即失败时只有上界。 */
export interface ProbeBound {
  atLeast?: number
  below?: number
}

export type ProbeOutcome = 'accepted' | 'rejected' | 'suspect' | 'inconclusive' | 'deferred'

/** 一档的观测结果；`detail` 是给人读的证据，不参与判定。 */
export interface ProbeObservation {
  tier: number
  outcome: ProbeOutcome
  detail?: string
}

/** 一行实测读数。所有能力字段都是「测到才写」，缺席即未知。 */
export interface ModelProbeRow {
  providerId: string
  displayName: string
  actualModelId: string
  /** 探测完成时刻（ISO-8601）。 */
  asOf: string
  tools?: 'yes' | 'no'
  vision?: 'yes' | 'no'
  /**
   * 实测上下文下界。只有 `contextStatus === 'measured'`（或老行没有状态）时才
   * 折成证据；区间两端见 `contextRange`。
   */
  contextTokens?: number
  /** 实测输出下界。口径同 `contextTokens`。 */
  maxOutputTokens?: number
  contextStatus?: ProbeStatus
  contextReason?: string
  contextRange?: ProbeBound
  contextEvidence?: string
  maxOutputStatus?: ProbeStatus
  maxOutputReason?: string
  maxOutputRange?: ProbeBound
  maxOutputEvidence?: string
  /** 首条探测请求的往返耗时，仅作诊断。 */
  latencyMs?: number
  evidence?: string
}

export interface ModelProbeSidecar {
  version: 1
  rows: ModelProbeRow[]
}

export const EMPTY_PROBE_SIDECAR: ModelProbeSidecar = { version: 1, rows: [] }

/** 一条探测请求的硬超时：上游不回包就按 `inconclusive` 收敛，不无限等待。 */
export const PROBE_REQUEST_TIMEOUT_MS = 30_000

/** 单次探测（一次点击/一个模型的一个 scope）的整体上限。 */
export const PROBE_TOTAL_TIMEOUT_MS = 5 * 60 * 1000

/**
 * 失败分类只服务界面文案（网络不可达 / 鉴权失败 / 被限流 / 上游超时），
 * 不参与判定；判定仍走 `classifyProbeFailure`，429/401/403/5xx 一律不构成上限。
 */
export type ProbeFailureKind = 'network' | 'auth' | 'rate-limit' | 'timeout' | 'upstream' | 'unknown'

export function probeFailureKind(input: {
  status?: number
  timedOut?: boolean
  localAdmissionRejected?: boolean
}): ProbeFailureKind {
  if (input.localAdmissionRejected === true) return 'rate-limit'
  if (input.timedOut === true) return 'timeout'
  const status = input.status
  if (status === undefined) return 'network'
  if (status === 401 || status === 403) return 'auth'
  if (status === 408) return 'timeout'
  if (status === 429) return 'rate-limit'
  if (status >= 500) return 'upstream'
  return 'unknown'
}

/** 弹窗可见阶段：准备 → 第 N 档 → 等待响应 → 结束/取消。 */
export type ProbePhase = 'prepare' | 'tier' | 'awaiting' | 'done' | 'cancelled'

export type ProbeJobStatus = 'running' | 'done' | 'failed' | 'cancelled'

/** 主进程 → 界面的一次进度快照；关闭弹窗后可从 `getProbeJobs` 回读。 */
export interface ProbeProgressEvent {
  jobId: string
  providerId: string
  displayName: string
  scope: ProbeScope
  phase: ProbePhase
  /** 1-based 档位序号与总档数；能力探测没有档位时为 undefined。 */
  tierIndex?: number
  tierCount?: number
  tierTokens?: number
  elapsedMs: number
  requestsSent: number
  requestLimit: number
  startedAt: string
  errorKind?: ProbeFailureKind
  message?: string
}

/** 后台任务记录（进行中 + 最近完成），供关闭弹窗后回显。 */
export interface ProbeJobSnapshot extends ProbeProgressEvent {
  status: ProbeJobStatus
  updatedAt: string
  result?: ModelProbeRunResult
}

// ── 阶梯 ────────────────────────────────────────────────────────────────────

/**
 * 上下文档位。探测不是逐 token 二分：从已知安全档向上试，首个失败档的
 * 前一档就是下界，失败档本身是上界。
 */
export const CONTEXT_PROBE_LADDER = [4096, 8192, 16384, 32768, 65536, 98304, 131072, 200000] as const

/** 输出上限档位；按 `max_tokens` 折叠后的字段发请求（见 `utils/outputCap.ts`）。 */
export const OUTPUT_PROBE_LADDER = [1024, 2048, 4096, 8192, 16384, 32768] as const

/** 单次探测的请求条数上限；界面在确认前就把这个数显示给用户。 */
export const PROBE_MAX_REQUESTS = 8

/** 每条探测请求的提示词与输出开销（估算用，不参与判定）。 */
export const PROBE_PROMPT_OVERHEAD_TOKENS = 32

/** 输出探测里「完成 token 数达到请求上限的多少」才算真的被 `max_tokens` 截断。 */
export const OUTPUT_TRUNCATION_RATIO = 0.85

/** 上下文探测提示词的字符/ token 估算比例（英文 filler 的经验值）。 */
export const PROBE_CHARS_PER_TOKEN = 4

export interface ProbePlan {
  scope: ProbeScope
  /** 从小到大；探测按这个顺序推进，命中第一个失败即停。 */
  tiers: number[]
  requestCount: number
  estimatedInputTokens: number
  estimatedOutputTokens: number
  /** 有推定值时只在它附近的档位试；没有就扫全档。 */
  narrowedBy?: 'family-rule' | 'declared'
}

/** 一次手动探测返回给界面的结果（IPC 的 `providers:probeModel`）。 */
export interface ModelProbeRunResult {
  scope: ProbeScope
  /** `skipped` = 已有声明级来源，用户没有强制重测。 */
  status: ProbeStatus | 'skipped'
  plan: ProbePlan
  /** 实际发出的请求条数（可能因失败/暂缓提前停止）。 */
  requests: number
  estimatedInputTokens: number
  estimatedOutputTokens: number
  reason?: string
  row?: ModelProbeRow
}

function clampTierList(tiers: readonly number[], index: number): number[] {
  const next = [
    tiers[index - 1],
    tiers[index],
    tiers[index + 1],
  ].filter((tier): tier is number => typeof tier === 'number')
  return [...new Set(next)].sort((left, right) => left - right)
}

function nearestTierIndex(tiers: readonly number[], hintTokens: number): number {
  let best = 0
  for (let index = 1; index < tiers.length; index++) {
    if (Math.abs((tiers[index] as number) - hintTokens) < Math.abs((tiers[best] as number) - hintTokens)) {
      best = index
    }
  }
  return best
}

function planLadder(
  scope: 'context' | 'output',
  tiers: readonly number[],
  hintTokens: number | undefined,
  narrowedBy: 'family-rule' | 'declared' | undefined,
): ProbePlan {
  const selected = hintTokens === undefined
    ? [...tiers]
    : clampTierList(tiers, nearestTierIndex(tiers, hintTokens))
  const requestCount = Math.min(selected.length, PROBE_MAX_REQUESTS)
  const estimatedInputTokens = selected.reduce(
    (total, tier) => total + (scope === 'context' ? tier : PROBE_PROMPT_OVERHEAD_TOKENS),
    0,
  ) + selected.length * PROBE_PROMPT_OVERHEAD_TOKENS
  const estimatedOutputTokens = selected.reduce(
    (total, tier) => total + (scope === 'output' ? tier : 16),
    0,
  )
  return {
    scope,
    tiers: selected,
    requestCount,
    estimatedInputTokens,
    estimatedOutputTokens,
    ...(hintTokens === undefined || narrowedBy === undefined ? {} : { narrowedBy }),
  }
}

/**
 * 上下文探测计划。给了推定值（家族规则或已有声明）就只试它前后各一档，
 * 把最贵的那几档（64k–200k）从「每次都扫一遍」里拿掉。
 */
export function planContextProbe(input: {
  hintTokens?: number
  hintSource?: 'family-rule' | 'declared'
} = {}): ProbePlan {
  return planLadder('context', CONTEXT_PROBE_LADDER, input.hintTokens, input.hintSource)
}

/** 输出上限探测计划；口径同上。 */
export function planOutputProbe(input: {
  hintTokens?: number
  hintSource?: 'family-rule' | 'declared'
} = {}): ProbePlan {
  return planLadder('output', OUTPUT_PROBE_LADDER, input.hintTokens, input.hintSource)
}

/** 加长提示词：按目标 token 数生成 filler，只用于把输入推到某一档。 */
export function buildContextProbePrompt(targetTokens: number): string {
  const safeTokens = Math.max(1, Math.floor(targetTokens))
  const unit = 'probe '
  const repeat = Math.max(1, Math.ceil((safeTokens * PROBE_CHARS_PER_TOKEN) / unit.length))
  return unit.repeat(repeat).trim()
}

/** 输出探测的提示词：要求持续输出，让 `max_tokens` 成为唯一停下的原因。 */
export function buildOutputProbePrompt(): string {
  return 'Write the word "ok" repeated on a single line until you are stopped. Do not stop on your own.'
}

// ── 失败语义 ────────────────────────────────────────────────────────────────

const CONTEXT_OVERFLOW_KEYWORDS = [
  'context_length_exceeded',
  'context length',
  'context window',
  'maximum context',
  'too many tokens',
  'input is too long',
  'input too long',
  'prompt is too long',
  'prompt too long',
  'reduce the length',
  'token limit',
]

const OUTPUT_CAP_KEYWORDS = [
  'max_tokens',
  'max_completion_tokens',
  'max output',
  'maximum output',
  'output token',
  'too large',
  'exceeds',
  'invalid value',
]

function errorTextOf(input: { errorText?: string }): string {
  return (input.errorText ?? '').toLowerCase()
}

/** 明确的「输入超窗」错误：状态码是 400/413/422 且文案指向上下文长度。 */
export function isContextOverflowError(input: {
  status?: number
  errorText?: string
}): boolean {
  const status = input.status
  if (status !== 400 && status !== 413 && status !== 422) return false
  const text = errorTextOf(input)
  return CONTEXT_OVERFLOW_KEYWORDS.some((keyword) => text.includes(keyword))
}

/** 明确的「输出上限太大」错误：同样是 400/413/422，但文案指向 max_tokens。 */
export function isOutputCapRejection(input: { status?: number; errorText?: string }): boolean {
  const status = input.status
  if (status !== 400 && status !== 413 && status !== 422) return false
  const text = errorTextOf(input)
  return OUTPUT_CAP_KEYWORDS.some((keyword) => text.includes(keyword))
}

/**
 * 这些失败**永远不构成上限证据**：429 是限流，401/403 是凭据，5xx 是上游故障，
 * 超时/网络错误是没有结论。把它们当成「这一档失败」会把一次限流写成 4k 窗口。
 */
export function isInconclusiveProbeFailure(input: {
  status?: number
  localAdmissionRejected?: boolean
  timedOut?: boolean
}): boolean {
  if (input.localAdmissionRejected === true) return true
  if (input.timedOut === true) return true
  const status = input.status
  if (status === undefined) return true
  if (status === 408 || status === 429) return true
  if (status === 401 || status === 403 || status === 404 || status === 409 || status === 425) return true
  return status >= 500
}

/**
 * 把一次失败折成阶梯观测：
 * - 本地准入/额度 → `deferred`（跳过，不算失败）；
 * - 429/401/403/5xx/网络/超时 → `inconclusive`（本次不写任何结论）；
 * - 明确的超限 400 → `rejected`（前一档即结论）；
 * - 其余 400（参数写错等）→ `inconclusive`，绝不猜成上限。
 */
export function classifyProbeFailure(input: {
  scope: 'context' | 'output'
  status?: number
  errorText?: string
  localAdmissionRejected?: boolean
  timedOut?: boolean
}): 'rejected' | 'inconclusive' | 'deferred' {
  if (input.localAdmissionRejected === true) return 'deferred'
  if (isInconclusiveProbeFailure(input)) return 'inconclusive'
  const overflow = input.scope === 'context'
    ? isContextOverflowError(input)
    : isOutputCapRejection(input)
  return overflow ? 'rejected' : 'inconclusive'
}

/** 输出探测的成功读数：只有「被 max_tokens 截断且完成 token 达到档位」才算通过。 */
export function classifyOutputSuccess(input: {
  finishReason?: string | null
  completionTokens?: number | null
  tier: number
}): 'accepted' | 'suspect' {
  const completion = typeof input.completionTokens === 'number' && Number.isFinite(input.completionTokens)
    ? input.completionTokens
    : undefined
  if (completion !== undefined && completion >= input.tier * OUTPUT_TRUNCATION_RATIO) {
    return 'accepted'
  }
  if (input.finishReason === 'length' && completion === undefined) {
    // 上游明确说被上限截断，即使没报 usage 也是一次真实截断。
    return 'accepted'
  }
  // 成功但内容停在上限之前：可能是供应商静默压低了输出，不能升级为结论。
  return 'suspect'
}

// ── 区间判定 ────────────────────────────────────────────────────────────────

export interface ProbeVerdict {
  status: ProbeStatus
  bound?: ProbeBound
  reason?: string
}

function evaluateObservations(observations: readonly ProbeObservation[]): ProbeVerdict {
  const sorted = [...observations].sort((left, right) => left.tier - right.tier)
  const deferred = sorted.find((item) => item.outcome === 'deferred')
  if (deferred) {
    return { status: 'deferred', reason: deferred.detail ?? '本地并发或额度不足，本次暂缓' }
  }
  const inconclusive = sorted.find((item) => item.outcome === 'inconclusive')
  if (inconclusive) {
    return { status: 'inconclusive', reason: inconclusive.detail ?? '上游未给出可判定的失败' }
  }
  const suspect = sorted.find((item) => item.outcome === 'suspect')
  if (suspect) {
    return { status: 'suspect', reason: suspect.detail ?? '成功响应疑似被静默截断' }
  }

  const accepted = sorted.filter((item) => item.outcome === 'accepted')
  const rejected = sorted.find((item) => item.outcome === 'rejected')
  if (rejected) {
    const lower = accepted.filter((item) => item.tier < rejected.tier).pop()
    return {
      status: 'measured',
      bound: {
        ...(lower === undefined ? {} : { atLeast: lower.tier }),
        below: rejected.tier,
      },
      reason: rejected.detail ?? `第 ${rejected.tier} 档被拒绝`,
    }
  }
  if (accepted.length > 0) {
    const highest = accepted[accepted.length - 1] as ProbeObservation
    return {
      status: 'measured',
      bound: { atLeast: highest.tier },
      reason: `最高通过档 ${highest.tier}`,
    }
  }
  return { status: 'inconclusive', reason: '没有取得可判定的观测' }
}

export function evaluateContextProbe(observations: readonly ProbeObservation[]): ProbeVerdict {
  return evaluateObservations(observations)
}

export function evaluateOutputProbe(observations: readonly ProbeObservation[]): ProbeVerdict {
  return evaluateObservations(observations)
}

/** 声明级证据已经存在时默认不探测；`force` 才允许重测对比。 */
export function shouldSkipProbe(
  fact: { state?: string; confidence?: string } | undefined,
  force: boolean,
): boolean {
  return force !== true && fact?.state === 'known' && fact.confidence === 'declared'
}

/** 串行任务队列：同一模型串行、跨模型并发上限 1（全局只有一条链）。 */
export function createSerialTaskQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task)
    tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

// ── 落盘 / TTL ──────────────────────────────────────────────────────────────

export function probeRowKey(row: Pick<ModelProbeRow, 'providerId' | 'displayName'>): string {
  return `${row.providerId}\u0000${row.displayName}`
}

/**
 * 按 `(providerId, displayName)` 建一次索引。
 *
 * 选号路径每决策建一次、逐候选只查表 —— 探测行与手工标记同一套口径：热路径里
 * 逐候选读 sidecar 会把一次选号放大成几百次读表。
 */
export function indexProbeRows(rows: readonly ModelProbeRow[]): Map<string, ModelProbeRow> {
  const index = new Map<string, ModelProbeRow>()
  for (const row of rows) index.set(probeRowKey(row), row)
  return index
}

/** 过期判定：时间不可解析也按过期处理，避免坏数据被当成新鲜证据。 */
export function probeFreshness(asOf: string, nowMs: number = Date.now()): ProbeFreshness {
  const stamp = Date.parse(asOf)
  if (!Number.isFinite(stamp)) return 'expired'
  return nowMs - stamp <= MODEL_PROBE_TTL_MS ? 'fresh' : 'expired'
}

function boundOf(value: unknown): ProbeBound | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const atLeast = typeof raw.atLeast === 'number' && raw.atLeast > 0 ? raw.atLeast : undefined
  const below = typeof raw.below === 'number' && raw.below > 0 ? raw.below : undefined
  if (atLeast === undefined && below === undefined) return undefined
  return { ...(atLeast === undefined ? {} : { atLeast }), ...(below === undefined ? {} : { below }) }
}

function statusOf(value: unknown): ProbeStatus | undefined {
  return value === 'measured' || value === 'inconclusive' || value === 'suspect' || value === 'deferred'
    ? value
    : undefined
}

function rangeText(label: string, bound: ProbeBound | undefined): string | undefined {
  if (!bound) return undefined
  if (bound.atLeast !== undefined && bound.below !== undefined) {
    return `${label} ≥${bound.atLeast} 且 <${bound.below}`
  }
  if (bound.atLeast !== undefined) return `${label} ≥${bound.atLeast}`
  return `${label} <${bound.below}`
}

/**
 * 只有新鲜且 `measured` 的区间才折成证据层；过期行、inconclusive、suspect
 * 都不参与解析（设计文档 §5、§8）。
 */
export function probeRowToLayer(
  row: ModelProbeRow,
  nowMs: number = Date.now(),
): MetadataLayer | undefined {
  if (probeFreshness(row.asOf, nowMs) !== 'fresh') return undefined
  const contextMeasured = row.contextStatus === undefined || row.contextStatus === 'measured'
  const outputMeasured = row.maxOutputStatus === undefined || row.maxOutputStatus === 'measured'
  const hint = {
    ...(row.vision ? { vision: row.vision } : {}),
    ...(row.tools ? { tools: row.tools } : {}),
    ...(row.contextTokens !== undefined && contextMeasured ? { contextTokens: row.contextTokens } : {}),
    ...(row.maxOutputTokens !== undefined && outputMeasured ? { maxOutputTokens: row.maxOutputTokens } : {}),
  }
  if (Object.keys(hint).length === 0) return undefined

  const evidenceParts: string[] = []
  if (row.evidence) evidenceParts.push(row.evidence)
  if (row.contextEvidence) evidenceParts.push(row.contextEvidence)
  if (row.maxOutputEvidence) evidenceParts.push(row.maxOutputEvidence)
  const contextRange = rangeText('上下文', row.contextRange)
  if (contextRange) evidenceParts.push(contextRange)
  const outputRange = rangeText('输出上限', row.maxOutputRange)
  if (outputRange) evidenceParts.push(outputRange)
  if (row.contextStatus === 'suspect' || row.maxOutputStatus === 'suspect') {
    evidenceParts.push('疑似静默截断，未升级为结论')
  }

  return {
    source: 'probe',
    confidence: 'measured',
    asOf: row.asOf,
    evidence: evidenceParts.join('；') || '手动探测',
    hint,
  }
}

/** 同键替换（新读数覆盖旧读数），返回新数组，不修改入参。 */
export function upsertProbeRow(
  rows: readonly ModelProbeRow[],
  row: ModelProbeRow,
): ModelProbeRow[] {
  const key = probeRowKey(row)
  const next = rows.filter((existing) => probeRowKey(existing) !== key)
  next.push(row)
  return next
}

/** 只保留未过期的行，供界面展示与解析使用。 */
export function freshProbeRows(
  rows: readonly ModelProbeRow[],
  nowMs: number = Date.now(),
): ModelProbeRow[] {
  return rows.filter((row) => probeFreshness(row.asOf, nowMs) === 'fresh')
}

/** 宽松校验外部/磁盘数据：坏行丢弃，不抛错。 */
export function sanitizeProbeSidecar(raw: unknown): ModelProbeSidecar {
  if (!raw || typeof raw !== 'object') return EMPTY_PROBE_SIDECAR
  const rows = (raw as { rows?: unknown }).rows
  if (!Array.isArray(rows)) return EMPTY_PROBE_SIDECAR
  const valid: ModelProbeRow[] = []
  for (const candidate of rows) {
    if (!candidate || typeof candidate !== 'object') continue
    const row = candidate as Record<string, unknown>
    if (
      typeof row.providerId !== 'string' ||
      typeof row.displayName !== 'string' ||
      typeof row.actualModelId !== 'string' ||
      typeof row.asOf !== 'string'
    ) {
      continue
    }
    const contextStatus = statusOf(row.contextStatus)
    const maxOutputStatus = statusOf(row.maxOutputStatus)
    const contextMeasured = contextStatus === undefined || contextStatus === 'measured'
    const outputMeasured = maxOutputStatus === undefined || maxOutputStatus === 'measured'
    valid.push({
      providerId: row.providerId,
      displayName: row.displayName,
      actualModelId: row.actualModelId,
      asOf: row.asOf,
      ...(row.tools === 'yes' || row.tools === 'no' ? { tools: row.tools } : {}),
      ...(row.vision === 'yes' || row.vision === 'no' ? { vision: row.vision } : {}),
      ...(typeof row.contextTokens === 'number' && row.contextTokens > 0 && contextMeasured
        ? { contextTokens: row.contextTokens }
        : {}),
      ...(typeof row.maxOutputTokens === 'number' && row.maxOutputTokens > 0 && outputMeasured
        ? { maxOutputTokens: row.maxOutputTokens }
        : {}),
      ...(contextStatus === undefined ? {} : { contextStatus }),
      ...(typeof row.contextReason === 'string' ? { contextReason: row.contextReason } : {}),
      ...(boundOf(row.contextRange) ? { contextRange: boundOf(row.contextRange) } : {}),
      ...(typeof row.contextEvidence === 'string' ? { contextEvidence: row.contextEvidence } : {}),
      ...(maxOutputStatus === undefined ? {} : { maxOutputStatus }),
      ...(typeof row.maxOutputReason === 'string' ? { maxOutputReason: row.maxOutputReason } : {}),
      ...(boundOf(row.maxOutputRange) ? { maxOutputRange: boundOf(row.maxOutputRange) } : {}),
      ...(typeof row.maxOutputEvidence === 'string' ? { maxOutputEvidence: row.maxOutputEvidence } : {}),
      ...(typeof row.latencyMs === 'number' && row.latencyMs >= 0
        ? { latencyMs: row.latencyMs }
        : {}),
      ...(typeof row.evidence === 'string' ? { evidence: row.evidence } : {}),
    })
  }
  return { version: 1, rows: valid }
}
