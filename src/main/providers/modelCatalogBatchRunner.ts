/**
 * 「全部补齐」的主进程编排器。
 *
 * 任务完全由主进程持有：渲染层只订阅进度，关窗/切页不影响执行。
 * 跨模型并发固定为 1；内部按 `CATALOG_BATCH_SIZE` 分批推进，但对用户不可见。
 *
 * 单模型结果是三态：`done`（全部成功或声明级跳过）、`partial`（有成功有失败）、
 * `failed`（全失败）。`partial` 同样进入失败清单并触发退避 —— 只要还有失败，
 * 就不能因为「另一个 scope 成功了」而被折叠成 `done`。
 */
import { randomUUID } from 'node:crypto'
import {
  batchModelKey,
  catalogBatchBackoffDelayMs,
  classifyCatalogBatchRow,
  estimateCatalogBatchPlan,
  isCatalogBatchActive,
  mergeCatalogBatchFailure,
  planCatalogBatchItem,
  type CatalogBatchEstimate,
  type CatalogBatchFailure,
  type CatalogBatchPlanItem,
  type CatalogBatchRowOutcome,
  type CatalogBatchSnapshot,
  type CatalogBatchStartInput,
  type CatalogBatchStartResult,
} from '../../shared/modelCatalogBatch.ts'
import type { ModelMetadataRow } from '../../shared/modelMetadata.ts'
import { catalogAdoptionKey } from '../../shared/modelCatalog.ts'
import { storeManager } from '../store/store.ts'
import { enabledModelRoutes, resolvePoolRoute } from '../store/modelRoutes.ts'
import { getCatalogCandidates, adoptCatalogField } from './modelCatalogService.ts'
import { getModelMetadataReport } from './modelMetadataService.ts'
import { runModelCapabilityProbe } from './modelProbeRunner.ts'
import { getProbeRowsSync } from './modelProbeStore.ts'
import { indexProbeRows, probeRowKey, probeTerminalOf } from '../../shared/modelProbe.ts'
import type { ProbeFailureKind } from '../../shared/modelProbe.ts'
import {
  classifyProbeModality,
  decideProbeGate,
  type ProbeGateDecision,
  type ProbeModalityFacts,
  type ProbeTerminalVerdict,
} from '../../shared/probeDisposition.ts'

/** 内部节奏：每 10 个模型为一个隐式批次，跑完自动继续，界面不展示。 */
export const CATALOG_BATCH_SIZE = 10
/** 429/限流退避：2s 起，×2 递增，上限 30s。 */
export const CATALOG_BATCH_BACKOFF_BASE_MS = 2_000
export const CATALOG_BATCH_BACKOFF_MAX_MS = 30_000
export const CATALOG_BATCH_BACKOFF_FACTOR = 2

interface BatchJobRecord {
  snapshot: CatalogBatchSnapshot
  abort: AbortController
  paused: boolean
  waiters: Set<() => void>
  targets: ModelMetadataRow[]
  probe: boolean
  rateLimitStreak: number
}

type Listener = (snapshot: CatalogBatchSnapshot) => void

const listeners = new Set<Listener>()
const jobs = new Map<string, BatchJobRecord>()
const MAX_JOBS = 20

