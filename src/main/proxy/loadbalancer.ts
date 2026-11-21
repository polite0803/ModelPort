/**
 * Proxy Service Module - Load Balancer
 * Round Robin / Fill First / Failover, plus Smart and Pace over the quota ledger.
 */

import { Account, Provider, LoadBalanceStrategy } from '../store/types'
import { AccountSelection } from './types'
import { storeManager } from '../store/store'
import { isMappingActive, isModelRoutable } from '../store/modelServing'
import { AGGREGATE_REGISTRY } from '../providers/aggregate/registry'
import { resolveAggregateChain } from '../../shared/aggregateRouting'
import {
  aggregateHeadroom,
  createQuotaGateContext,
  declaredQuotaOf,
  declaredResetAt,
  quotaBlockReason,
  type QuotaGateContext,
} from './quota/gate'
import { resolveCaps } from './quota/limits'
import type { QuotaLedger } from './quota/ledger'
import { declaredUsageOf, type DeclaredQuotaWindow } from '../../shared/declaredQuota'
import type { DeclaredQuotaFact } from '../../shared/quotaPacing'
import { dailyUsageOf } from '../../shared/dailyUsage.ts'
import { pickBestPace, pickSoonestReset, type AccountQuotaFacts } from '../../shared/quotaPacing'
import { debugLog } from '../logging/debugLog'
import type { TransientSkip } from './autoRouter'

/**
 * Load Balancer
 */
export class LoadBalancer {
  private roundRobinIndex: Map<string, number> = new Map()
  private failedAccounts: Map<string, { count: number; lastFailTime: number }> = new Map()
  private static readonly FAIL_THRESHOLD = 3
  private static readonly RECOVERY_TIME = 60000 // 1 minute

  /**
   * Mark account as failed
   */
  markAccountFailed(accountId: string): void {
    const current = this.failedAccounts.get(accountId) || { count: 0, lastFailTime: 0 }
    this.failedAccounts.set(accountId, {
      count: current.count + 1,
      lastFailTime: Date.now(),
    })
  }

  /**
   * Clear account failure status
   */
  clearAccountFailure(accountId: string): void {
    this.failedAccounts.delete(accountId)
  }

  /**
   * Check if account is in failure state
   */
  private isAccountInFailure(accountId: string): boolean {
    const failure = this.failedAccounts.get(accountId)
    if (!failure) return false

    if (Date.now() - failure.lastFailTime > LoadBalancer.RECOVERY_TIME) {
      this.failedAccounts.delete(accountId)
      return false
    }

    return failure.count >= LoadBalancer.FAIL_THRESHOLD
  }

  /**
   * Select account
   * @param model Requested model
   * @param strategy Load balance strategy
   * @param preferredProviderId Preferred provider ID
   * @param preferredAccountId Preferred account ID
   * @param affinityAccountId 会话亲和的账号（具名车道的缓存域粘性）。与
   *   `preferredAccountId` 分开：后者是用户点名，语义上还要压掉跨家链；前者只是
   *   「上一轮跑通的这一家」，不可用就照常走策略，链路不受影响。
   */
  selectAccount(
    model: string,
    strategy: LoadBalanceStrategy = 'round-robin',
    preferredProviderId?: string,
    preferredAccountId?: string,
    affinityAccountId?: string
  ): AccountSelection | null {
    const candidates = this.getAvailableAccounts(model, preferredProviderId, strategy === 'failover')

    if (candidates.length === 0) {
      return null
    }

    if (preferredAccountId) {
      const preferred = candidates.find(c => c.account.id === preferredAccountId)
      if (preferred && !this.isAccountInFailure(preferredAccountId)) {
        return preferred
      }
    }

    // 会话亲和排在策略之前、用户点名之后：缓存域跟着账号走，换号就是全冷一次。
    // `getAvailableAccounts` 只在 failover 策略下剔除失败账号，其余策略仍会把它
    // 放进候选 —— 所以这里必须自己判一次，否则亲和会把一个刚失败的号硬塞回来。
    if (affinityAccountId) {
      const familiar = candidates.find(c => c.account.id === affinityAccountId)
      if (familiar && !this.isAccountInFailure(affinityAccountId)) {
        return familiar
      }
    }

    if (strategy === 'fill-first') {
      return this.selectFillFirst(candidates)
    }

    if (strategy === 'failover') {
      return this.selectFailover(candidates)
    }

    if (strategy === 'smart' || strategy === 'pace') {
      const chosen = this.selectByQuotaPacing(candidates, strategy)
      // 算不出重置时刻（没有上限 / 账本不可用）= 没有意见，退回既有顺序，
      // 绝不因为"算不出来"把候选整体判死。
      if (chosen) return chosen
      return this.selectFillFirst(candidates)
    }

    return this.selectRoundRobin(candidates)
  }

