/**
 * The non-TOML/YAML editors: JSON, JSON5/JSONC and dotenv.
 *
 * JSON clients are rewritten by parse → mutate → stringify, which preserves key order (the
 * JS object keeps insertion order) and matches the file's own indent. For JSON5/JSONC
 * documents that carry comments, a second path exists: locate the exact value span with a
 * trivia-aware scanner and replace only those bytes, so comments elsewhere survive.
 */

export function detectIndent(raw: string): string {
  const match = /\n([ \t]+)\S/.exec(raw)
  return match ? match[1] : '  '
}

export function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export function stringifyJson(raw: string | null, value: unknown): string {
  return JSON.stringify(value, null, raw === null ? '  ' : detectIndent(raw)) + '\n'
}

// ---------------------------------------------------------------------------
// JSON5 / JSONC: tolerant read + span splicing
// ---------------------------------------------------------------------------

/** Strips comments while respecting string literals; used only for tolerant reading. */
function stripJsonComments(raw: string): string {
  let out = ''
  let i = 0
  while (i < raw.length) {
    const char = raw[i]
    if (char === '"') {
      const end = scanJsonString(raw, i)
      out += raw.slice(i, end)
      i = end
      continue
    }
    if (char === '/' && raw[i + 1] === '/') {
      while (i < raw.length && raw[i] !== '\n') i += 1
      continue
    }
    if (char === '/' && raw[i + 1] === '*') {
      const end = raw.indexOf('*/', i + 2)
      i = end === -1 ? raw.length : end + 2
      continue
    }
    out += char
    i += 1
  }
  return out
}

/** Converts the JSON5 conveniences these configs use into strict JSON. */
function relaxToJson(raw: string): string {
  let out = ''
  let i = 0
  while (i < raw.length) {
    const char = raw[i]
    if (char === '"') {
      const end = scanJsonString(raw, i)
      out += raw.slice(i, end)
      i = end
      continue
    }
    if (char === "'") {
      let value = ''
      let j = i + 1
      while (j < raw.length && raw[j] !== "'") {
        if (raw[j] === '\\') {
          value += raw[j + 1] === "'" ? "'" : raw[j] + raw[j + 1]
          j += 2
          continue
        }
        value += raw[j]
        j += 1
      }
      out += JSON.stringify(value.replace(/\\'/g, "'"))
      i = j + 1
      continue
    }
    out += char
    i += 1
  }
  // Unquoted keys, trailing commas.
  out = out.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
  out = out.replace(/,(\s*[}\]])/g, '$1')
  return out
}

export function parseJson5Object(raw: string): Record<string, unknown> | null {
  const relaxed = relaxToJson(stripJsonComments(raw))
  try {
    const parsed: unknown = JSON.parse(relaxed)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function skipTrivia(raw: string, index: number): number {
  let i = index
  while (i < raw.length) {
    const char = raw[i]
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === ',') {
      i += 1
      continue
    }
    if (char === '/' && raw[i + 1] === '/') {
      while (i < raw.length && raw[i] !== '\n') i += 1
      continue
    }
    if (char === '/' && raw[i + 1] === '*') {
      const end = raw.indexOf('*/', i + 2)
      i = end === -1 ? raw.length : end + 2
      continue
    }
    break
  }
  return i
}

function scanJsonString(raw: string, index: number, quote = '"'): number {
  let i = index + 1
  while (i < raw.length) {
    if (raw[i] === '\\') {
      i += 2
      continue
    }
    if (raw[i] === quote) return i + 1
    i += 1
  }
  return i
}

function scanValueEnd(raw: string, index: number): number {
  const char = raw[index]
  if (char === '"' || char === "'") return scanJsonString(raw, index, char)
  if (char === '{' || char === '[') {
    const open = char
    const close = char === '{' ? '}' : ']'
    let depth = 0
    let i = index
    while (i < raw.length) {
      const current = raw[i]
      if (current === '"' || current === "'") {
        i = scanJsonString(raw, i, current)
        continue
      }
      if (current === '/' && raw[i + 1] === '/') {
        while (i < raw.length && raw[i] !== '\n') i += 1
        continue
      }
      if (current === '/' && raw[i + 1] === '*') {
        const end = raw.indexOf('*/', i + 2)
        i = end === -1 ? raw.length : end + 2
        continue
      }
      if (current === open) depth += 1
      else if (current === close) {
        depth -= 1
        if (depth === 0) return i + 1
      }
      i += 1
    }
    return raw.length
  }
  let i = index
  while (i < raw.length && !/[,}\]\s]/.test(raw[i])) i += 1
  return i
}

