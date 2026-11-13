/**
 * Pure decisions about repointing the six client families at one gateway.
 *
 * Free of Electron and `node:fs` so `node --test` can prove the surgery on real config
 * shapes: every writer here was written against a measured file, and the invariant that
 * matters is **everything we did not name stays byte-identical**. A Codex `config.toml`
 * carries `[desktop]`, `[mcp_servers.*]` and `[projects.*]` sections that have nothing to
 * do with the gateway; a Qoder `settings.json` carries plugin and MCP state. Reformatting
 * or reordering those is how a "switch gateway" button turns into a lost workspace.
 *
 * Two rules are enforced here rather than trusted to the caller:
 * - the canonical key travels as `KEY_PLACEHOLDER`, never as a value, so a plan can be
 *   shown to the page and logged without leaking it;
 * - model lists are **not** rewritten. Repointing an endpoint and choosing which models a
 *   client offers are different acts, and the second one needs a context window nobody
 *   measured. Names the target does not serve are reported (`unservedModels`) instead of
 *   silently renamed or dropped.
 */
import { join } from 'node:path'
import { KEY_PLACEHOLDER } from '../shared/clientSync.ts'
import type { ClientChange, ClientId } from '../shared/clientSync.ts'

export const CLIENT_LABELS: Record<ClientId, string> = {
  codex: 'Codex',
  claude: 'Claude Code / Claude Desktop',
  qoder: 'Qoder（国际）',
  'qoder-cn': 'Qoder CN',
  workbuddy: 'WorkBuddy（国际）',
  'codebuddy-cn': 'CodeBuddy CN（国内）',
  'trae-cn': 'Trae CN',
}

const CLIENT_IDS = Object.keys(CLIENT_LABELS) as ClientId[]

/** The page names ids, so the id list is a gate: anything else is refused, not resolved. */
export function isClientId(value: string): value is ClientId {
  return (CLIENT_IDS as string[]).includes(value)
}

export interface ClientPaths {
  codexConfig: string
  codexCatalog: string
  claudeSettings: string
  qoder: string
  qoderCn: string
  workbuddy: string
  codeBuddyCn: string
  traeCn: string
}

/**
 * Where each client keeps the endpoint we rewrite. Pure so the layout can be tested
 * without a machine: `home` and `appData` come from Electron, `claudeConfigDir` from the
 * environment contract read out of Claude Desktop's own bundle
 * (`process.env.CLAUDE_CONFIG_DIR || homedir()`).
 */
export function clientPaths(home: string, appData: string, claudeConfigDir: string | undefined): ClientPaths {
  const claudeBase = claudeConfigDir && claudeConfigDir.trim() !== '' ? claudeConfigDir.trim() : join(home, '.claude')
  return {
    codexConfig: join(home, '.codex', 'config.toml'),
    codexCatalog: join(home, '.codex', 'modelport-catalog.json'),
    claudeSettings: join(claudeBase, 'settings.json'),
    qoder: join(home, '.qoder', 'settings.json'),
    qoderCn: join(home, '.qoder-cn', 'settings.json'),
    workbuddy: join(home, '.workbuddy', 'models.json'),
    codeBuddyCn: join(appData, 'CodeBuddy CN', 'User', 'settings.json'),
    traeCn: join(appData, 'Trae CN', 'User', 'globalStorage', 'state.vscdb'),
  }
}

export type PlanResult =
  | { kind: 'changed'; content: string; changes: ClientChange[] }
  | { kind: 'unchanged' }
  /** The client is installed but has no endpoint entry of ours to update in place. */
  | { kind: 'no-entry'; reason: string }
  /** The store exists and is not something we can edit without guessing. */
  | { kind: 'bad-input'; reason: string }

/** `sk-e5b…7efc8ed4ce87` - enough to recognize a key, never enough to use one. */
export function maskSecret(key: string): string {
  if (key === '') return ''
  if (key.length <= 14) return `<len${key.length}>`
  return `${key.slice(0, 6)}…${key.slice(-8)}`
}