  /**
   * `smart` / `pace` 的实际选号：把每个候选的用量与上限摊成 `AccountQuotaFacts`
   * 交给纯函数排序，再按选出的 accountId 回到候选对象。
   *
   * 两种证据来源，**并列不换算**：
   * - 官方帽 + 实测帽（`resolveCaps`）：只对聚合目录的家成立，别家没有额度旁表；
   * - 用户声明（`account.declaredQuota`）：跟着账号走，任何类型都适用。
   *
   * 一条证据都没有的候选不参与（返回 `undefined` → 调用方退回 fill-first），而不是
   * 凭空给一个 0.5 的中性分。声明之所以必须进来：20 个订阅套餐条目全是
   * `undocumented`，届时这两条策略在用户最关心的那几家上只能退回 fill-first。
   */
  private selectByQuotaPacing(
    candidates: AccountSelection[],
    strategy: 'smart' | 'pace'
  ): AccountSelection | null {
    const facts: AccountQuotaFacts[] = []
    const byAccountId = new Map<string, AccountSelection>()
    const nowMs = Date.now()
    const gateContext = createQuotaGateContext()

    for (const candidate of candidates) {
      try {
        const ledger = storeManager.getQuotaLedger()
        const used: AccountQuotaFacts['used'] = {}
        const limit: AccountQuotaFacts['limit'] = {}

        if (candidate.provider.type === 'aggregate') {
          const entry = AGGREGATE_REGISTRY.find(row => row.id === candidate.provider.id)
          if (entry !== undefined) {
            const caps = resolveCaps(entry.id, candidate.actualModel, ledger.learnedFor(entry.id))
            if (caps.enforceable) {
              const snapshot = ledger.snapshot(entry.id, candidate.account.id, candidate.actualModel)
              for (const [metric, value] of Object.entries(caps.limits)) {
                if (typeof value !== 'number' || value <= 0) continue
                const key = metric as keyof typeof used
                limit[key] = value
                used[key] = snapshot[key] ?? 0
              }
            }
          }
        }

        const declared = declaredFactsOf(ledger, candidate, gateContext, nowMs)
        // 两套证据都为空的候选没有意见可给，不参与排序。
        if (Object.keys(limit).length === 0 && declared.length === 0) continue

        facts.push({
          accountId: candidate.account.id,
          used,
          limit,
          ...(declared.length === 0 ? {} : { declared }),
        })
        byAccountId.set(candidate.account.id, candidate)
      } catch (error) {
        console.error('[LoadBalancer] quota pacing skipped for', candidate.account.id, error)
      }
    }

    if (facts.length === 0) return null

    const winnerId =
      strategy === 'smart' ? pickSoonestReset(facts, nowMs) : pickBestPace(facts, nowMs)
    return winnerId ? (byAccountId.get(winnerId) ?? null) : null
  }

  /**
   * 裸名的跨家候选，按额度余量排好的链序返回（已排除失败账号与额度打满的账号）。
   * 链长不足 2 或名字带 `<entry>/` 前缀时返回空数组，调用方走单账号路径。
   */
  selectChainCandidates(model: string, preferredAccountId?: string): AccountSelection[] {
    if (model.includes('/')) return []

    const order = new Map(
      resolveAggregateChain(AGGREGATE_REGISTRY, model, { headroom: aggregateHeadroom }).map(
        (candidate, index) => [candidate.entryId, index]
      )
    )
    if (order.size < 2) return []

    return this.getAvailableAccounts(model, undefined, true)
      .filter(selection => order.has(selection.provider.id))
      .filter(selection => !preferredAccountId || selection.account.id === preferredAccountId)
      .sort((a, b) => (order.get(a.provider.id) ?? 0) - (order.get(b.provider.id) ?? 0))
  }

