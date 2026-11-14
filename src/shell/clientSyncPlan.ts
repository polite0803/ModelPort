/**
 * Pure decisions about repointing the six client families at one gateway.
 *
 * Free of Electron and `node:fs` so `node --test` can prove the surgery on real config
 * shapes: every writer here was written against a measured file, and the invariant that
 * matters is **everything we did not name stays byte-identical**. A Codex `config.toml`
 * carries `[desktop]`, `[mcp_servers.*]` and `[projects.*]` sections that have nothing to
 * do with the gateway; a CodeBuddy CN `settings.json` carries the rest of the fork's settings. Reformatting
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
import path from 'node:path'
import { KEY_PLACEHOLDER } from '../shared/clientSync.ts'
import type { ClientChange, ClientId } from '../shared/clientSync.ts'
import { detectIndent, parseJsonObject } from './clientFormats.ts'
import {
  appendTomlTable,
  hasTomlTable,
  joinToml,
  readTomlString,
  removeTomlKey,
  setTomlString,
  splitToml,
  tomlStringLiteral,
} from './clientToml.ts'

export { detectIndent } from './clientFormats.ts'
export { readTomlString } from './clientToml.ts'

export const CLIENT_LABELS: Record<ClientId, string> = {
  codex: 'Codex',
  claude: 'Claude Code',
  'claude-desktop': 'Claude Desktop',
  gemini: 'Gemini CLI',
  grokbuild: 'Grok Build',
  opencode: 'OpenCode',
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
  kimi: 'Kimi Code',
  mcode: 'MiniMax Code',
  dsh: 'DeepSeek Harness',
  omp: 'Oh My Pi',
  pi: 'Pi',
  copilot: 'GitHub Copilot CLI',
  agy: 'Antigravity CLI',
  qoder: 'Qoder（国际）',
  'qoder-cn': 'Qoder CN',
  workbuddy: 'WorkBuddy（国际）',
  'codebuddy-cn': 'CodeBuddy CN（国内）',
  'trae-cn': 'Trae CN',
}

/** The profile Claude Desktop is given by this console; stable so re-runs update it. */
export const CLAUDE_DESKTOP_PROFILE_ID = '3f0a5c62-9c1e-4d7b-9a55-6d6f64656c70'

const CLIENT_IDS = Object.keys(CLIENT_LABELS) as ClientId[]

/** The page names ids, so the id list is a gate: anything else is refused, not resolved. */
export function isClientId(value: string): value is ClientId {
  return (CLIENT_IDS as string[]).includes(value)
}

export interface ClientPaths {
  codexConfig: string
  codexCatalog: string
  codexAuth: string
  claudeSettings: string
  claudeDesktopConfig: string
  claudeDesktop3pConfig: string
  claudeDesktopProfile: string
  claudeDesktopMeta: string
  geminiEnv: string
  geminiSettings: string
  grokConfig: string
  opencodeDir: string
  openclawConfig: string
  hermesConfig: string
  kimiConfig: string
  mcodeConfig: string
  ompModels: string
  ompConfig: string
  piModels: string
  piSettings: string
  copilotProviders: string
  copilotSettings: string
  dshHome: string
  agySettings: string
  qoder: string
  qoderCn: string
  workbuddy: string
  codeBuddyCn: string
  traeCn: string
}

export interface ClientPathContext {
  localAppData?: string
  platform?: string
  env?: Record<string, string | undefined>
}

function nonEmpty(value: string | undefined): string | null {
  return value !== undefined && value.trim() !== '' ? value.trim() : null
}

/**
 * Where each client keeps the endpoint we rewrite. Pure so the layout can be tested
 * without a machine: `home` and `appData` come from Electron, `claudeConfigDir` from the
 * environment contract read out of Claude Desktop's own bundle
 * (`process.env.CLAUDE_CONFIG_DIR || homedir()`).
 */
