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

export interface GatewayEntry {
  id: string
  name: string
  /** Origin of a daemon's management UI, e.g. http://127.0.0.1:8080 or https://host:8443 */
  url: string
  /**
   * Opt-in: the shell may upgrade the daemon inside WSL for this entry. Default off -
   * a remote gateway has no local daemon to replace, and guessing from the URL would
   * turn "http://127.0.0.1:8080" (a native daemon, a container, a tunnel) into a
   * privileged `systemctl` operation.
   */
  manageWsl?: boolean
  /** Distro name for `wsl.exe -d`; absent = the Windows default distro. */
  wslDistro?: string
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

export function readBook(): AddressBook {
  const path = bookPath()
  if (!existsSync(path)) return { ...EMPTY }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<AddressBook>
    const entries = Array.isArray(raw.entries)
      ? raw.entries
          .filter((entry): entry is GatewayEntry => !!entry && typeof entry.url === 'string' && typeof entry.name === 'string')
          .map(entry => ({
            id: entry.id ?? randomUUID(),
            name: entry.name,
            url: entry.url,
            ...(entry.manageWsl === true ? { manageWsl: true as const } : {}),
            ...(typeof entry.wslDistro === 'string' && entry.wslDistro.trim() !== ''
              ? { wslDistro: entry.wslDistro.trim() }
              : {}),
          }))
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
  input: { id?: string; name: string; url: string; manageWsl?: boolean; wslDistro?: string },
): AddressBook {
  const origin = normalizeOrigin(input.url)
  if (origin === null) throw new Error(`"${input.url}" is not an http(s) origin`)
  const manageWsl = input.manageWsl === true
  const wslDistro = typeof input.wslDistro === 'string' ? input.wslDistro.trim() : ''

  if (input.id) {
    return {
      ...book,
      entries: book.entries.map(entry => {
        if (entry.id !== input.id) return entry
        const next: GatewayEntry = {
          id: entry.id,
          name: input.name.trim() || entry.name,
          url: origin,
        }
        if (manageWsl) next.manageWsl = true
        if (wslDistro !== '') next.wslDistro = wslDistro
        return next
      }),
    }
  }

  const created: GatewayEntry = {
    id: randomUUID(),
    name: input.name.trim() || origin,
    url: origin,
  }
  if (manageWsl) created.manageWsl = true
  if (wslDistro !== '') created.wslDistro = wslDistro
  return { entries: [...book.entries, created], activeId: book.activeId ?? created.id }
}

export function removeEntry(book: AddressBook, id: string): AddressBook {
  const entries = book.entries.filter(entry => entry.id !== id)
  return {
    entries,
    ...(entries.some(entry => entry.id === book.activeId) ? { activeId: book.activeId } : {}),
  }
}
