/**
 * Line-scoped TOML editing: every byte we did not name stays exactly as it was.
 *
 * A client `config.toml` carries `[mcp_servers.*]`, `[projects.*]`, `[profiles.*]` and
 * comments that have nothing to do with the gateway. Parsing and re-emitting the document
 * would reorder or drop them, so the editors here walk the raw lines and splice only the
 * table or key they were asked about. Multi-line values (arrays spanning lines) are
 * reported as uneditable rather than mangled.
 */

export interface TomlDocument {
  lines: string[]
  eol: string
}

export function splitToml(raw: string): TomlDocument {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.split(/\r?\n/)
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return { lines, eol }
}

export function joinToml(document: TomlDocument): string {
  return document.lines.join(document.eol) + document.eol
}

/** A table header line, `[x]` or `[[x]]`, with optional trailing comment. */
export function isHeaderLine(line: string): boolean {
  return /^\s*\[\[?[^\]]+\]\]?\s*(#.*)?$/.test(line)
}

export function headerName(line: string): string {
  const match = /^\s*\[\[?([^\]]+)\]\]?/.exec(line)
  return match ? match[1].trim() : ''
}

/** `[start, end)` of a table's body; `null` for the top level means "before the first header". */
export function tableRange(lines: string[], table: string | null): [number, number] | null {
  if (table === null) {
    const first = lines.findIndex(isHeaderLine)
    return [0, first === -1 ? lines.length : first]
  }
  const start = lines.findIndex(line => isHeaderLine(line) && headerName(line) === table)
  if (start === -1) return null
  let end = start + 1
  while (end < lines.length && !isHeaderLine(lines[end])) end += 1
  return [start + 1, end]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function keyLineIndex(lines: string[], start: number, end: number, key: string): number {
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`)
  for (let i = start; i < end; i += 1) if (pattern.test(lines[i])) return i
  return -1
}

/** The value of a single-line `key = "…"` / `key = '…'`; null when absent or multi-line. */
export function readTomlString(lines: string[], table: string | null, key: string): string | null {
  const range = tableRange(lines, table)
  if (!range) return null
  const index = keyLineIndex(lines, range[0], range[1], key)
  if (index === -1) return null
  const match = /=\s*("([^"]*)"|'([^']*)')\s*(#.*)?$/.exec(lines[index])
  if (!match) return null
  return match[2] ?? match[3] ?? null
}

/** `key = "value"` with the minimal escaping TOML requires inside a basic string. */
export function tomlStringLiteral(key: string, value: string): string {
  return `${key} = "${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export interface TomlEdit {
  ok: boolean
  before: string | null
}

/**
 * Sets one single-line string key inside a table, inserting it when absent.
 *
 * Only single-line values are touched: a multi-line array would be corrupted by replacing
 * one line, so the caller is told instead of guessing.
 */
export function setTomlString(lines: string[], table: string | null, key: string, value: string): TomlEdit {
  const range = tableRange(lines, table)
  if (!range) return { ok: false, before: null }
  const [start, end] = range
  const index = keyLineIndex(lines, start, end, key)
  const literal = tomlStringLiteral(key, value)
  if (index === -1) {
    let at = end
    while (at > start && lines[at - 1].trim() === '') at -= 1
    lines.splice(at, 0, literal)
    return { ok: true, before: null }
  }
  const before = readTomlString(lines, table, key)
  if (before === null) return { ok: false, before: null }
  if (before === value) return { ok: true, before }
  const indent = /^\s*/.exec(lines[index])?.[0] ?? ''
  lines[index] = `${indent}${literal}`
  return { ok: true, before }
}

/** Deletes a key line. Returns true when something was removed. */
export function removeTomlKey(lines: string[], table: string | null, key: string): boolean {
  const range = tableRange(lines, table)
  if (!range) return false
  const index = keyLineIndex(lines, range[0], range[1], key)
  if (index === -1) return false
  lines.splice(index, 1)
  return true
}

/** True when the table header exists (`[]` or `[[]]`). */
export function hasTomlTable(lines: string[], table: string): boolean {
  return tableRange(lines, table) !== null
}

/** Header plus body, verbatim, without the surrounding blank lines. */
export function readTomlTable(lines: string[], table: string): string[] | null {
  const start = lines.findIndex(line => isHeaderLine(line) && headerName(line) === table)
  if (start === -1) return null
  let end = start + 1
  while (end < lines.length && !isHeaderLine(lines[end])) end += 1
  const body = lines.slice(start, end)
  while (body.length > 1 && body[body.length - 1].trim() === '') body.pop()
  return body
}

/** Replaces a whole table (header included) in place, keeping its position. */
export function replaceTomlTable(lines: string[], table: string, content: string[]): boolean {
  const start = lines.findIndex(line => isHeaderLine(line) && headerName(line) === table)
  if (start === -1) return false
  let end = start + 1
  while (end < lines.length && !isHeaderLine(lines[end])) end += 1
  while (end > start + 1 && lines[end - 1].trim() === '') end -= 1
  lines.splice(start, end - start, ...content, '')
  return true
}

/** Appends a table at the end of the document, separated by one blank line. */
export function appendTomlTable(lines: string[], content: string[]): void {
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  if (lines.length > 0) lines.push('')
  lines.push(...content)
}

/** Deletes a table (header and body). Returns true when it existed. */
export function removeTomlTable(lines: string[], table: string): boolean {
  const start = lines.findIndex(line => isHeaderLine(line) && headerName(line) === table)
  if (start === -1) return false
  let end = start + 1
  while (end < lines.length && !isHeaderLine(lines[end])) end += 1
  while (end > start + 1 && lines[end - 1].trim() === '') end -= 1
  if (start > 0 && lines[start - 1].trim() === '' && (end >= lines.length || lines[end].trim() === '')) {
    lines.splice(start - 1, end - start + 1)
  } else {
    lines.splice(start, end - start)
  }
  return true
}

/** `name` when it is a bare TOML key, `"name"` when it needs quoting. */
export function tomlKey(name: string): string {
  return /^[A-Za-z0-9_-]+$/.test(name) ? name : `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * A header line for a table addressed by its segments.
 *
 * Splitting an existing name on `.` would be wrong: a quoted segment may itself contain a
 * dot (`models."modelport-gpt-4.1"`), so the header is built from the segments.
 */
export function tomlTableHeader(segments: string[]): string {
  return `[${segments.map(tomlKey).join('.')}]`
}

/** The lookup name a `[a."b.c"]` header parses back to, for `tableRange` and friends. */
export function dottedTable(segments: string[]): string {
  return segments.map(segment => tomlKey(segment)).join('.')
}