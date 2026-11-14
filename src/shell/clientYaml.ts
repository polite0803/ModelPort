/**
 * Line-scoped YAML editing for the clients whose config is YAML.
 *
 * Same principle as `clientToml.ts`: the document is never parsed and re-emitted, because
 * that would drop comments, anchors and every key we did not name. Instead the editors
 * here locate one block by indentation, render only that block from a plain object, and
 * splice it in. That is exactly what the reference implementation does for Hermes and
 * MCode (their own writers lose comments *inside* the rewritten entry, and so do we).
 *
 * Only the subset these configs use is supported: mappings, sequences of scalars and
 * sequences of mappings. A block scalar (`|`, `>`) or an anchor in the way of an edit is
 * reported as uneditable rather than guessed at.
 */

const BOOLEAN_LIKE = /^(?:true|false|yes|no|on|off|null|nil|~|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)$/i

/** Double-quotes a scalar only when a plain one would change meaning. */
export function yamlScalar(value: string): string {
  if (value === '') return '""'
  if (BOOLEAN_LIKE.test(value)) return JSON.stringify(value)
  // A plain scalar may contain `:` as long as it is not followed by a space (or at the
  // end), which is exactly the shape every URL in these files has.
  if (/^[\s#&*!|>%@`'"{[,\]}:-]/.test(value)) return JSON.stringify(value)
  if (/:\s|:$|\s#|[\n\r\t]/.test(value) || /\s$/.test(value)) return JSON.stringify(value)
  return value
}

function unquoteScalar(raw: string): string {
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
    const match = /^'((?:[^']|'')*)'/.exec(text)
    if (match) return match[1].replace(/''/g, "'")
  }
  const comment = text.search(/\s#/)
  return (comment === -1 ? text : text.slice(0, comment)).trim()
}

/** Value of the first `key:` line anywhere in the text, unquoted. */
export function readYamlScalar(text: string, key: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const match = new RegExp(`^\\s*-?\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*(.*)$`).exec(line)
    if (match) return unquoteScalar(match[1])
  }
  return null
}

/**
 * What the editors accept: any JSON-shaped value. Leaves are rendered as scalars, so a
 * caller can hand over a `Record<string, unknown>` it read from a client config without
 * casting every level.
 */
type YamlValue = unknown

function isMap(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Renders the subset of YAML these config files use. */
export function emitYaml(value: YamlValue, indent = 0): string[] {
  const pad = ' '.repeat(indent)
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}[]`]
    const lines: string[] = []
    for (const item of value) {
      if (isMap(item)) lines.push(...emitSeqItem(item, indent))
      else if (Array.isArray(item)) lines.push(...emitYaml(item, indent + 2).map(line => `${pad}- ${line.trimStart()}`))
      else lines.push(`${pad}- ${scalarOf(item)}`)
    }
    return lines
  }
  if (!isMap(value)) return [`${pad}${scalarOf(value)}`]
  const lines: string[] = []
  for (const [key, child] of Object.entries(value)) {
    if (child === null) {
      lines.push(`${pad}${yamlKey(key)}: null`)
    } else if (Array.isArray(child)) {
      if (child.length === 0) lines.push(`${pad}${yamlKey(key)}: []`)
      else if (child.every(item => !isMap(item) && !Array.isArray(item))) {
        lines.push(`${pad}${yamlKey(key)}:`)
        for (const item of child) lines.push(`${pad}  - ${scalarOf(item)}`)
      } else {
        lines.push(`${pad}${yamlKey(key)}:`)
        for (const item of child) {
          if (isMap(item)) lines.push(...emitSeqItem(item, indent + 2))
          else lines.push(`${pad}  - ${scalarOf(item)}`)
        }
      }
    } else if (isMap(child)) {
      lines.push(`${pad}${yamlKey(key)}:`)
      lines.push(...emitYaml(child, indent + 2))
    } else {
      lines.push(`${pad}${yamlKey(key)}: ${scalarOf(child)}`)
    }
  }
  return lines
}

function emitSeqItem(item: { [key: string]: YamlValue }, indent: number): string[] {
  const pad = ' '.repeat(indent)
  const entries = Object.entries(item)
  if (entries.length === 0) return [`${pad}- {}`]
  const lines: string[] = []
  entries.forEach(([key, child], index) => {
    const prefix = index === 0 ? `${pad}- ` : `${pad}  `
    if (child === null) {
      lines.push(`${prefix}${yamlKey(key)}: null`)
    } else if (Array.isArray(child)) {
      if (child.length === 0) lines.push(`${prefix}${yamlKey(key)}: []`)
      else if (child.every(entry => !isMap(entry) && !Array.isArray(entry))) {
        lines.push(`${prefix}${yamlKey(key)}:`)
        for (const entry of child) lines.push(`${prefix}  - ${scalarOf(entry)}`)
      } else {
        lines.push(`${prefix}${yamlKey(key)}:`)
        for (const entry of child) {
          if (isMap(entry)) lines.push(...emitSeqItem(entry, indent + 4))
          else lines.push(`${prefix}  - ${scalarOf(entry)}`)
        }
      }
    } else if (isMap(child)) {
      lines.push(`${prefix}${yamlKey(key)}:`)
      lines.push(...emitYaml(child, indent + 4))
    } else {
      lines.push(`${prefix}${yamlKey(key)}: ${scalarOf(child)}`)
    }
  })
  return lines
}

function scalarOf(value: YamlValue): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  return yamlScalar(String(value))
}

function yamlKey(key: string): string {
  return /^[A-Za-z0-9_.-]+$/.test(key) ? key : yamlScalar(key)
}

interface ScanLine {
  text: string
  blank: boolean
  indent: number
}

function scan(raw: string): { lines: string[]; eol: string } {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  return { lines: raw.split(/\r?\n/), eol }
}

function scanLine(text: string): ScanLine {
  const blank = text.trim() === ''
  return { text, blank, indent: blank ? 0 : (/^ */.exec(text)?.[0].length ?? 0) }
}

/** `[start, end)` of a top-level `key:` block, comments and blanks inside included. */
export function topBlockRange(lines: string[], key: string): [number, number] | null {
  const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`)
  const start = lines.findIndex(line => pattern.test(line))
  if (start === -1) return null
  let end = start + 1
  while (end < lines.length) {
    const line = scanLine(lines[end])
    if (!line.blank && line.indent === 0) break
    end += 1
  }
  return [start, end]
}