/**
 * The endpoint shapes differ per client and were measured, not assumed:
 * Codex / Qoder / WorkBuddy / CodeBuddy take a base ending in `/v1`, TRAE takes the whole
 * chat-completions URL, and Claude takes the bare origin (its SDK appends `/v1/messages`).
 */
export type EndpointShape = 'v1' | 'chat-completions' | 'origin'

export function endpointFor(origin: string, shape: EndpointShape): string {
  const base = origin.replace(/\/+$/, '')
  if (shape === 'origin') return base
  if (shape === 'chat-completions') return `${base}/v1/chat/completions`
  return `${base}/v1`
}

/** Keeps a JSON edit from reformatting the whole file: match the indent already in use. */
export function detectIndent(raw: string): string {
  const match = /\n([ \t]+)\S/.exec(raw)
  return match ? match[1] : '  '
}

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function changed(content: string, changes: ClientChange[]): PlanResult {
  return changes.length === 0 ? { kind: 'unchanged' } : { kind: 'changed', content, changes }
}

/** Records a field edit only when the value actually differs, so re-running is a no-op. */
function field(changes: ClientChange[], label: string, before: unknown, after: string): boolean {
  const previous = typeof before === 'string' ? before : null
  if (previous === after) return false
  changes.push({ label, before: previous, after })
  return true
}

// ---------------------------------------------------------------------------
// TOML (Codex)
// ---------------------------------------------------------------------------

/** A table header line, `[x]` or `[[x]]`, with optional trailing comment. */
function isHeader(line: string): boolean {
  return /^\s*\[\[?[^\]]+\]\]?\s*(#.*)?$/.test(line)
}

function headerName(line: string): string {
  const match = /^\s*\[\[?([^\]]+)\]\]?/.exec(line)
  return match ? match[1].trim() : ''
}

/** `[start, end)` of a table's body; `null` for the top level means "before the first header". */
function tableRange(lines: string[], table: string | null): [number, number] | null {
  if (table === null) {
    const first = lines.findIndex(isHeader)
    return [0, first === -1 ? lines.length : first]
  }
  const start = lines.findIndex(line => isHeader(line) && headerName(line) === table)
  if (start === -1) return null
  let end = start + 1
  while (end < lines.length && !isHeader(lines[end])) end += 1
  return [start + 1, end]
}

function keyLineIndex(lines: string[], start: number, end: number, key: string): number {
  const pattern = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`)
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

/**
 * Sets one single-line string key inside a table, inserting it when absent.
 *
 * Only single-line values are touched: a multi-line array (`notify = [ … ]` spanning
 * lines) would be corrupted by a line replacement, so the caller is told instead.
 */
function setTomlString(
  lines: string[],
  table: string | null,
  key: string,
  value: string,
): { ok: boolean; before: string | null } {
  const range = tableRange(lines, table)
  if (!range) return { ok: false, before: null }
  const [start, end] = range
  const index = keyLineIndex(lines, start, end, key)
  const literal = `${key} = "${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  if (index === -1) {
    // Insert at the end of the table body, before the blank line that separates tables.
    let at = end
    while (at > start && lines[at - 1].trim() === '') at -= 1
    lines.splice(at, 0, literal)
    return { ok: true, before: null }
  }
  const before = readTomlString(lines, table, key)
  if (before === null) {
    // Present but not a single-line string: refuse rather than mangle it.
    return { ok: false, before: null }
  }
  if (before === value) return { ok: true, before }
  const indent = /^\s*/.exec(lines[index])?.[0] ?? ''
  lines[index] = `${indent}${literal}`
  return { ok: true, before }
}

export interface CodexPlanInput {
  origin: string
  /** Route names the target gateway serves (`GET /v1/models`). */
  routeNames: string[]
  /** The provider table this console owns. */
  providerTable?: string
}

