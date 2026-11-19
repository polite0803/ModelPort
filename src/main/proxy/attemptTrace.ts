import type { RequestAttemptTrace } from '../../shared/types'
import type { Account, Provider } from '../store/types'
import type { ForwardResult } from './types'
import {
  isChannelModelUnavailableError,
  isFailoverEligibleStatus,
  isForcedToolChoiceUnsupported,
  isMissingReasoningHistoryError,
  isMissingSessionAffinityError,
  isAccountArrearsError,
  isToolOverflowError,
} from './failover.ts'

/**
 * One structured attempt row for the request log.
 *
 * Kept pure (no store/electron) so the classification can be unit-tested. The
 * persistence layer applies redaction and truncation afterwards.
 */
export function attemptTraceOf(input: {
  provider: Provider
  account: Account
  model: string
  result: ForwardResult
  retryIndex: number
  aborted?: boolean
}): RequestAttemptTrace {
  const { provider, account, model, result } = input
  const capability =
    isToolOverflowError(result.error)
    || isMissingReasoningHistoryError(result.error)
    || isChannelModelUnavailableError(result.error)
    || isForcedToolChoiceUnsupported(result.error)
    || isMissingSessionAffinityError(result.error)
    || isAccountArrearsError(result.error)
    || result.status === 404
  const outcome: RequestAttemptTrace['outcome'] = result.success
    ? 'success'
    : input.aborted
      ? 'client_abort'
      : capability
        ? 'capability'
        : isFailoverEligibleStatus(result.status)
          ? 'failover'
          : 'fatal'
  return {
    providerId: provider.id,
    ...(provider.name === undefined ? {} : { providerName: provider.name }),
    accountId: account.id,
    ...(account.name === undefined ? {} : { accountName: account.name }),
    model,
    ...(result.status === undefined ? {} : { status: result.status }),
    ...(result.errorDetails?.type === undefined ? {} : { errorType: result.errorDetails.type }),
    ...(result.errorDetails?.code === undefined ? {} : { errorCode: result.errorDetails.code }),
    ...(result.error === undefined ? {} : { errorMessage: result.error.slice(0, 500) }),
    ...(result.latency === undefined ? {} : { latencyMs: result.latency }),
    outcome,
    retryIndex: input.retryIndex,
  }
}
