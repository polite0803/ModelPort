/**
 * The shell's address book: which gateways this install can connect to.
 *
 * Deliberately a plain JSON file under the shell's own userData (`modelport-shell`),
 * not the gateway's `data.json`: the shell is a client, and letting it write into the
 * gateway's storage would give two processes one file and a lock fight. It also means
 * the management secret never lives here - the page inside the window keeps it in
 * sessionStorage, which dies with the tab, exactly as it does in a browser.
 *
 * No entry is validated against a live gateway at load time: an unreachable host must
 * still be listed (that is the entry the user is about to fix), and the window shows
 * why the connection failed rather than dropping the row.
 */
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * What this entry's gateway is: a process this console starts, a daemon inside WSL, or a
 * host someone else runs. The three differ in what "the gateway does not exist" means -
 * the first two can install it, the third cannot - so the mode is stored, never guessed
 * from the URL (a `127.0.0.1` address may just as well be a container or a tunnel).
 *
 * Defined in `shared/shellList.ts` because the list window renders the same union; this
 * file re-exports it so existing importers keep one name.
 */
import type { GatewayKind } from '../shared/shellList'
export type { GatewayKind }

export interface GatewayEntry {
  id: string
  name: string
  /** Origin of a daemon's management UI, e.g. http://127.0.0.1:8080 or https://host:8443 */
  url: string
  kind: GatewayKind
  /**
   * Implied by `kind === 'wsl'`; kept as a field because the upgrade path reads it and
   * an old `gateways.json` has no `kind` to migrate from until it is read once.
   */
  manageWsl?: boolean
  /** Distro name for `wsl.exe -d`; absent = the Windows default distro. */
  wslDistro?: string
  /**
   * The client-facing https endpoint of THIS access path, for clients that refuse plain
   * http (Claude Desktop). Access-path data lives on the entry, not the gateway: the same
   * gateway is `https://<ip>:8443` when reached directly but `https://<domain>` (port 443,
   * a public edge cert) through a proxy, and the gateway cannot tell those apart. Absent =
   * fall back to `url` when it is already https; a non-loopback http entry with no value
   * blocks the switch honestly instead of guessing a port the gateway never advertised
   * for this path.
   */
  clientHttpsUrl?: string
}

export interface AddressBook {
  entries: GatewayEntry[]
  /** The entry the window shows on start; falls back to the first entry when absent. */
  activeId?: string
}

const EMPTY: AddressBook = { entries: [] }

function bookPath(): string {
  return join(app.getPath('userData'), 'gateways.json')
}

/** Trims trailing slashes so "…:8080/" and "…:8080" are the same endpoint. */
export function normalizeOrigin(url: string): string | null {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (trimmed === '') return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  // Same rule as the gateway's own openExternal: anything but http(s) hands credentials
  // to a protocol handler (file://, smb://, ms-msdt:) the moment it is clicked.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  return parsed.origin
}

function readKind(entry: GatewayEntry): GatewayKind {
  if (entry.kind === 'local' || entry.kind === 'wsl' || entry.kind === 'remote') return entry.kind
  // Files written before the three-mode change have no `kind`; WSL management was the
  // only opt-in, so it is the only thing that can be recovered from them.
  return entry.manageWsl === true ? 'wsl' : 'remote'
}

/** Only an https origin is a usable client endpoint; anything else is dropped, not guessed. */
function readClientHttpsUrl(entry: GatewayEntry): string | undefined {
  if (typeof entry.clientHttpsUrl !== 'string') return undefined
  const origin = normalizeOrigin(entry.clientHttpsUrl)
  return origin !== null && origin.startsWith('https:') ? origin : undefined
}

export function readBook(): AddressBook {
  const path = bookPath()
  if (!existsSync(path)) return { ...EMPTY }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<AddressBook>
    const entries = Array.isArray(raw.entries)
      ? raw.entries
          .filter((entry): entry is GatewayEntry => !!entry && typeof entry.url === 'string' && typeof entry.name === 'string')
          .map(entry => {
            const kind = readKind(entry)
            const clientHttpsUrl = readClientHttpsUrl(entry)
            return {
              id: entry.id ?? randomUUID(),
              name: entry.name,
              url: entry.url,
              kind,
              ...(kind === 'wsl' ? { manageWsl: true as const } : {}),
              ...(typeof entry.wslDistro === 'string' && entry.wslDistro.trim() !== ''
                ? { wslDistro: entry.wslDistro.trim() }
                : {}),
              ...(clientHttpsUrl !== undefined ? { clientHttpsUrl } : {}),
            }
          })
      : []
    const activeId = entries.some(entry => entry.id === raw.activeId) ? raw.activeId : undefined
    return { entries, ...(activeId ? { activeId } : {}) }
  } catch (error) {
    // A half-written file must not brick the shell: show the empty book and say why.
    console.warn('[Shell] gateways.json is unreadable, starting with an empty address book:', error)
    return { ...EMPTY }
  }
}

export function writeBook(book: AddressBook): void {
  const path = bookPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(book, null, 2), { encoding: 'utf8', mode: 0o600 })
}

export function activeEntry(book: AddressBook): GatewayEntry | null {
  if (book.entries.length === 0) return null
  return book.entries.find(entry => entry.id === book.activeId) ?? book.entries[0] ?? null
}

export function upsertEntry(
  book: AddressBook,
  input: { id?: string; name: string; url: string; kind: GatewayKind; wslDistro?: string; clientHttpsUrl?: string },
): AddressBook {
  const origin = normalizeOrigin(input.url)
  if (origin === null) throw new Error(`"${input.url}" is not an http(s) origin`)
  const kind = input.kind
  const wslDistro = kind === 'wsl' && typeof input.wslDistro === 'string' ? input.wslDistro.trim() : ''
  const httpsOrigin = typeof input.clientHttpsUrl === 'string' ? normalizeOrigin(input.clientHttpsUrl) : null
  const clientHttpsUrl = httpsOrigin !== null && httpsOrigin.startsWith('https:') ? httpsOrigin : undefined

  if (input.id) {
    return {
      ...book,
      entries: book.entries.map(entry => {
        if (entry.id !== input.id) return entry
        const next: GatewayEntry = {
          id: entry.id,
          name: input.name.trim() || entry.name,
          url: origin,
          kind,
        }
        if (kind === 'wsl') next.manageWsl = true
        if (wslDistro !== '') next.wslDistro = wslDistro
        if (clientHttpsUrl !== undefined) next.clientHttpsUrl = clientHttpsUrl
        return next
      }),
    }
  }

  const created: GatewayEntry = {
    id: randomUUID(),
    name: input.name.trim() || origin,
    url: origin,
    kind,
  }
  if (kind === 'wsl') created.manageWsl = true
  if (wslDistro !== '') created.wslDistro = wslDistro
  if (clientHttpsUrl !== undefined) created.clientHttpsUrl = clientHttpsUrl
  return { entries: [...book.entries, created], activeId: book.activeId ?? created.id }
}

export function removeEntry(book: AddressBook, id: string): AddressBook {
  const entries = book.entries.filter(entry => entry.id !== id)
  return {
    entries,
    ...(entries.some(entry => entry.id === book.activeId) ? { activeId: book.activeId } : {}),
  }
}