/** A key as the client wrote it: `"quoted"`, `'quoted'` or bare (JSON5). */
function readKey(raw: string, index: number): { name: string; end: number } | null {
  const char = raw[index]
  if (char === '"' || char === "'") {
    const end = scanJsonString(raw, index, char)
    const body = raw.slice(index + 1, Math.max(index + 1, end - 1))
    if (char === '"') {
      try {
        return { name: JSON.parse(raw.slice(index, end)) as string, end }
      } catch {
        return { name: body, end }
      }
    }
    return { name: body, end }
  }
  const match = /^[A-Za-z_$][\w$]*/.exec(raw.slice(index))
  if (match) return { name: match[0], end: index + match[0].length }
  return null
}

export interface JsonSpan {
  /** Offset of the key's opening quote. */
  keyStart: number
  /** Offsets of the value, comments/whitespace excluded. */
  valueStart: number
  valueEnd: number
  /** Offset of the object or array that contains this key, and of its closing brace. */
  containerStart: number
  containerEnd: number
}

/**
 * Locates `segments` in a JSON5/JSONC document without parsing it.
 *
 * The scanner understands strings, `//` and `/* *\/` comments; that is what lets an edit
 * replace one provider object while every other byte (comments included) stays put.
 */
export function jsonSpan(raw: string, segments: string[]): JsonSpan | null {
  if (segments.length === 0) return null
  let containerStart = skipTrivia(raw, 0)
  if (raw[containerStart] !== '{') return null
  let containerEnd = scanValueEnd(raw, containerStart)
  let cursor = containerStart + 1
  for (let depth = 0; depth < segments.length; depth += 1) {
    let found: JsonSpan | null = null
    let i = cursor
    while (i < containerEnd) {
      i = skipTrivia(raw, i)
      if (i >= containerEnd - 1) break
      const key = readKey(raw, i)
      if (key === null) break
      const colon = skipTrivia(raw, key.end)
      if (raw[colon] !== ':') break
      const valueStart = skipTrivia(raw, colon + 1)
      const valueEnd = scanValueEnd(raw, valueStart)
      if (key.name === segments[depth]) {
        found = { keyStart: i, valueStart, valueEnd, containerStart, containerEnd }
        break
      }
      i = valueEnd
    }
    if (!found) return null
    if (depth === segments.length - 1) return found
    const nextStart = skipTrivia(raw, found.valueStart)
    if (raw[nextStart] !== '{') return null
    containerStart = nextStart
    containerEnd = scanValueEnd(raw, nextStart)
    cursor = nextStart + 1
  }
  return null
}

/** Replaces the value at `segments`, keeping every other byte. */
export function replaceJsonValue(raw: string, segments: string[], value: unknown): string | null {
  const span = jsonSpan(raw, segments)
  if (!span) return null
  const indent = detectIndent(raw)
  const column = span.valueStart - (raw.lastIndexOf('\n', span.valueStart) + 1)
  const rendered = (JSON.stringify(value, null, indent) ?? 'null').replace(/\n/g, `\n${' '.repeat(column)}`)
  return raw.slice(0, span.valueStart) + rendered + raw.slice(span.valueEnd)
}

/**
 * Inserts `key: value` into the object at `parentSegments` (empty = document root).
 *
 * The object must already exist; callers that need a path created walk it one level at a
 * time with this function. Returns null when the location is not an object.
 */
