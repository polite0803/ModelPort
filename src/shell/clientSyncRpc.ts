/**
 * The management calls the client sync needs, and the one decision that makes switching
 * gateways work at all: a single canonical key.
 *
 * Why a key has to be *distributed* rather than read: the three gateways in a real address
 * book were configured at different times and hold three different keys, while every
 * client stores exactly one. Repointing base URLs alone would therefore 401 on arrival.
 * `GET /v1/management/api-keys` masks its values, but `config:get` returns the config
 * whole (masking lives only in that dedicated REST route), so the console can read the
 * plaintext it is already authorized to hold and write the same key into the others.
 *
 * Nothing here takes a URL, a channel or a key from the page: the caller passes address
 * book entries and the secrets this process sealed itself.
 */
import { net } from 'electron'
import type { GatewayEntry } from './addressBook.ts'
import { normalizeOrigin } from './addressBook.ts'
import type { ApiKey } from '../shared/types.ts'
import type { ClientSyncModel, KeyDistributionRow } from '../shared/clientSync.ts'

/** Same budget as the certificate panel: a hung gateway must not hang the console. */
const TIMEOUT_MS = 8000

export interface GatewayCredential {
  entry: GatewayEntry
  /** The sealed management secret for this origin, or null when none was stored. */
  secret: string | null
}

async function callJson<T>(url: string, init: RequestInit & { headers: Record<string, string> }): Promise<T> {
  const response = await net.fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
  const body = (await response.json().catch(() => null)) as
    | { success?: boolean; data?: T; error?: { code?: string; message?: string } }
    | null
  if (!response.ok || body?.success === false) {
    const detail = body?.error?.message ?? `HTTP ${response.status}`
    throw new Error(`${url} → ${detail}`)
  }
  if (body?.data === undefined) throw new Error(`${url} → 响应里没有 data`)
  return body.data
}

/** One management RPC. The allowlist is the gateway's own handler registry. */
export function managementCall<T>(origin: string, secret: string, channel: string, args: unknown[] = []): Promise<T> {
  return callJson<T>(`${origin}/v1/management/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Management-Secret': secret },
    body: JSON.stringify({ channel, args }),
  })
}

/** Plaintext keys, via `config:get` - the masked REST route cannot answer this. */
export async function readGatewayKeys(origin: string, secret: string): Promise<ApiKey[]> {
  const config = await managementCall<{ apiKeys?: ApiKey[] }>(origin, secret, 'config:get')
  return Array.isArray(config.apiKeys) ? config.apiKeys.filter(item => typeof item?.key === 'string' && item.enabled !== false) : []
}

/**
 * The route names the target actually serves, read the way a client reads them.
 *
 * `context_window` is taken only when the gateway advertises it; the field is omitted
 * upstream rather than guessed, and an invented window here would be worse than none.
 */
export async function fetchRoutes(origin: string, key: string | null): Promise<ClientSyncModel[]> {
  const headers: Record<string, string> = {}
  if (key !== null) headers.Authorization = `Bearer ${key}`
  const data = await callJson<{ data?: unknown[] }>(`${origin}/v1/models`, { method: 'GET', headers })
  const list = Array.isArray(data) ? data : []
  const models: ClientSyncModel[] = []
  for (const item of list) {
    if (item === null || typeof item !== 'object') continue
    const entry = item as { id?: unknown; display_name?: unknown; context_window?: unknown }
    if (typeof entry.id !== 'string' || entry.id === '') continue
    models.push({
      name: entry.id,
      displayName: typeof entry.display_name === 'string' ? entry.display_name : entry.id,
      contextWindow: typeof entry.context_window === 'number' && entry.context_window > 0 ? entry.context_window : null,
    })
  }
  return models
}

export interface CanonicalKeyResult {
  key: string | null
  distribution: KeyDistributionRow[]
  error: string | null
}

/**
 * Establishes one key and makes every reachable gateway accept it.
 *
 * The active gateway's first key wins, because that is the gateway the clients are being
 * pointed at and its key already works there - choosing it means the common case writes
 * nothing to the target. Only when no gateway has a key at all is one minted.
 *
 * Idempotent: a gateway that already lists the canonical key is reported `already` and
 * not written, so running the sync twice does not grow the key list.
 */
export async function ensureCanonicalKey(
  gateways: GatewayCredential[],
  activeOrigin: string,
): Promise<CanonicalKeyResult> {
  const distribution: KeyDistributionRow[] = []
  const reachable: { origin: string; credential: GatewayCredential; keys: ApiKey[] }[] = []

  for (const credential of gateways) {
    const { entry, secret } = credential
    // readBook keeps the url as written, so a legacy entry may carry a trailing slash.
    // Comparing that raw against the normalized active origin would lose the target.
    const origin = normalizeOrigin(entry.url) ?? entry.url
    if (secret === null) {
      distribution.push({ origin, name: entry.name, state: 'no-secret', detail: '本控制台没有存这个网关的管理密钥' })
      continue
    }
    try {
      reachable.push({ origin, credential, keys: await readGatewayKeys(origin, secret) })
    } catch (error) {
      distribution.push({
        origin,
        name: entry.name,
        state: 'failed',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const active = reachable.find(item => item.origin === activeOrigin)
  if (!active) {
    // Neither readable nor writable: a key borrowed from another gateway would look
    // configured and 401 on arrival. Returning null makes every row say "address moved,
    // enter the key yourself" instead of pretending the switch is complete.
    return {
      key: null,
      distribution,
      error: `目标网关 ${activeOrigin} 的管理面不可用（没存管理密钥或连接失败）：无法确认它接受哪把 key`,
    }
  }

  const donor = active.keys[0] ?? reachable.find(item => item.keys.length > 0)?.keys[0]
  let key = donor?.key ?? null

  if (key === null) {
    // No gateway has a key. Mint one on the target so the clients have something to
    // send; a gateway with no key at all only binds loopback, which a remote client
    // cannot reach anyway.
    try {
      const minted = await callJson<ApiKey>(`${active.origin}/v1/management/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Management-Secret': active.credential.secret as string },
        body: JSON.stringify({ name: 'ModelPort 客户端同步', description: '由控制台一键切换客户端时创建' }),
      })
      key = minted.key
      active.keys.push(minted)
    } catch (error) {
      return {
        key: null,
        distribution,
        error: `目标网关没有可用 API Key，且新建失败：${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  for (const { origin, credential, keys } of reachable) {
    const { entry, secret } = credential
    if (keys.some(item => item.key === key)) {
      distribution.push({ origin, name: entry.name, state: 'already' })
      continue
    }
    try {
      // Append, never replace: the gateway's other keys may be in use by clients this
      // console does not manage.
      const next = [...keys, { id: `clientsync-${Date.now()}`, name: 'ModelPort 客户端同步', key, enabled: true, createdAt: Date.now(), usageCount: 0 }]
      await managementCall(origin, secret as string, 'config:update', [{ apiKeys: next }])
      distribution.push({ origin, name: entry.name, state: 'added' })
    } catch (error) {
      distribution.push({
        origin,
        name: entry.name,
        state: 'failed',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // The target itself must have accepted the key, or the clients are being handed a
  // credential that does not work where they are being pointed.
  const target = distribution.find(item => item.origin === activeOrigin)
  if (target?.state === 'failed') {
    return { key: null, distribution, error: `规范 key 写入目标网关失败：${target.detail ?? '未知原因'}` }
  }

  return { key, distribution, error: null }
}