/**
 * Codex: repoint `[model_providers.modelport]` and keep the selected model servable.
 *
 * `model_catalog_json` is deliberately untouched. It must stay a bare file name resolved
 * against CODEX_HOME (measured 2026-11-12: a `C:\…` path breaks the WSL-mode core, a
 * `/mnt/c/…` path breaks the Windows-native core), and the catalog's entries carry a
 * `comp_hash` whose derivation is not public - cloning one would be a guess.
 */
export function planCodexToml(raw: string, input: CodexPlanInput): PlanResult {
  const table = input.providerTable ?? 'model_providers.modelport'
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.split(/\r?\n/)
  if (!tableRange(lines, table)) {
    return { kind: 'no-entry', reason: `config.toml 里没有 [${table}] 这一段` }
  }
  const changes: ClientChange[] = []
  const url = endpointFor(input.origin, 'v1')
  const urlEdit = setTomlString(lines, table, 'base_url', url)
  if (!urlEdit.ok) return { kind: 'bad-input', reason: `[${table}] 的 base_url 不是单行字符串，拒绝改写` }
  field(changes, `${table}.base_url`, urlEdit.before, url)

  const providerEdit = setTomlString(lines, null, 'model_provider', 'modelport')
  if (providerEdit.ok) field(changes, 'model_provider', providerEdit.before, 'modelport')

  // A model the target does not serve would 503 on the first turn, so the selection has
  // to move with the endpoint. `auto` is preferred because it is the gateway's own
  // router; otherwise the first advertised route.
  const current = readTomlString(lines, null, 'model')
  if (current !== null && input.routeNames.length > 0 && !input.routeNames.includes(current)) {
    const next = input.routeNames.includes('auto') ? 'auto' : input.routeNames[0]
    const edit = setTomlString(lines, null, 'model', next)
    if (edit.ok) field(changes, 'model', current, next)
  }

  return changed(lines.join(eol), changes)
}

/** The catalog's slugs, for reporting which of them the target actually serves. */
export function catalogSlugs(raw: string): string[] | null {
  const parsed = parseObject(raw)
  const models = parsed?.models
  if (!Array.isArray(models)) return null
  return models
    .map(entry => (entry !== null && typeof entry === 'object' ? (entry as { slug?: unknown }).slug : null))
    .filter((slug): slug is string => typeof slug === 'string')
}

// ---------------------------------------------------------------------------
// JSON clients
// ---------------------------------------------------------------------------

export interface JsonPlanInput {
  origin: string
  /** False for clients whose key lives in encrypted storage (TRAE, CodeBuddy). */
  writeKey: boolean
}

/**
 * Qoder / Qoder CN: `providers` is an object keyed by `qoder-custom-<uuid>`, one model
 * per entry. Every OpenAI-compatible entry is repointed; the uuid, display name, model
 * list and the user's own `contextWindow` are left exactly as they were, because
 * replacing the key would drop the client's selection state.
 */
export function planQoderSettings(raw: string, input: JsonPlanInput): PlanResult {
  const parsed = parseObject(raw)
  if (!parsed) return { kind: 'bad-input', reason: 'settings.json 不是可解析的 JSON 对象' }
  const providers = parsed.providers
  if (providers === null || typeof providers !== 'object' || Array.isArray(providers)) {
    return { kind: 'no-entry', reason: 'settings.json 里没有 providers' }
  }
  const entries = Object.entries(providers as Record<string, unknown>).filter(
    ([, value]) => value !== null && typeof value === 'object' && (value as { type?: unknown }).type === 'openai-compatible',
  )
  if (entries.length === 0) return { kind: 'no-entry', reason: 'providers 里没有 openai-compatible 条目' }

  const changes: ClientChange[] = []
  const url = endpointFor(input.origin, 'v1')
  const next: Record<string, unknown> = { ...(providers as Record<string, unknown>) }
  for (const [id, value] of entries) {
    const entry = { ...(value as Record<string, unknown>) }
    const short = id.replace(/^qoder-custom-/, '').slice(0, 8)
    if (field(changes, `${short}.baseUrl`, entry.baseUrl, url)) entry.baseUrl = url
    if (input.writeKey && field(changes, `${short}.apiKey`, maskSecret(String(entry.apiKey ?? '')), KEY_PLACEHOLDER)) {
      entry.apiKey = KEY_PLACEHOLDER
    }
    next[id] = entry
  }
  if (changes.length === 0) return { kind: 'unchanged' }
  return changed(
    JSON.stringify({ ...parsed, providers: next }, null, detectIndent(raw)) + '\n',
    changes,
  )
}