export function clientPaths(
  home: string,
  appData: string,
  claudeConfigDir: string | undefined,
  context: ClientPathContext = {},
): ClientPaths {
  const platform = context.platform ?? process.platform
  const env = context.env ?? process.env
  // Path arithmetic follows the injected platform, not the host: a layout computed for
  // `linux` must read the same on a Windows CI runner, or every fixture keyed by these
  // paths misses there.
  const { join, dirname, isAbsolute } = platform === 'win32' ? path.win32 : path.posix
  const localAppData = context.localAppData ?? nonEmpty(env.LOCALAPPDATA) ?? join(home, 'AppData', 'Local')
  const xdg = nonEmpty(env.XDG_CONFIG_HOME) ?? join(home, '.config')
  const claudeBase = claudeConfigDir && claudeConfigDir.trim() !== '' ? claudeConfigDir.trim() : join(home, '.claude')

  const desktopBase =
    platform === 'win32'
      ? join(localAppData, 'Claude')
      : platform === 'darwin'
        ? join(home, 'Library', 'Application Support', 'Claude')
        : join(xdg, 'Claude')
  const desktop3p = join(dirname(desktopBase), 'Claude-3p')
  const desktopLibrary = join(desktop3p, 'configLibrary')

  const ompProfile = nonEmpty(env.OMP_PROFILE) ?? nonEmpty(env.PI_PROFILE)
  const ompBase = nonEmpty(env.PI_CONFIG_DIR) ?? join(home, '.omp')
  const ompDir = ompProfile === null ? join(ompBase, 'agent') : join(ompBase, 'profiles', ompProfile, 'agent')
  const ompAgent = nonEmpty(env.PI_CODING_AGENT_DIR)
  const ompRoot = ompAgent !== null && isAbsolute(ompAgent) ? ompAgent : ompDir
  const piAgent = nonEmpty(env.PI_CODING_AGENT_DIR)
  const piRoot = piAgent !== null && isAbsolute(piAgent) ? piAgent : join(home, '.pi', 'agent')

  return {
    codexConfig: join(home, '.codex', 'config.toml'),
    codexCatalog: join(home, '.codex', 'modelport-catalog.json'),
    codexAuth: join(home, '.codex', 'auth.json'),
    claudeSettings: join(claudeBase, 'settings.json'),
    claudeDesktopConfig: join(desktopBase, 'claude_desktop_config.json'),
    claudeDesktop3pConfig: join(desktop3p, 'claude_desktop_config.json'),
    claudeDesktopProfile: join(desktopLibrary, `${CLAUDE_DESKTOP_PROFILE_ID}.json`),
    claudeDesktopMeta: join(desktopLibrary, '_meta.json'),
    geminiEnv: join(home, '.gemini', '.env'),
    geminiSettings: join(home, '.gemini', 'settings.json'),
    grokConfig: join(home, '.grok', 'config.toml'),
    opencodeDir: join(xdg, 'opencode'),
    openclawConfig: join(home, '.openclaw', 'openclaw.json'),
    hermesConfig: platform === 'win32' ? join(localAppData, 'hermes', 'config.yaml') : join(home, '.hermes', 'config.yaml'),
    kimiConfig: join(nonEmpty(env.KIMI_CODE_HOME) ?? join(home, '.kimi-code'), 'config.toml'),
    mcodeConfig: join(
      nonEmpty(env.MINIMAX_DATA_DIR) ?? nonEmpty(env.MAVIS_DATA_DIR) ?? join(home, '.minimax'),
      'config.yaml',
    ),
    ompModels: join(ompRoot, 'models.yml'),
    ompConfig: join(ompRoot, 'config.yml'),
    piModels: join(piRoot, 'models.json'),
    piSettings: join(piRoot, 'settings.json'),
    copilotProviders: join(nonEmpty(env.COPILOT_HOME) ?? join(home, '.copilot'), 'providers.json'),
    copilotSettings: join(nonEmpty(env.COPILOT_HOME) ?? join(home, '.copilot'), 'settings.json'),
    dshHome: nonEmpty(env.DSH_HOME) ?? join(home, '.dsh'),
    agySettings: join(home, '.gemini', 'antigravity-cli', 'settings.json'),
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
 * Codex / WorkBuddy / CodeBuddy take a base ending in `/v1`, TRAE takes the whole
 * chat-completions URL, and Claude takes the bare origin (its SDK appends `/v1/messages`).
 */
export type EndpointShape = 'v1' | 'chat-completions' | 'origin'

export function endpointFor(origin: string, shape: EndpointShape): string {
  const base = origin.replace(/\/+$/, '')
  if (shape === 'origin') return base
  if (shape === 'chat-completions') return `${base}/v1/chat/completions`
  return `${base}/v1`
}

/** Hostnames Claude Desktop counts as loopback, where it still accepts plain http. */
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1' || /^127(\.\d+){3}$/.test(host)
}

export type DesktopEndpoint = { url: string } | { blocked: string }

/**
 * Claude Desktop validates `inferenceGatewayBaseUrl` as "https, or http only on loopback".
 * A remote gateway reached over plain http therefore cannot be handed its http origin: the
 * config is rejected before a single request. The way out is the address-book entry's own
 * client https endpoint (`clientHttpsUrl`) - access-path data lives on the shell entry,
 * never derived from the gateway, which cannot know whether it is reached by IP or by a
 * domain behind a proxy. With no stored value there is nothing valid to write, so say so
 * rather than emit a bad URL.
 */
export function claudeDesktopEndpoint(origin: string, clientHttpsUrl: string | null): DesktopEndpoint {
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return { blocked: '网关地址无效，无法为 Claude Desktop 生成端点' }
  }
  const base = origin.replace(/\/+$/, '')
  if (parsed.protocol === 'https:') return { url: base }
  if (parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname)) return { url: base }
  if (clientHttpsUrl !== null && clientHttpsUrl.startsWith('https:')) return { url: clientHttpsUrl }
  return {
    blocked: 'Claude Desktop 只接受 https（回环地址除外）：当前网关走 http，请在网关条目填「客户端 HTTPS 地址」（可用「从网关探测」）再切换',
  }
}