  /**
   * 同一供应商的其余可用账号：一把 Key 失败（429/5xx）后轮换到下一把用。
   * 已排除失败账号与额度打满的账号；其余家不参与。
   */
  selectSameProviderCandidates(model: string, providerId: string, excludeAccountId?: string): AccountSelection[] {
    return this.getAvailableAccounts(model, providerId, true)
      .filter(selection => selection.account.id !== excludeAccountId)
  }

  /**
   * 具名模型空池的瞬时成因：与 `getAvailableAccounts` 同一套判据重走一遍，只有当
   * 空池**完全**由会自己复位的状态（额度窗口/上游亲口拒/当日上限）造成时返回剔除
   * 清单，调用方据此把 503 翻成 429 + Retry-After（与 auto 路径的
   * `transientUnavailable` 同口径）。掺了别的成因（失败冷却、或本该进池的账号 ——
   * 两次读取之间状态变了）返回 undefined，调用方保持 503。
   * 停用账号与 auto 同口径：不进池，也不算跳过。
   */
  transientEmptyPoolSkips(
    model: string,
    preferredProviderId?: string,
    excludeFailed: boolean = false
  ): TransientSkip[] | undefined {
    const chain = this.namedChain(model, preferredProviderId)
    const gateContext = createQuotaGateContext()
    const skips: TransientSkip[] = []
    let allTransient = true

    for (const provider of storeManager.getProviders().filter(p => p.enabled)) {
      if (preferredProviderId && provider.id !== preferredProviderId) {
        continue
      }
      const chained = chain.get(provider.id)
      if (!this.providerSupportsModel(provider, chained?.displayName ?? model)) {
        continue
      }
      const actualModel = chained?.actualModelId ?? this.mapModel(model, provider)
      for (const account of storeManager.getAccountsByProviderId(provider.id, true)) {
        if (account.status !== 'active') {
          continue
        }
        if (account.dailyLimit && dailyUsageOf(account) >= account.dailyLimit) {
          skips.push({ providerId: provider.id, accountId: account.id, model: actualModel, displayName: chained?.displayName ?? model, reason: 'daily_limit' })
          continue
        }
        if (excludeFailed && this.isAccountInFailure(account.id)) {
          allTransient = false
          continue
        }
        const reason = quotaBlockReason(provider, account.id, actualModel, gateContext)
        if (reason !== undefined) {
          skips.push({ providerId: provider.id, accountId: account.id, model: actualModel, displayName: chained?.displayName ?? model, reason })
          continue
        }
        // 走到这里 = 这个账号本该进池：空池不是瞬时状态造成的
        allTransient = false
      }
    }

    return allTransient && skips.length > 0 ? skips : undefined
  }

  /**
   * 裸名的跨家链（按额度余量排序）。选号与空池诊断共用这一份：两处若各解析一遍，
   * 「诊断说的模型」与「选号用的模型」迟早漂移。带前缀或点名了供应商时没有链。
   */
  private namedChain(
    model: string,
    preferredProviderId?: string
  ): Map<string, { displayName: string; actualModelId: string; index: number }> {
    const chain = new Map<string, { displayName: string; actualModelId: string; index: number }>()
    if (!preferredProviderId && !model.includes('/')) {
      resolveAggregateChain(AGGREGATE_REGISTRY, model, { headroom: aggregateHeadroom }).forEach(
        (candidate, index) => {
          chain.set(candidate.entryId, {
            displayName: candidate.displayName,
            actualModelId: candidate.actualModelId,
            index,
          })
        }
      )
    }
    return chain
  }