function trimTrailingBlanks(lines: string[], start: number, end: number): number {
  let at = end
  while (at > start + 1 && lines[at - 1].trim() === '') at -= 1
  return at
}

/** Replaces a top-level block, or appends it when absent. Returns the new document. */
export function setTopBlock(raw: string, key: string, value: YamlValue): string {
  const { lines, eol } = scan(raw)
  const rendered = [`${yamlKey(key)}:`]
  if (isMap(value)) rendered.push(...emitYaml(value, 2))
  else rendered[0] = `${yamlKey(key)}: ${scalarOf(value)}`
  const range = topBlockRange(lines, key)
  if (range) {
    const end = trimTrailingBlanks(lines, range[0], range[1])
    lines.splice(range[0], end - range[0], ...rendered)
  } else {
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
    if (lines.length > 0) lines.push('')
    lines.push(...rendered)
  }
  return lines.join(eol) + eol
}

export function removeTopBlock(raw: string, key: string): string {
  const { lines, eol } = scan(raw)
  const range = topBlockRange(lines, key)
  if (!range) return raw
  const end = trimTrailingBlanks(lines, range[0], range[1])
  const dropStart = range[0] > 0 && lines[range[0] - 1].trim() === '' ? range[0] - 1 : range[0]
  lines.splice(dropStart, end - dropStart)
  return lines.join(eol) + eol
}

/** The text of a top-level block, header included; null when absent. */
export function readTopBlock(raw: string, key: string): string | null {
  const { lines } = scan(raw)
  const range = topBlockRange(lines, key)
  if (!range) return null
  const end = trimTrailingBlanks(lines, range[0], range[1])
  return lines.slice(range[0], end).join('\n')
}

function childRange(lines: string[], parent: [number, number], key: string): [number, number] | null {
  const body = lines.slice(parent[0] + 1, parent[1])
  const first = body.find(line => line.trim() !== '' && !line.trim().startsWith('#'))
  const childIndent = first ? (/^ */.exec(first)?.[0].length ?? 0) : 2
  const pattern = new RegExp(`^ {${childIndent}}${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`)
  for (let i = parent[0] + 1; i < parent[1]; i += 1) {
    if (!pattern.test(lines[i])) continue
    let end = i + 1
    while (end < parent[1]) {
      const line = scanLine(lines[end])
      if (!line.blank && line.indent <= childIndent) break
      end += 1
    }
    return [i, end]
  }
  return null
}