function parseObject(raw: string): Record<string, unknown> | null {
  return parseJsonObject(raw)
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

/**
 * Records a key edit the same way, comparing **masked** values: the plan never carries the
 * canonical key, so the only comparison available is the mask the caller already has.
 * Without this, a client that is already on the canonical key would read as "will change"
 * on every run, because a masked key never equals the placeholder.
 */
function keyField(
  changes: ClientChange[],
  label: string,
  before: unknown,
  input: { writeKey?: boolean; keyPreview?: string | null },
): boolean {
  if (input.writeKey === false) return false
  const previous = typeof before === 'string' ? before : null
  const masked = previous === null ? null : maskSecret(previous)
  const wanted = input.keyPreview ?? null
  if (masked !== null && masked === wanted) return false
  changes.push({ label, before: masked, after: KEY_PLACEHOLDER })
  return true
}

export interface CodexPlanInput {
  origin: string
  /** Route names the target gateway serves (`GET /v1/models`). */
  routeNames: string[]
  /** The provider table this console owns. */
  providerTable?: string
  /** False when no canonical key exists: the address still moves, the token is left alone. */
  writeKey?: boolean
  /** Masked canonical key, for the "already on this key" comparison. */
  keyPreview?: string | null
}

/**
 * Codex: write `[model_providers.custom]` and point `model_provider` at it.
 *
 * The key travels **inside** the table (`experimental_bearer_token`), not through a User
 * environment variable - that is the shape Codex reads today, and it removes the "restart
 * the client so it sees the new env var" step entirely. `auth.json` is left alone: an
 * official login there is not ours to delete, and an explicit bearer token in the provider
 * table wins over it for this provider.
 *
 * `model_catalog_json` is deliberately untouched. It must stay a bare file name resolved
 * against CODEX_HOME (measured 2026-11-12: a `C:\…` path breaks the WSL-mode core, a
 * `/mnt/c/…` path breaks the Windows-native core), and the catalog's entries carry a
 * `comp_hash` whose derivation is not public - cloning one would be a guess.
 */
export function planCodexToml(raw: string, input: CodexPlanInput): PlanResult {
  const table = input.providerTable ?? 'model_providers.custom'
  const writeKey = input.writeKey !== false
  const document = splitToml(raw)
  const lines = document.lines
  const changes: ClientChange[] = []
  const url = endpointFor(input.origin, 'v1')

  if (!hasTomlTable(lines, table)) {
    appendTomlTable(lines, [
      `[${table}]`,
      tomlStringLiteral('name', 'ModelPort'),
      tomlStringLiteral('base_url', url),
      tomlStringLiteral('wire_api', 'responses'),
      ...(writeKey ? [tomlStringLiteral('experimental_bearer_token', KEY_PLACEHOLDER)] : []),
    ])
    field(changes, `[${table}]`, null, '新建')
  } else {
    const urlEdit = setTomlString(lines, table, 'base_url', url)
    if (!urlEdit.ok) return { kind: 'bad-input', reason: `[${table}] 的 base_url 不是单行字符串，拒绝改写` }
    field(changes, `${table}.base_url`, urlEdit.before, url)

    const nameEdit = setTomlString(lines, table, 'name', 'ModelPort')
    if (nameEdit.ok) field(changes, `${table}.name`, nameEdit.before, 'ModelPort')

    const wireEdit = setTomlString(lines, table, 'wire_api', 'responses')
    if (wireEdit.ok) field(changes, `${table}.wire_api`, wireEdit.before, 'responses')

    if (writeKey) {
      const tokenEdit = setTomlString(lines, table, 'experimental_bearer_token', KEY_PLACEHOLDER)
      if (tokenEdit.ok) keyField(changes, `${table}.experimental_bearer_token`, tokenEdit.before, input)
    }
    // Old shapes: an env-var indirection or an auth flag would override the token above.
    removeTomlKey(lines, table, 'env_key')
    removeTomlKey(lines, table, 'requires_openai_auth')
  }

  const providerEdit = setTomlString(lines, null, 'model_provider', 'custom')
  if (providerEdit.ok) field(changes, 'model_provider', providerEdit.before, 'custom')

  // A top-level endpoint or token would shadow the provider table (older Codex shapes).
  for (const key of ['openai_base_url', 'experimental_bearer_token', 'base_url', 'wire_api']) {
    removeTomlKey(lines, null, key)
  }

  // A model the target does not serve would 503 on the first turn, so the selection has
  // to move with the endpoint. `auto` is preferred because it is the gateway's own
  // router; otherwise the first advertised route.
  const current = readTomlString(lines, null, 'model')
  if (current !== null && input.routeNames.length > 0 && !input.routeNames.includes(current)) {
    const next = input.routeNames.includes('auto') ? 'auto' : input.routeNames[0]
    const edit = setTomlString(lines, null, 'model', next)
    if (edit.ok) field(changes, 'model', current, next)
  }

  return changed(joinToml(document), changes)
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
  /** Masked canonical key, for the "already on this key" comparison. */
  keyPreview?: string | null
  /**
   * The connected gateway's routes (`GET /v1/models`). Planners that own a static model
   * list rebuild it to exactly these (replacing the existing entries); absent/empty means
   * the route fetch failed, so they fall back to repointing in place.
   */
  routes?: { name: string; displayName: string; contextWindow: number | null }[]
}

/** Deep copy with every `apiKey` string replaced by a sentinel, so keys compare separately. */
function maskKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskKeysDeep)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = key === 'apiKey' && typeof inner === 'string' ? '<key>' : maskKeysDeep(inner)
    }
    return out
  }
  return value
}