/**
 * WorkBuddy: `models.json` is an array. Only `vendor: "Custom"` rows are ours - the
 * direct DeepSeek row keeps its own URL and its own 35-char key.
 */
export function planWorkBuddyModels(raw: string, input: JsonPlanInput): PlanResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: 'bad-input', reason: 'models.json 不是可解析的 JSON' }
  }
  if (!Array.isArray(parsed)) return { kind: 'bad-input', reason: 'models.json 不是数组' }
  const changes: ClientChange[] = []
  const url = endpointFor(input.origin, 'v1')
  let touched = 0
  const next = parsed.map(value => {
    if (value === null || typeof value !== 'object') return value
    const entry = value as Record<string, unknown>
    if (entry.vendor !== 'Custom') return value
    touched += 1
    const copy = { ...entry }
    const label = typeof entry.id === 'string' ? entry.id : `#${touched}`
    if (field(changes, `${label}.url`, entry.url, url)) copy.url = url
    if (input.writeKey && field(changes, `${label}.apiKey`, maskSecret(String(entry.apiKey ?? '')), KEY_PLACEHOLDER)) {
      copy.apiKey = KEY_PLACEHOLDER
    }
    return copy
  })
  if (touched === 0) return { kind: 'no-entry', reason: 'models.json 里没有 vendor 为 Custom 的条目' }
  return changed(JSON.stringify(next, null, detectIndent(raw)) + '\n', changes)
}

/**
 * Claude Code / Claude Desktop: `env` in `settings.json`.
 *
 * The config dir is `CLAUDE_CONFIG_DIR` when set, otherwise `~/.claude` - the contract
 * read out of Desktop's own bundle (`process.env.CLAUDE_CONFIG_DIR || homedir()`).
 * Desktop bundles Claude Code, so one file serves both. The file may not exist yet on a
 * machine that has never run the CLI; creating it is not "adding a model entry", it is
 * the config file itself.
 *
 * No model name is written: the gateway's `anthropicInbound` maps whatever Claude sends
 * to a route (`defaultModel`, `auto` when unset), so inventing one here would only fight
 * that mapping.
 */
export function planClaudeSettings(raw: string | null, input: JsonPlanInput): PlanResult {
  const parsed = raw === null ? {} : parseObject(raw)
  if (!parsed) return { kind: 'bad-input', reason: 'settings.json 不是可解析的 JSON 对象' }
  const envRaw = parsed.env
  const env: Record<string, unknown> =
    envRaw !== null && typeof envRaw === 'object' && !Array.isArray(envRaw) ? { ...(envRaw as Record<string, unknown>) } : {}
  const changes: ClientChange[] = []
  const url = endpointFor(input.origin, 'origin')
  if (field(changes, 'env.ANTHROPIC_BASE_URL', env.ANTHROPIC_BASE_URL, url)) env.ANTHROPIC_BASE_URL = url
  if (input.writeKey && field(changes, 'env.ANTHROPIC_AUTH_TOKEN', maskSecret(String(env.ANTHROPIC_AUTH_TOKEN ?? '')), KEY_PLACEHOLDER)) {
    env.ANTHROPIC_AUTH_TOKEN = KEY_PLACEHOLDER
  }
  if (changes.length === 0) return { kind: 'unchanged' }
  const indent = raw === null ? '  ' : detectIndent(raw)
  return changed(JSON.stringify({ ...parsed, env }, null, indent) + '\n', changes)
}