  /**
   * Get available accounts list
   */
  private getAvailableAccounts(
    model: string,
    preferredProviderId?: string,
    excludeFailed: boolean = false
  ): AccountSelection[] {
    const providers = storeManager.getProviders().filter(p => p.enabled)
    const candidates: AccountSelection[] = []

    // 裸模型名（不带 `<entry>/` 前缀）可能同时被多家聚合条目服务。先解析成一条按额度余量排序的链，
    // 后面按条目改用它在目录里的显示名，顺序也沿用链的顺序。写明了前缀的名字不走这条路。
    const chain = this.namedChain(model, preferredProviderId)

    for (const provider of providers) {
      if (preferredProviderId && provider.id !== preferredProviderId) {
        continue
      }

      const chained = chain.get(provider.id)
      if (!this.providerSupportsModel(provider, chained?.displayName ?? model)) {
        continue
      }

      const actualModel = chained?.actualModelId ?? this.mapModel(model, provider)
      const accounts = storeManager.getAccountsByProviderId(provider.id, true)
        .filter(account => this.isAccountAvailable(account))
        .filter(account => !excludeFailed || !this.isAccountInFailure(account.id))
        // 额度已打满的账号不进候选：让失败切换把一次上游请求花在有余额的那家身上
        .filter(account => !quotaBlockReason(provider, account.id, actualModel))

      debugLog(`[LoadBalancer] Provider ${provider.name} (${provider.id}) has ${accounts.length} available accounts`)

      for (const account of accounts) {
        // 原来的这一行连 token 长度一起打；选路只需要知道「谁进了池」，
        // 凭据的任何形态都不该出现在 stdout 上。
        debugLog(`[LoadBalancer] Account ${account.name} (${account.id}) in pool`)
        candidates.push({
          account,
          provider,
          actualModel,
        })
      }
    }

    if (chain.size > 0) {
      const rank = (providerId: string): number => chain.get(providerId)?.index ?? Number.MAX_SAFE_INTEGER
      candidates.sort((a, b) => rank(a.provider.id) - rank(b.provider.id))
    }

    return candidates
  }

  /**
   * Check if provider supports model
   */
  private providerSupportsModel(provider: Provider, model: string): boolean {
    const config = storeManager.getConfig()
    const routable = isModelRoutable({
      model,
      servedNames: storeManager.getEffectiveModels(provider.id).map(m => m.displayName),
      hasCatalogue: storeManager.getModelCatalogue(provider.id).length > 0,
      mapping: config.modelMappings[model],
    })

    if (!routable) {
      debugLog(`[LoadBalancer] Provider ${provider.name} does not support model ${model}`)
    }

    return routable
  }

  /**
   * Check if account is available
   */
  private isAccountAvailable(account: Account): boolean {
    if (account.status !== 'active') {
      return false
    }

    if (account.dailyLimit && dailyUsageOf(account) >= account.dailyLimit) {
      return false
    }

    return true
  }

  /**
   * Map model name
   */
  private mapModel(model: string, provider: Provider): string {
    debugLog(`[LoadBalancer] mapModel called with model="${model}", provider="${provider.name}"`)
    
    const effectiveModels = storeManager.getEffectiveModels(provider.id)
    const effectiveModel = effectiveModels.find(m => 
      m.displayName.toLowerCase() === model.toLowerCase()
    )
    
    if (effectiveModel) {
      debugLog(`[LoadBalancer] Model mapped from "${model}" to "${effectiveModel.actualModelId}" via effective models`)
      return effectiveModel.actualModelId
    }

    const config = storeManager.getConfig()
    const mapping = config.modelMappings[model]

    if (isMappingActive(mapping) && (!mapping.preferredProviderId || mapping.preferredProviderId === provider.id)) {
      const actualModel = mapping.actualModel
      debugLog(`[LoadBalancer] Model mapped from "${model}" to "${actualModel}" via global mapping`)
      
      const actualEffectiveModel = effectiveModels.find(m => 
        m.displayName.toLowerCase() === actualModel.toLowerCase()
      )
      if (actualEffectiveModel) {
        debugLog(`[LoadBalancer] Model further mapped from "${actualModel}" to "${actualEffectiveModel.actualModelId}" via effective models`)
        return actualEffectiveModel.actualModelId
      }
      
      return actualModel
    }

    debugLog(`[LoadBalancer] No mapping found, returning original model "${model}"`)
    return model
  }

  /**
   * Round Robin strategy
   */
  private selectRoundRobin(candidates: AccountSelection[]): AccountSelection {
    const providerIds = [...new Set(candidates.map(c => c.provider.id))]
    const key = providerIds.join(',')

    const currentIndex = this.roundRobinIndex.get(key) || 0
    const selected = candidates[currentIndex % candidates.length]

    this.roundRobinIndex.set(key, (currentIndex + 1) % candidates.length)

    return selected
  }