/**
 * WorkBuddy: `models.json` is an array. Only `vendor: "Custom"` rows are ours - the
 * direct DeepSeek row keeps its own URL and its own key.
 *
 * With the gateway's routes in hand the Custom rows are rebuilt to exactly one per route
 * (capability booleans copied from an existing Custom row); every other row is kept.
 */
export function planWorkBuddyModels(raw: string, input: JsonPlanInput): PlanResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: 'bad-input', reason: 'models.json 不是可解析的 JSON' }
  }
  if (!Array.isArray(parsed)) return { kind: 'bad-input', reason: 'models.json 不是数组' }
  const url = endpointFor(input.origin, 'v1')
  const isCustom = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && (value as Record<string, unknown>).vendor === 'Custom'
  const customRows = parsed.filter(isCustom)

  if (input.writeKey && input.routes !== undefined && input.routes.length > 0) {
    const template = customRows[0] ?? {
      supportsToolCall: true,
      supportsImages: false,
      supportsReasoning: true,
      useCustomProtocol: true,
    }
    const next: unknown[] = parsed.filter(value => !isCustom(value))
    for (const route of input.routes) {
      next.push({ ...template, id: route.name, name: route.name, vendor: 'Custom', url, apiKey: KEY_PLACEHOLDER })
    }
    const keysMatch = input.keyPreview === undefined || input.keyPreview === null
      ? true
      : input.routes.every(route => {
          const row = customRows.find(entry => entry.id === route.name)
          return row !== undefined && typeof row.apiKey === 'string' && maskSecret(row.apiKey) === input.keyPreview
        })
    if (keysMatch && JSON.stringify(maskKeysDeep(next)) === JSON.stringify(maskKeysDeep(parsed))) {
      return { kind: 'unchanged' }
    }
    const names = input.routes.map(route => route.name).join(', ')
    return changed(JSON.stringify(next, null, detectIndent(raw)) + '\n', [
      { label: 'WorkBuddy 自定义模型（按网关路由重建）', before: `${customRows.length} 条`, after: `${input.routes.length} 条：${names}` },
    ])
  }

  const changes: ClientChange[] = []
  let touched = 0
  const next = parsed.map(value => {
    if (!isCustom(value)) return value
    touched += 1
    const copy = { ...value }
    const label = typeof value.id === 'string' ? value.id : `#${touched}`
    if (field(changes, `${label}.url`, value.url, url)) copy.url = url
    if (input.writeKey) {
      keyField(changes, `${label}.apiKey`, value.apiKey, input)
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

  // The connection keys belong to whoever served this client last. Leaving a Bedrock or
  // Vertex selector behind would keep Claude Code on that transport no matter what the
  // base URL says, so the floor is cleared before the target's values go in.
  let cleared = 0
  for (const key of Object.keys(env)) {
    if (!claudeFloorEnv(key)) continue
    delete env[key]
    cleared += 1
  }
  for (const key of CLAUDE_FLOOR_TOP) {
    if (key in parsed) {
      delete parsed[key]
      cleared += 1
    }
  }

  const url = endpointFor(input.origin, 'origin')
  if (field(changes, 'env.ANTHROPIC_BASE_URL', env.ANTHROPIC_BASE_URL, url)) env.ANTHROPIC_BASE_URL = url
  if (
    field(changes, 'env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY', env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, '1')
  ) {
    env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = '1'
  }
  if (input.writeKey) {
    keyField(changes, 'env.ANTHROPIC_AUTH_TOKEN', env.ANTHROPIC_AUTH_TOKEN, input)
    env.ANTHROPIC_AUTH_TOKEN = KEY_PLACEHOLDER
  }
  if (cleared > 0) changes.push({ label: '上一家的连接键', before: `${cleared} 个`, after: '已清空' })
  if (changes.length === 0) return { kind: 'unchanged' }
  const indent = raw === null ? '  ' : detectIndent(raw)
  return changed(JSON.stringify({ ...parsed, env }, null, indent) + '\n', changes)
}

/** Claude Code's protocol selectors: same prefix family as feature switches, so list them. */
const CLAUDE_PROTOCOL_SELECTORS = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_GATEWAY',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD',
]

const CLAUDE_FLOOR_ENV_KEYS = [
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLOUD_ML_REGION',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
  'CLAUDE_CODE_OAUTH_SCOPES',
  'CLAUDE_CODE_API_KEY_HELPER_TTL_MS',
]

const CLAUDE_FLOOR_TOP = [
  'apiKeyHelper',
  'apiBaseUrl',
  'primaryModel',
  'smallFastModel',
  'apiKey',
  'model',
  'fallbackModel',
  'modelOverrides',
  'modelPicker',
  'advisorModel',
  'awsAuthRefresh',
  'awsCredentialExport',
  'gcpAuthRefresh',
]

/** `ANTHROPIC_*`, `AWS_*`, `VERTEX_REGION_*` are connection/auth as a whole; `CLAUDE_CODE_*` is not. */
export function claudeFloorEnv(key: string): boolean {
  if (key.startsWith('ANTHROPIC_') || key.startsWith('AWS_') || key.startsWith('VERTEX_REGION_')) return true
  if (CLAUDE_PROTOCOL_SELECTORS.includes(key) || CLAUDE_FLOOR_ENV_KEYS.includes(key)) return true
  return key.startsWith('CLAUDE_CODE_SKIP_') && key.endsWith('_AUTH')
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
  const url = endpointFor(input.origin, 'v1')
  const changes: ClientChange[] = []
  const next: Record<string, unknown> = { ...parsed }
  const currentModels = Array.isArray(parsed['oaicopilot.models']) ? (parsed['oaicopilot.models'] as unknown[]) : null

  // Rebuild the custom model list from the gateway's routes; the apiKey is not here (it
  // lives in the fork's encrypted secret storage), so the endpoint/names move but the key
  // stays the operator's manual step.
  if (input.routes !== undefined && input.routes.length > 0) {
    const template = currentModels?.find(
      (model): model is Record<string, unknown> => model !== null && typeof model === 'object',
    ) ?? {}
    const base: Record<string, unknown> = { ...template }
    delete base.id
    delete base.context_length
    next['oaicopilot.baseUrl'] = url
    next['oaicopilot.models'] = input.routes.map(route => ({
      ...base,
      id: route.name,
      ...(route.contextWindow !== null ? { context_length: route.contextWindow } : {}),
    }))
    if (JSON.stringify(next) === JSON.stringify(parsed)) return { kind: 'unchanged' }
    return changed(JSON.stringify(next, null, detectIndent(raw)) + '\n', [
      {
        label: 'CodeBuddy CN 自定义模型（按网关路由重建）',
        before: `${currentModels?.length ?? 0} 条`,
        after: `${input.routes.length} 条：${input.routes.map(route => route.name).join(', ')}`,
      },
    ])
  }

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