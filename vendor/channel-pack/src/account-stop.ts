/**
 * Shared "upstream says it will not serve this account" handling.
 *
 * Every channel in this pack drives a consumer account through a client the
 * vendor does not authorise as a first-party one. When the vendor decides to
 * act on that, the answer is not an accounting error: it is a statement about
 * the **account**. Observed example (LobsterAI, 2026-11-04):
 * `账号已停止提供服务。请通过官方渠道使用有道龙虾；如有异议，请联…`
 *
 * Handling it like any other failure is what turns one stop into several:
 * the rotation path replays the same conversation body onto the next accounts,
 * nothing marks the stopped account, so it stays first in the pool and every
 * later request knocks on it again. This module is the one place that decides
 * "stop, do not rotate, park the account"; adapters only supply status + text.
 *
 * Deliberately narrow: generic `forbidden` / `unauthorized` are **not** markers,
 * and neither are content-policy rejections. An ordinary 403 is a dead token or
 * a permission rule, and Tencent's `11140 安全审核` is per-request content
 * interception that the buddy adapter deliberately rotates past with a 30-minute
 * cooldown - parking the account for that would disable a healthy login.
 * Only wording that says the **account** is stopped may match.
 */

export const ACCOUNT_STOP_MARKERS: readonly string[] = [
  // Chinese: enforcement wording seen from CN vendors (有道 / 腾讯 / 字节 / 智谱).
  '停止提供服务', '停止服务', '不再提供服务', '官方渠道', '官方客户端',
  '账号已被封禁', '账号被封禁', '账号已封停', '账号已被冻结', '账号已被停用',
  '封禁', '封停', '违规使用', '违反用户协议',
  // English mirrors (same vendors, international endpoints).
  'account suspended', 'account banned', 'account disabled', 'account terminated',
  'abuse detected', 'official client', 'official channel', 'use the official',
  'service has been stopped', 'stopped providing service',
]

/**
 * @param text - upstream response body (JSON envelope or plain text)
 * @returns the matched marker, or `undefined` when this is an ordinary failure
 */
export function matchAccountStop(text: string): string | undefined {
  if (text.length === 0) return undefined
  const lower = text.toLowerCase()
  for (const marker of ACCOUNT_STOP_MARKERS) {
    if (lower.includes(marker.toLowerCase()) || text.includes(marker)) return marker
  }
  return undefined
}

/** Convenience wrapper used at adapter junctions. */
export function isAccountStoppedMessage(text: string | undefined): boolean {
  return text !== undefined && matchAccountStop(text) !== undefined
}

/** The slice of `AccountPool` this module needs; kept structural so tests need no imports. */
export interface StoppableAccountPool {
  updateAccount(
    id: string,
    patch: { enabled: boolean; serviceStopped?: { at: number; text: string } },
  ): Promise<void>
}

/**
 * Take an account out of rotation for good, keeping the upstream wording.
 *
 * `enabled: false` is what removes it from `getAvailableAccount` (and therefore
 * from the balance gate and the catalogue pre-check), and it is also what stops
 * the daily claim / balance passes from poking it (see `channel-pack-rpc.ts`).
 *
 * Best-effort: when the write fails the caller still throws the upstream error,
 * because that error is the only evidence of what happened.
 */
export async function parkStoppedAccount(
  pool: StoppableAccountPool | undefined,
  accountId: string | undefined,
  text: string,
): Promise<void> {
  if (pool === undefined || accountId === undefined || accountId === '') return
  const excerpt = text.length > 400 ? `${text.slice(0, 400)}…` : text
  try {
    await pool.updateAccount(accountId, { enabled: false, serviceStopped: { at: Date.now(), text: excerpt } })
  } catch {
    // The account stays selectable; the caller's thrown error is unchanged.
  }
}