  /**
   * Fill First strategy
   * Use current account preferentially until limit is reached
   */
  private selectFillFirst(candidates: AccountSelection[]): AccountSelection {
    return candidates.reduce((best, current) => {
      const bestUsed = dailyUsageOf(best.account)
      const currentUsed = dailyUsageOf(current.account)

      if (currentUsed < bestUsed) {
        return current
      }

      if (currentUsed === bestUsed) {
        const bestLastUsed = best.account.lastUsed || 0
        const currentLastUsed = current.account.lastUsed || 0

        if (currentLastUsed < bestLastUsed) {
          return current
        }
      }

      return best
    })
  }

  /**
   * Failover strategy
   * Select account with least failures, preferring healthy accounts
   */
  private selectFailover(candidates: AccountSelection[]): AccountSelection {
    const healthyCandidates = candidates.filter(c => !this.isAccountInFailure(c.account.id))
    
    if (healthyCandidates.length > 0) {
      return this.selectRoundRobin(healthyCandidates)
    }

    const sortedCandidates = candidates.sort((a, b) => {
      const failureA = this.failedAccounts.get(a.account.id)
      const failureB = this.failedAccounts.get(b.account.id)

      const countA = failureA ? failureA.count : 0
      const countB = failureB ? failureB.count : 0

      if (countA !== countB) {
        return countA - countB
      }

      const timeA = failureA ? failureA.lastFailTime : 0
      const timeB = failureB ? failureB.lastFailTime : 0

      return timeA - timeB
    })

    return sortedCandidates[0]
  }

  /**
   * Reset Round Robin index
   */
  resetRoundRobinIndex(): void {
    this.roundRobinIndex.clear()
  }

  /**
   * Get available account count
   */
  getAvailableAccountCount(model: string, providerId?: string): number {
    return this.getAvailableAccounts(model, providerId).length
  }

  /**
   * Get all available models
   */
  getAvailableModels(): string[] {
    const providers = storeManager.getProviders().filter(p => p.enabled)
    const models = new Set<string>()

    for (const provider of providers) {
      const accounts = storeManager.getAccountsByProviderId(provider.id)
        .filter(account => this.isAccountAvailable(account))

      if (accounts.length > 0) {
        const effectiveModels = storeManager.getEffectiveModels(provider.id)
        effectiveModels.forEach(m => models.add(m.displayName))
      }
    }

    return [...models]
  }
}

/**
 * 账号级声明额度摊成 `DeclaredQuotaFact[]`，供 `smart` / `pace` 排序。
 *
 * 三个要点：
 * - **按账号读，不按模型读**：声明是套餐级的（`declaredWindow` 用 `ALL_MODELS` 汇总），
 *   所以在同一账号的任意模型上都给同一批事实 —— 与 `quotaBlockDetail` 的判据同源。
 * - **复位时刻照样只给能算的**：滚动窗口取最老一笔滑出的时刻（估算），自然周/月取
 *   记账边界（本地）；窗口里还没有用量时不给时刻，`projectReset` 跳过它而不猜。
 * - **读不到就返回空**：与闸门同一条 fail-open —— 声明缺席不是「不能用」，只是
 *   "这条策略没有证据可依"，调用方据此退回 fill-first。
 */
function declaredFactsOf(
  ledger: QuotaLedger,
  candidate: AccountSelection,
  context: QuotaGateContext,
  nowMs: number,
): DeclaredQuotaFact[] {
  const providerId = candidate.provider.id
  const accountId = candidate.account.id
  const declared = declaredQuotaOf(accountId, providerId, context)
  if (declared.length === 0) return []

  // 同一声明可能同时挂 token 与请求两条上限，读数只取一次（账本扫描不便宜）。
  const readings = new Map<DeclaredQuotaWindow, ReturnType<QuotaLedger['declaredWindow']>>()
  const readingOf = (window: DeclaredQuotaWindow): ReturnType<QuotaLedger['declaredWindow']> => {
    const cached = readings.get(window)
    if (cached !== undefined) return cached
    const reading = ledger.declaredWindow(providerId, accountId, window, nowMs)
    readings.set(window, reading)
    return reading
  }

  return declared.map(entry => {
    const reading = readingOf(entry.window)
    const { resetAt } = declaredResetAt(reading, entry.window, nowMs)
    return {
      window: entry.window,
      unit: entry.unit,
      used: declaredUsageOf(reading, entry.unit),
      limit: entry.limit,
      ...(resetAt === undefined ? {} : { resetAt }),
    }
  })
}

export const loadBalancer = new LoadBalancer()
export default loadBalancer