export function insertJsonKey(
  raw: string,
  parentSegments: string[],
  key: string,
  value: unknown,
): string | null {
  let open: number
  let close: number
  if (parentSegments.length === 0) {
    open = skipTrivia(raw, 0)
    if (raw[open] !== '{') return null
    close = scanValueEnd(raw, open) - 1
  } else {
    const span = jsonSpan(raw, parentSegments)
    if (!span) return null
    open = skipTrivia(raw, span.valueStart)
    if (raw[open] !== '{') return null
    close = scanValueEnd(raw, open) - 1
  }
  if (raw[close] !== '}') return null
  const lineStart = raw.lastIndexOf('\n', open) + 1
  const baseIndent = /^[ \t]*/.exec(raw.slice(lineStart, open))?.[0] ?? ''
  const step = detectIndent(raw)
  const childIndent = `${baseIndent}${step}`
  const valueText = (JSON.stringify(value, null, step) ?? 'null').replace(/\n/g, `\n${childIndent}`)
  const entry = `${childIndent}${JSON.stringify(key)}: ${valueText}`
  const inner = raw.slice(open + 1, close)
  if (inner.trim() === '') {
    return raw.slice(0, open + 1) + `\n${entry}\n${baseIndent}` + raw.slice(close)
  }
  const insertAt = open + 1 + inner.trimEnd().length
  const trimmed = inner.trimEnd()
  const comma = trimmed === '' || trimmed.endsWith(',') ? '' : ','
  const tail = raw.slice(insertAt).replace(/^\s*/, '')
  return raw.slice(0, insertAt) + comma + `\n${entry}` + `\n${baseIndent}` + tail
}

/**
 * Makes sure an object exists at `segments`, creating intermediate objects as needed.
 * The document must be JSON/JSONC with an object root.
 */
export function ensureJsonObject(raw: string, segments: string[]): string | null {
  let current = raw
  for (let depth = 0; depth < segments.length; depth += 1) {
    const path = segments.slice(0, depth + 1)
    const span = jsonSpan(current, path)
    if (span) {
      const open = skipTrivia(current, span.valueStart)
      if (current[open] !== '{') return null
      continue
    }
    const inserted = insertJsonKey(current, segments.slice(0, depth), segments[depth], {})
    if (inserted === null) return null
    current = inserted
  }
  return current
}

// ---------------------------------------------------------------------------
// dotenv
// ---------------------------------------------------------------------------

export interface DotenvEdit {
  content: string
  before: Record<string, string | null>
}

function dotenvValue(raw: string): string {
  const text = raw.trim()
  if (text.startsWith('"')) {
    const match = /^"((?:[^"\\]|\\.)*)"/.exec(text)
    if (match) {
      try {
        return JSON.parse(`"${match[1]}"`) as string
      } catch {
        return match[1]
      }
    }
  }
  if (text.startsWith("'")) {
    const match = /^'([^']*)'/.exec(text)
    if (match) return match[1]
  }
  const comment = text.search(/\s#/)
  return (comment === -1 ? text : text.slice(0, comment)).trim()
}

function dotenvLiteral(value: string): string {
  return /[\s#'"]/.test(value) ? JSON.stringify(value) : value
}

/**
 * Sets keys in a dotenv file, first occurrence wins, duplicates dropped, `export ` kept.
 * Gemini CLI's own `.env` is the only user of this; it is read by a shell parser, so the
 * line shape matters more than the value.
 */
export function dotenvSet(raw: string, entries: [string, string][]): DotenvEdit {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const hadTrailing = raw === '' ? true : /(\r?\n)$/.test(raw)
  const lines = raw.split(/\r?\n/)
  if (hadTrailing && lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const before: Record<string, string | null> = {}
  for (const [key, value] of entries) {
    const pattern = new RegExp(`^\\s*(export\\s+)?${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(.*)$`)
    let seen = false
    before[key] = null
    for (let i = 0; i < lines.length; i += 1) {
      const match = pattern.exec(lines[i])
      if (!match) continue
      if (seen) {
        lines.splice(i, 1)
        i -= 1
        continue
      }
      seen = true
      before[key] = dotenvValue(match[2])
      const prefix = match[1] ?? ''
      if (before[key] !== value) lines[i] = `${prefix}${key}=${dotenvLiteral(value)}`
    }
    if (!seen) {
      before[key] = null
      lines.push(`${key}=${dotenvLiteral(value)}`)
    }
  }
  return { content: lines.join(eol) + (hadTrailing ? eol : ''), before }
}