/** Replaces `parent.child:` inside a top-level block, creating the parent when needed. */
export function setChildBlock(raw: string, parent: string, child: string, value: YamlValue): string {
  const { lines, eol } = scan(raw)
  const parentRange = topBlockRange(lines, parent)
  if (!parentRange) {
    return setTopBlock(raw, parent, { [child]: value })
  }
  const body = lines.slice(parentRange[0] + 1, parentRange[1])
  const first = body.find(line => line.trim() !== '' && !line.trim().startsWith('#'))
  const childIndent = first ? (/^ */.exec(first)?.[0].length ?? 0) : 2
  const rendered = [`${' '.repeat(childIndent)}${yamlKey(child)}:`]
  if (isMap(value)) rendered.push(...emitYaml(value, childIndent + 2))
  else rendered[0] = `${' '.repeat(childIndent)}${yamlKey(child)}: ${scalarOf(value)}`
  const range = childRange(lines, parentRange, child)
  if (range) {
    const end = trimTrailingBlanks(lines, range[0], range[1])
    lines.splice(range[0], end - range[0], ...rendered)
  } else {
    let at = parentRange[1]
    while (at > parentRange[0] + 1 && lines[at - 1].trim() === '') at -= 1
    lines.splice(at, 0, ...rendered)
  }
  return lines.join(eol) + eol
}

export function removeChildBlock(raw: string, parent: string, child: string): string {
  const { lines, eol } = scan(raw)
  const parentRange = topBlockRange(lines, parent)
  if (!parentRange) return raw
  const range = childRange(lines, parentRange, child)
  if (!range) return raw
  const end = trimTrailingBlanks(lines, range[0], range[1])
  lines.splice(range[0], end - range[0])
  return lines.join(eol) + eol
}

export function readChildBlock(raw: string, parent: string, child: string): string | null {
  const { lines } = scan(raw)
  const parentRange = topBlockRange(lines, parent)
  if (!parentRange) return null
  const range = childRange(lines, parentRange, child)
  if (!range) return null
  const end = trimTrailingBlanks(lines, range[0], range[1])
  return lines.slice(range[0], end).join('\n')
}

/** `[start, end)` of one `- ` item in a sequence block, matched by a scalar field. */
export function seqItemRange(
  lines: string[],
  list: [number, number],
  matchKey: string,
  matchValue: string,
): [number, number] | null {
  const body = lines.slice(list[0] + 1, list[1])
  const first = body.find(line => line.trim() !== '' && !line.trim().startsWith('#'))
  const itemIndent = first ? (/^ */.exec(first)?.[0].length ?? 0) : 0
  const dash = new RegExp(`^ {${itemIndent}}-\\s`)
  const field = new RegExp(`^\\s*-?\\s*${matchKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*(.*)$`)
  for (let i = list[0] + 1; i < list[1]; i += 1) {
    if (!dash.test(lines[i])) continue
    let end = i + 1
    while (end < list[1] && !(dash.test(lines[end]))) end += 1
    const text = lines.slice(i, end).join('\n')
    if (field.test(text) && readYamlScalar(text, matchKey) === matchValue) return [i, end]
  }
  return null
}

/**
 * Replaces (or appends) one item of a top-level or root sequence, rendered from `item`.
 * `list` null means the document itself is the sequence.
 */
export function setSeqItem(
  raw: string,
  list: string | null,
  matchKey: string,
  matchValue: string,
  item: { [key: string]: unknown },
): string {
  const { lines, eol } = scan(raw)
  const range: [number, number] = list === null ? [0, lines.length] : (topBlockRange(lines, list) ?? [-1, -1])
  // The item indent is the first content line of the list body, not of the document:
  // appending at column 0 under an indented list would end the block and corrupt the file.
  const body = lines.slice(list === null ? 0 : range[0] + 1, range[1])
  const first = body.find(line => line.trim() !== '' && !line.trim().startsWith('#'))
  const itemIndent = list === null ? 0 : first ? (/^ */.exec(first)?.[0].length ?? 0) : 2
  const rendered = emitSeqItem(item, itemIndent)
  if (range[0] !== -1) {
    const found =
      list === null ? rootSeqItemRange(lines, matchKey, matchValue) : seqItemRange(lines, range, matchKey, matchValue)
    if (found) {
      const end = trimTrailingBlanks(lines, found[0], found[1])
      lines.splice(found[0], end - found[0], ...rendered)
      return lines.join(eol) + eol
    }
  }
  if (list === null) {
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
    lines.push(...rendered)
    return lines.join(eol) + eol
  }
  if (range[0] === -1) {
    // No list at all: create it with our single item.
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
    if (lines.length > 0) lines.push('')
    lines.push(`${yamlKey(list)}:`, ...rendered)
    return lines.join(eol) + eol
  }
  let at = range[1]
  while (at > range[0] + 1 && lines[at - 1].trim() === '') at -= 1
  lines.splice(at, 0, ...rendered)
  return lines.join(eol) + eol
}