export function onCatalogBatchProgress(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function broadcast(snapshot: CatalogBatchSnapshot): void {
  for (const listener of listeners) {
    try {
      listener(snapshot)
    } catch {
      // 某个窗口的推送失败不能中断批量任务。
    }
  }
}

function trimJobs(): void {
  const sorted = [...jobs.values()].sort(
    (left, right) =>
      new Date(right.snapshot.updatedAt).getTime() - new Date(left.snapshot.updatedAt).getTime(),
  )
  for (const record of sorted.slice(MAX_JOBS)) {
    if (record.snapshot.status === 'running' || record.snapshot.status === 'paused') continue
    jobs.delete(record.snapshot.jobId)
  }
}

function patch(
  record: BatchJobRecord,
  changes: Partial<CatalogBatchSnapshot>,
): CatalogBatchSnapshot {
  const now = Date.now()
  const started = new Date(record.snapshot.startedAt).getTime()
  const processed = changes.processedModels ?? record.snapshot.processedModels
  const remaining = record.snapshot.totalModels - processed
  const elapsedMs = Math.max(0, now - started)
  let estimatedRemainingMs: number | undefined
  if (processed > 0 && remaining > 0) {
    estimatedRemainingMs = Math.round((elapsedMs / processed) * remaining)
  } else if (remaining === 0) {
    estimatedRemainingMs = 0
  }
  const next: CatalogBatchSnapshot = {
    ...record.snapshot,
    ...changes,
    elapsedMs,
    estimatedRemainingMs,
    updatedAt: new Date().toISOString(),
  }
  record.snapshot = next
  broadcast(next)
  return next
}

async function waitWhilePaused(record: BatchJobRecord): Promise<void> {
  if (!record.paused) return
  await new Promise<void>((resolve) => {
    const done = (): void => {
      record.waiters.delete(done)
      resolve()
    }
    record.waiters.add(done)
  })
}

function resumeWaiters(record: BatchJobRecord): void {
  const waiters = [...record.waiters]
  record.waiters.clear()
  for (const resolve of waiters) resolve()
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function abortReason(signal: AbortSignal): string | undefined {
  const reason = signal.reason
  return reason === 'timeout' || reason === 'cancel' ? reason : undefined
}

/** 路由引用判定与 `autoRouting::applyModelNamePin` / `applyManualModelSelection` 同一键。 */
function routeRefKey(providerId: string, displayName: string): string {
  return `${providerId.trim().toLowerCase()}\u0000${displayName.trim().toLowerCase()}`
}

interface FilteredTargets {
  targets: ModelMetadataRow[]
  /** 停用或未被任何路由引用、未进入计划的模型数。 */
  skippedDisabled: number
}
/**
 * 「被至少一条路由引用」沿用项目既有候选池口径：路由可路由（`resolvePoolRoute` 成功），
 * 且没有被 `pinModels` 之外 / `excludeModels` 排除。`includeModels` 只能从基底里取回，
 * 因此不额外放行。
 */
function filterBatchTargets(
  rows: readonly ModelMetadataRow[],
  providerId?: string,
): FilteredTargets {
  const configRoutes = storeManager.getConfig().routes
  const routes = enabledModelRoutes(configRoutes)
  const enabledByProvider = new Map<string, Set<string>>()
  const enabledNames = (providerId: string): Set<string> => {
    const cached = enabledByProvider.get(providerId)
    if (cached) return cached
    const names = new Set(storeManager.getEffectiveModels(providerId).map((model) => model.displayName))
    enabledByProvider.set(providerId, names)
    return names
  }
  const referenced = (providerId: string, displayName: string): boolean => {
    if (routes.length === 0) return false
    const key = routeRefKey(providerId, displayName)
    for (const route of routes) {
      const resolved = resolvePoolRoute(configRoutes, route)
      if (!resolved.ok) continue
      const pins = resolved.route.pinModels ?? []
      if (pins.length > 0 && !pins.some((ref) => routeRefKey(ref.providerId, ref.displayName) === key)) {
        continue
      }
      if (
        (resolved.route.excludeModels ?? []).some(
          (ref) => routeRefKey(ref.providerId, ref.displayName) === key,
        )
      ) {
        continue
      }
      return true
    }
    return false
  }

  const targets: ModelMetadataRow[] = []
  let skippedDisabled = 0
  for (const row of rows) {
    // 范围收口在两道闸门之前：`skippedDisabled` 说的是「本范围内被跳过的」，
    // 混进别家的行数会让确认弹窗里的数字对不上用户点的那一家。
    if (providerId !== undefined && row.providerId !== providerId) continue
    if (!enabledNames(row.providerId).has(row.displayName)) {
      skippedDisabled += 1
      continue
    }
    if (!referenced(row.providerId, row.displayName)) {
      skippedDisabled += 1
      continue
    }
    targets.push(row)
  }
  return { targets, skippedDisabled }
}

/**
 * 探测闸门的规划侧快照。
 *
 * 每行现建一次而不是任务开始时建一次：账号级终局是在这一轮的头一个模型上
 * 换来的，同一 provider 后面那十四个要在**本轮**就吃到它，否则今天 ModelScope
 * 那种「一家 15 个模型 ×2 次全 403」还是会每轮重来一遍。
 * 读的是 `getProbeRowsSync()` 的进程内快照，不在热路径上做 I/O。
 */
interface ProbeGateSnapshot {
  nowMs: number
  providerEnabledById: Map<string, boolean>
  terminalByKey: Map<string, ProbeTerminalVerdict>
  accountTerminalByProvider: Map<string, ProbeTerminalVerdict>
}

function buildProbeGateSnapshot(nowMs: number = Date.now()): ProbeGateSnapshot {
  const providerEnabledById = new Map<string, boolean>()
  for (const provider of storeManager.getProviders()) {
    providerEnabledById.set(provider.id, provider.enabled !== false)
  }
  const terminalByKey = new Map<string, ProbeTerminalVerdict>()
  const accountTerminalByProvider = new Map<string, ProbeTerminalVerdict>()
  for (const row of getProbeRowsSync()) {
    const terminal = probeTerminalOf(row, nowMs)
    if (terminal === undefined) continue
    terminalByKey.set(probeRowKey(row), terminal)
    if (terminal.scope !== 'account') continue
    const held = accountTerminalByProvider.get(row.providerId)
    if (held === undefined || Date.parse(terminal.asOf) > Date.parse(held.asOf)) {
      accountTerminalByProvider.set(row.providerId, terminal)
    }
  }
  return { nowMs, providerEnabledById, terminalByKey, accountTerminalByProvider }
}

/** 只有 `declared` 置信度的模态声明才有资格阻断（缺席即未知，未知就放行）。 */
function rowModalityFacts(row: ModelMetadataRow): ProbeModalityFacts {
  const fact = row.modalities
  if (fact?.state !== 'known' || fact.confidence !== 'declared') return {}
  return { inputModalities: fact.value }
}

function gateDecisionFor(row: ModelMetadataRow, snapshot: ProbeGateSnapshot): ProbeGateDecision {
  const terminal = snapshot.terminalByKey.get(probeRowKey(row))
  const accountTerminal = snapshot.accountTerminalByProvider.get(row.providerId)
  return decideProbeGate({
    providerEnabled: snapshot.providerEnabledById.get(row.providerId),
    modality: classifyProbeModality(rowModalityFacts(row)),
    ...(terminal === undefined ? {} : { terminal }),
    ...(accountTerminal === undefined ? {} : { accountTerminal }),
  })
}

/**
 * 把闸门落到计划项上：被拦下的条目保留匹配与采用（那是离线工作，不花上游请求），
 * 只把探测 scope 摘干净并重算成本 —— 预演显示的条数因此永远等于真正会发的条数。
 */
function applyProbeGate(
  item: CatalogBatchPlanItem,
  row: ModelMetadataRow,
  snapshot: ProbeGateSnapshot,
): CatalogBatchPlanItem {
  if (item.probeScopes.length === 0) return item
  if (gateDecisionFor(row, snapshot).probe) return item
  return {
    ...item,
    probeScopes: [],
    probePlans: [],
    probeRequests: 0,
    probeTokens: 0,
  }
}

async function processRow(
  record: BatchJobRecord,
  row: ModelMetadataRow,
): Promise<CatalogBatchRowOutcome> {
  patch(record, {
    phase: 'matching',
    currentModel: row.displayName,
    currentProviderId: row.providerId,
    currentStatus: 'matching',
    lastError: undefined,
  })

  const candidates = await getCatalogCandidates({
    providerId: row.providerId,
    displayName: row.displayName,
    actualModelId: row.actualModelId,
  })
  const plan = applyProbeGate(
    planCatalogBatchItem(row, candidates.matches, candidates.adoptions),
    row,
    buildProbeGateSnapshot(),
  )
  if (record.abort.signal.aborted) {
    return { status: 'skipped', adopted: 0, measuredFields: 0, alias: false }
  }
  if (plan.familyCandidate) {
    patch(record, { familyCandidates: record.snapshot.familyCandidates + 1 })
  }

  let adopted = 0
  const adoptionErrors: string[] = []
  const adoptedKeys = new Set(
    candidates.adoptions.map((item) =>
      catalogAdoptionKey(item.providerId, item.displayName, item.field),
    ),
  )
  for (const field of plan.adoptFields) {
    if (record.abort.signal.aborted) break
    if (!plan.matchCatalogId) break
    const key = catalogAdoptionKey(row.providerId, row.displayName, field)
    if (adoptedKeys.has(key)) continue
    const result = await adoptCatalogField({
      providerId: row.providerId,
      displayName: row.displayName,
      catalogId: plan.matchCatalogId,
      field,
    })
    if (result.success) {
      adopted += 1
      adoptedKeys.add(key)
    } else {
      // 采用失败必须可见：静默跳过会让「全部补齐」看起来成功而实际没写。
      adoptionErrors.push(`${field}: ${result.error ?? '采用失败'}`)
    }
  }
  if (adopted > 0) {
    patch(record, { adoptedFields: record.snapshot.adoptedFields + adopted })
  }

  let measuredFields = 0
  const probeErrors: string[] = []
  let probeErrorKind: ProbeFailureKind | undefined
  let requestsBase = record.snapshot.requestsSent

  if (record.probe && !record.abort.signal.aborted) {
    for (const scope of plan.probeScopes) {
      await waitWhilePaused(record)
      if (record.abort.signal.aborted) break
      patch(record, {
        phase: 'probing',
        currentStatus: 'probing',
      })
      try {
        const result = await runModelCapabilityProbe({
          providerId: row.providerId,
          displayName: row.displayName,
          scope,
          force: false,
          // 批量是唯一会吃终局缓存的发起方；单模型点击永远重问并作废缓存。
          origin: 'batch',
          run: {
            jobId: `${record.snapshot.jobId}:${scope}`,
            signal: record.abort.signal,
            onProgress: (event) => {
              patch(record, {
                phase: 'probing',
                currentStatus: 'probing',
                currentModel: row.displayName,
                currentProviderId: row.providerId,
                requestsSent: Math.max(
                  record.snapshot.requestsSent,
                  requestsBase + event.requestsSent,
                ),
                requestLimit: Math.max(
                  record.snapshot.requestLimit,
                  requestsBase + event.requestsSent,
                ),
              })
            },
          },
        })
        if (result.status === 'measured') {
          measuredFields += 1
        } else if (result.status !== 'skipped') {
          probeErrors.push(`${scope}: ${result.reason ?? result.status}`)
          if (result.errorKind !== undefined) probeErrorKind = result.errorKind
        }
      } catch (cause) {
        if (record.abort.signal.aborted) break
        probeErrors.push(
          `${scope}: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
      }
      requestsBase = record.snapshot.requestsSent
    }
  }

  return classifyCatalogBatchRow({
    adopted,
    measuredFields,
    adoptFields: plan.adoptFields.length,
    probeScopes: plan.probeScopes.length,
    errors: [...adoptionErrors, ...probeErrors],
    errorKind: probeErrorKind,
    alias: plan.matchConfidence === 'alias',
    aborted: record.abort.signal.aborted,
  })
}

async function runJob(record: BatchJobRecord): Promise<void> {
  try {
    const batchTotal = Math.ceil(record.targets.length / CATALOG_BATCH_SIZE)
    patch(record, { phase: 'prepare', batchTotal })
    for (let offset = 0; offset < record.targets.length; offset += CATALOG_BATCH_SIZE) {
      await waitWhilePaused(record)
      if (record.abort.signal.aborted) break
      const batchIndex = Math.floor(offset / CATALOG_BATCH_SIZE) + 1
      patch(record, { phase: 'matching', batchIndex })
      const chunk = record.targets.slice(offset, offset + CATALOG_BATCH_SIZE)
      for (const row of chunk) {
        await waitWhilePaused(record)
        if (record.abort.signal.aborted) break
        let outcome: CatalogBatchRowOutcome
        try {
          outcome = await processRow(record, row)
        } catch (cause) {
          outcome = {
            status: 'failed',
            adopted: 0,
            measuredFields: 0,
            alias: false,
            error: cause instanceof Error ? cause.message : String(cause),
          }
        }
        if (record.abort.signal.aborted) break
        const isFailure = outcome.status === 'failed' || outcome.status === 'partial'
        const failedModels = isFailure
          ? mergeCatalogBatchFailure(record.snapshot.failedModels, {
              providerId: row.providerId,
              displayName: row.displayName,
              error: outcome.error,
            })
          : record.snapshot.failedModels
        patch(record, {
          processedModels: record.snapshot.processedModels + 1,
          success: record.snapshot.success + (outcome.status === 'done' ? 1 : 0),
          skipped: record.snapshot.skipped + (outcome.status === 'skipped' ? 1 : 0),
          failed: record.snapshot.failed + (isFailure ? 1 : 0),
          partial: record.snapshot.partial + (outcome.status === 'partial' ? 1 : 0),
          measuredFields: record.snapshot.measuredFields + outcome.measuredFields,
          failedModels,
          exactAdoptedModels: record.snapshot.exactAdoptedModels
            + (outcome.status !== 'skipped' && !outcome.alias && outcome.adopted > 0 ? 1 : 0),
          aliasAdoptedModels: outcome.alias && outcome.adopted > 0
            ? [...record.snapshot.aliasAdoptedModels, row.displayName]
            : record.snapshot.aliasAdoptedModels,
          currentStatus: outcome.status,
          lastError: outcome.error,
        })

        if (outcome.errorKind === 'rate-limit') {
          const delay = catalogBatchBackoffDelayMs(
            record.rateLimitStreak,
            CATALOG_BATCH_BACKOFF_BASE_MS,
            CATALOG_BATCH_BACKOFF_MAX_MS,
            CATALOG_BATCH_BACKOFF_FACTOR,
          )
          record.rateLimitStreak += 1
          patch(record, {
            phase: 'backoff',
            backoffUntil: new Date(Date.now() + delay).toISOString(),
            lastError: outcome.error ?? 'rate limit',
          })
          await abortableSleep(delay, record.abort.signal)
          patch(record, { phase: 'matching', backoffUntil: undefined })
        } else {
          record.rateLimitStreak = 0
        }
      }
      // 隐式批次边界：仅刷新计时与阶段，不要求用户确认。
      patch(record, { phase: 'matching' })
    }

    const cancelled = abortReason(record.abort.signal)
    patch(record, {
      status: cancelled === 'cancel' ? 'cancelled' : 'done',
      phase: 'done',
      currentModel: undefined,
      currentProviderId: undefined,
      currentStatus: undefined,
      estimatedRemainingMs: 0,
      backoffUntil: undefined,
      ...(cancelled === 'timeout' ? { lastError: '批量任务超时' } : {}),
    })
  } catch (cause) {
    patch(record, {
      status: 'failed',
      phase: 'done',
      estimatedRemainingMs: 0,
      lastError: cause instanceof Error ? cause.message : String(cause),
    })
  } finally {
    trimJobs()
  }
}

/**
 * 预演：只读本地快照与当前标注，不联网。
 * 只有用户打开「同时执行探测」时才调用。已有 adoption 在计划阶段就扣除，
 * 因此预演字段数与实际执行会跳过的字段一致。
 *
 * `providerId` 给定时范围收到这一家（渠道页 / 聚合条目页的批量入口），
 * 报表也只算这一家。
 */
export async function estimateCatalogBatch(providerId?: string): Promise<CatalogBatchEstimate> {
  const report = await getModelMetadataReport(Date.now(), providerId)
  const filtered = filterBatchTargets(report.queue, providerId)
  // 预演与执行读同一道闸门（`applyProbeGate`），差别只是预演期间不会有人写终局。
  const snapshot = buildProbeGateSnapshot()
  const items = []
  for (const row of filtered.targets) {
    const candidates = await getCatalogCandidates({
      providerId: row.providerId,
      displayName: row.displayName,
      actualModelId: row.actualModelId,
    })
    items.push(applyProbeGate(planCatalogBatchItem(row, candidates.matches, candidates.adoptions), row, snapshot))
  }
  return estimateCatalogBatchPlan(items, filtered.skippedDisabled)
}

function activeJob(): BatchJobRecord | undefined {
  return [...jobs.values()].find((record) =>
    isCatalogBatchActive(record.snapshot.status),
  )
}

export async function startCatalogBatch(
  input: CatalogBatchStartInput,
): Promise<CatalogBatchStartResult> {
  // 只允许一个 active job：两个任务共享同一条全局串行探测队列，
  // 并发开始会让「暂停/取消/进度」指向不同对象。
  const running = activeJob()
  if (running) {
    return {
      success: false,
      jobId: running.snapshot.jobId,
      snapshot: running.snapshot,
      error: '已有批量任务在进行，请先查看进度或取消后再开始',
    }
  }

  const report = await getModelMetadataReport(Date.now(), input.providerId)
  const filtered = filterBatchTargets(report.queue, input.providerId)
  let targets = filtered.targets
  let skippedDisabled = filtered.skippedDisabled
  if (input.retryFailedOf) {
    const prior = jobs.get(input.retryFailedOf)
    if (!prior) return { success: false, error: '失败任务不在内存中，请重新执行全部补齐' }
    const failedKeys = new Set(
      prior.snapshot.failedModels.map((item) => batchModelKey(item.providerId, item.displayName)),
    )
    if (failedKeys.size === 0) return { success: false, error: '没有可重试的失败项' }
    targets = targets.filter((row) => failedKeys.has(batchModelKey(row.providerId, row.displayName)))
    skippedDisabled = 0
  }
  if (targets.length === 0) {
    return {
      success: false,
      error: input.retryFailedOf
        ? '失败模型已不在待标注队列'
        : input.providerId
          // 范围版要说清「为什么这一家没有活可干」，否则用户只看到一个失败、没有原因。
          ? '该供应商没有待补齐的模型（已停用或未被任何启用路由引用的模型不进入计划）'
          : '没有待补齐的模型',
    }
  }

  const now = new Date().toISOString()
  // 估算必须带同一个范围：否则确认弹窗按本家算的请求数、执行按全库的预算扣。
  const estimate = input.probe ? await estimateCatalogBatch(input.providerId) : undefined
  const snapshot: CatalogBatchSnapshot = {
    jobId: randomUUID(),
    status: 'running',
    phase: 'prepare',
    startedAt: now,
    updatedAt: now,
    totalModels: targets.length,
    processedModels: 0,
    elapsedMs: 0,
    success: 0,
    skipped: 0,
    failed: 0,
    partial: 0,
    adoptedFields: 0,
    measuredFields: 0,
    exactAdoptedModels: 0,
    aliasAdoptedModels: [],
    familyCandidates: 0,
    failedModels: [],
    skippedDisabled,
    probeEnabled: input.probe,
    ...(input.providerId === undefined ? {} : { providerScope: input.providerId }),
    batchIndex: 0,
    batchTotal: Math.ceil(targets.length / CATALOG_BATCH_SIZE),
    requestsSent: 0,
    requestLimit: estimate?.requests ?? 0,
  }
  const record: BatchJobRecord = {
    snapshot,
    abort: new AbortController(),
    paused: false,
    waiters: new Set(),
    targets,
    probe: input.probe,
    rateLimitStreak: 0,
  }
  jobs.set(snapshot.jobId, record)
  broadcast(snapshot)
  void runJob(record)
  return { success: true, jobId: snapshot.jobId, snapshot }
}

export function pauseCatalogBatch(jobId: string): boolean {
  const record = jobs.get(jobId)
  if (!record || record.snapshot.status !== 'running') return false
  record.paused = true
  patch(record, { status: 'paused' })
  return true
}

export function resumeCatalogBatch(jobId: string): boolean {
  const record = jobs.get(jobId)
  if (!record || record.snapshot.status !== 'paused') return false
  record.paused = false
  patch(record, { status: 'running' })
  resumeWaiters(record)
  return true
}

export function cancelCatalogBatch(jobId: string): boolean {
  const record = jobs.get(jobId)
  if (!record) return false
  if (record.snapshot.status === 'done' || record.snapshot.status === 'cancelled' || record.snapshot.status === 'failed') {
    return false
  }
  record.paused = false
  record.abort.abort('cancel')
  resumeWaiters(record)
  return true
}

export function getCatalogBatchJobs(): CatalogBatchSnapshot[] {
  return [...jobs.values()]
    .map((record) => record.snapshot)
    .sort((left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    )
}

/** 应用退出前调用：干净取消所有在跑任务，避免留下半写状态。 */
export function shutdownCatalogBatchJobs(): void {
  for (const record of jobs.values()) {
    if (record.snapshot.status !== 'running' && record.snapshot.status !== 'paused') continue
    record.paused = false
    record.abort.abort('cancel')
    resumeWaiters(record)
  }
}

export type { CatalogBatchFailure }