/**
 * CodeBuddy CN: `oaicopilot.baseUrl` in the VSCode-fork `settings.json`.
 *
 * The key is not here - it lives in the fork's encrypted secret storage - so this writer
 * repoints the endpoint only and the row carries a manual step, exactly like TRAE.
 * `CodeBuddy.settings.api` in `state.vscdb` is a *different*, unused provider slot
 * (`apiKey: ""`, `apiProvider: "openai"`); filling it would switch the client into another
 * mode rather than repoint the one in use, so it is left alone.
 */
export function planCodeBuddySettings(raw: string, input: JsonPlanInput): PlanResult {
  const parsed = parseObject(raw)
  if (!parsed) return { kind: 'bad-input', reason: 'settings.json 不是可解析的 JSON 对象' }
  if (!('oaicopilot.baseUrl' in parsed)) {
    return { kind: 'no-entry', reason: 'settings.json 里没有 oaicopilot.baseUrl' }
  }
  const changes: ClientChange[] = []
  const url = endpointFor(input.origin, 'v1')
  const next = { ...parsed }
  if (field(changes, 'oaicopilot.baseUrl', parsed['oaicopilot.baseUrl'], url)) next['oaicopilot.baseUrl'] = url
  return changed(JSON.stringify(next, null, detectIndent(raw)) + '\n', changes)
}

/**
 * TRAE / TRAE CN: one `model_list_map` ItemTable value.
 *
 * Measured shape: an object keyed by agent label (`solo_agent`, `agent`, `assistant`,
 * `chat`, `builder`, …), each an array of model descriptors, and the *same* custom model
 * repeated in every label it is offered to. The row key itself is account-prefixed
 * (`<accountId>:AI.agent.model.model_list_map`, and a second `<accountId>_…` variant), so
 * the caller passes each value it found and this function rewrites all of them.
 *
 * Only `base_url` moves. `ak` is app-encrypted (108 base64 chars = 79 bytes = a 51-char
 * key + 12-byte IV + 16-byte tag) and cannot be minted; `name` is
 * `custom_openai_compatible//<display_name>`, so keeping the display name keeps the name
 * and the `custom_model_id` - which is what preserves the user's selection.
 */
export function planTraeModelList(raw: string, input: JsonPlanInput): PlanResult {
  const parsed = parseObject(raw)
  if (!parsed) return { kind: 'bad-input', reason: 'model_list_map 不是可解析的 JSON 对象' }
  const changes: ClientChange[] = []
  const url = endpointFor(input.origin, 'chat-completions')
  const next: Record<string, unknown> = {}
  let touched = 0
  for (const [label, value] of Object.entries(parsed)) {
    if (!Array.isArray(value)) {
      next[label] = value
      continue
    }
    next[label] = value.map(item => {
      if (item === null || typeof item !== 'object') return item
      const entry = item as Record<string, unknown>
      if (entry.provider !== 'custom_openai_compatible') return item
      touched += 1
      if (entry.base_url === url) return item
      const copy = { ...entry, base_url: url }
      // One line per model, not per label: the same model appears in a dozen labels and
      // a dozen identical rows would bury the one fact the user needs to check.
      const name = typeof entry.display_name === 'string' ? entry.display_name : String(entry.name ?? '')
      if (!changes.some(change => change.label === name)) {
        changes.push({ label: name, before: typeof entry.base_url === 'string' ? entry.base_url : null, after: url })
      }
      return copy
    })
  }
  if (touched === 0) return { kind: 'no-entry', reason: 'model_list_map 里没有 custom_openai_compatible 模型' }
  return changed(JSON.stringify(next), changes)
}

/**
 * Which of the client's current model names the target does not serve.
 *
 * Reported, never "fixed": renaming a model changes what the client sends and, in TRAE,
 * is coupled to `custom_model_id`. An empty list means the switch is complete.
 */
export function unservedModels(current: string[], routeNames: string[]): string[] {
  if (routeNames.length === 0) return []
  const served = new Set(routeNames)
  return [...new Set(current.filter(name => name !== '' && !served.has(name)))]
}