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
import { aggregateHeadroom, quotaBlockReason } from './quota/gate'
import { resolveCaps } from './quota/limits'
import { pickBestPace, pickSoonestReset, type AccountQuotaFacts } from '../../shared/quotaPacing'
import { debugLog } from '../logging/debugLog'

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
   */
  selectAccount(
    model: string,
    strategy: LoadBalanceStrategy = 'round-robin',
    preferredProviderId?: string,
    preferredAccountId?: string
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
   * 额度只对聚合目录的家有意义；别家没有额度旁表，直接不参与（返回 undefined →
   * 调用方退回 fill-first），而不是凭空给一个 0.5 的中性分。
   */
  private selectByQuotaPacing(
    candidates: AccountSelection[],
    strategy: 'smart' | 'pace'
  ): AccountSelection | null {
    const facts: AccountQuotaFacts[] = []
    const byAccountId = new Map<string, AccountSelection>()
    const nowMs = Date.now()

    for (const candidate of candidates) {
      if (candidate.provider.type !== 'aggregate') continue
      const entry = AGGREGATE_REGISTRY.find(row => row.id === candidate.provider.id)
      if (!entry) continue

      try {
        const ledger = storeManager.getQuotaLedger()
        const caps = resolveCaps(entry.id, candidate.actualModel, ledger.learnedFor(entry.id))
        if (!caps.enforceable) continue

        const snapshot = ledger.snapshot(entry.id, candidate.account.id, candidate.actualModel)
        const used: AccountQuotaFacts['used'] = {}
        const limit: AccountQuotaFacts['limit'] = {}
        for (const [metric, value] of Object.entries(caps.limits)) {
          if (typeof value !== 'number' || value <= 0) continue
          const key = metric as keyof typeof used
          limit[key] = value
          used[key] = snapshot[key] ?? 0
        }

        facts.push({ accountId: candidate.account.id, used, limit })
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

    if (account.dailyLimit && account.todayUsed && account.todayUsed >= account.dailyLimit) {
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
      const bestUsed = best.account.todayUsed || 0
      const currentUsed = current.account.todayUsed || 0

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

export const loadBalancer = new LoadBalancer()
export default loadBalancer