/** YAML 1.2 `null`/`~`/empty and an absent key all read as null. */
export function yamlNull(value: string | null): boolean {
  return value === null || value === '' || value === '~' || value.toLowerCase() === 'null'
}

export function yamlBoolean(value: string | null): boolean | null {
  if (value === null) return null
  const text = value.toLowerCase()
  if (text === 'true' || text === 'yes' || text === 'on') return true
  if (text === 'false' || text === 'no' || text === 'off') return false
  return null
}

/**
 * The text of `path[0].path[1]…`, or null when the path does not exist. Used to compare
 * the copies of one provider across DeepSeek Harness profiles before overwriting any.
 */
export function readNestedBlock(raw: string, path: string[]): string | null {
  const { lines, eol } = scan(raw)
  const range = topBlockRange(lines, path[0])
  if (!range) return null
  const end = trimTrailingBlanks(lines, range[0], range[1])
  const block = lines.slice(range[0], end)
  if (path.length === 1) return block.join(eol)
  const body = lines.slice(range[0] + 1, end)
  const first = body.find(line => line.trim() !== '')
  const indent = first ? (/^ */.exec(first)?.[0].length ?? 0) : 2
  const dedented = body.map(line => (line.trim() === '' ? '' : line.slice(Math.min(indent, line.length))))
  return readNestedBlock(dedented.join(eol) + eol, path.slice(1))
}

/** `[start, end)` of a root-level sequence item (`- id: x` at column 0). */
export function rootSeqItemRange(
  lines: string[],
  matchKey: string,
  matchValue: string,
): [number, number] | null {
  const field = new RegExp(`^\\s*-?\\s*${matchKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`)
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^-/.test(lines[i])) continue
    let end = i + 1
    while (end < lines.length && !/^-/.test(lines[end])) end += 1
    const text = lines.slice(i, end).join('\n')
    if (field.test(text) && readYamlScalar(text, matchKey) === matchValue) return [i, end]
  }
  return null
}

function renderBlock(key: string, value: YamlValue, indent: number): string[] {
  const pad = ' '.repeat(indent)
  if (isMap(value) || Array.isArray(value)) {
    return [`${pad}${yamlKey(key)}:`, ...emitYaml(value, indent + 2)]
  }
  return [`${pad}${yamlKey(key)}: ${scalarOf(value)}`]
}

function nest(path: string[], value: YamlValue): YamlValue {
  let current: YamlValue = value
  for (let i = path.length - 1; i >= 1; i -= 1) current = { [path[i]]: current }
  return current
}

/**
 * Sets `path[0].path[1]…` in a document, creating missing levels and keeping every other
 * line (and its comments) untouched. Used by the DeepSeek Harness writer, whose provider
 * entry sits under `config.providers.<id>` inside a sequence item.
 */
export function setNestedBlock(raw: string, path: string[], value: YamlValue): string {
  const { lines, eol } = scan(raw)
  const range = topBlockRange(lines, path[0])
  if (!range) {
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
    if (lines.length > 0) lines.push('')
    if (path.length === 1) lines.push(...renderBlock(path[0], value, 0))
    else lines.push(...renderBlock(path[0], nest(path.slice(1), value), 0))
    return lines.join(eol) + eol
  }
  if (path.length === 1) {
    const end = trimTrailingBlanks(lines, range[0], range[1])
    lines.splice(range[0], end - range[0], ...renderBlock(path[0], value, 0))
    return lines.join(eol) + eol
  }
  const end = trimTrailingBlanks(lines, range[0], range[1])
  const body = lines.slice(range[0] + 1, end)
  const first = body.find(line => line.trim() !== '')
  const indent = first ? (/^ */.exec(first)?.[0].length ?? 0) : 2
  const dedented = body.map(line => (line.trim() === '' ? '' : line.slice(Math.min(indent, line.length))))
  const inner = setNestedBlock(dedented.join(eol) + eol, path.slice(1), value)
  const innerLines = inner.split(/\r?\n/)
  if (innerLines.length > 0 && innerLines[innerLines.length - 1] === '') innerLines.pop()
  const reindented = innerLines.map(line => (line === '' ? '' : ' '.repeat(indent) + line))
  lines.splice(range[0] + 1, end - (range[0] + 1), ...reindented)
  return lines.join(eol) + eol
}