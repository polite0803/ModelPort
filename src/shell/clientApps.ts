/**
 * Per-client write faces, ported from the reference project's client integrations.
 *
 * Each planner answers the same four questions for one client, using that client's own
 * measured field names: where the endpoint goes, where the key goes, which model name the
 * client will send, and what the console must *not* touch. The field names are not ours to
 * choose - a wrong key is a silently ignored setting, so these follow the clients exactly
 * (documented per planner below).
 *
 * Two rules the reference implementation enforces and this port keeps:
 * - **Own one node, leave the neighbours.** Additive clients (OpenCode, OpenClaw, Hermes,
 *   Kimi, MCode, Oh My Pi, Pi, Copilot, DeepSeek Harness) keep every other provider entry
 *   and every unrelated top-level key byte-identical.
 * - **Clear the previous owner's connection keys before writing.** Otherwise a Bedrock
 *   selector or a top-level base URL keeps serving the client and the new endpoint is
 *   never used - the "looks configured, 401s on arrival" failure.
 */
import path from 'node:path'
import { KEY_PLACEHOLDER } from '../shared/clientSync.ts'
import type { ClientChange, ClientSyncState } from '../shared/clientSync.ts'
import { CLAUDE_DESKTOP_PROFILE_ID, claudeDesktopEndpoint, endpointFor, maskSecret, unservedModels } from './clientSyncPlan.ts'
import {
  detectIndent,
  ensureJsonObject,
  dotenvSet,
  insertJsonKey,
  parseJson5Object,
  parseJsonObject,
  replaceJsonValue,
  stringifyJson,
} from './clientFormats.ts'
import {
  appendTomlTable,
  dottedTable,
  hasTomlTable,
  joinToml,
  readTomlString,
  removeTomlTable,
  replaceTomlTable,
  setTomlString,
  splitToml,
  tomlStringLiteral,
  tomlTableHeader,
} from './clientToml.ts'
import {
  readChildBlock,
  readNestedBlock,
  readYamlScalar,
  rootSeqItemRange,
  setChildBlock,
  setNestedBlock,
  setSeqItem,
  setTopBlock,
} from './clientYaml.ts'
import type { ClientPaths } from './clientSyncPlan.ts'
import type { PlannedFile } from './clientLiveWrite.ts'

export interface AppPlanInput {
  /** Normalized origin of the gateway every client is pointed at. */
  origin: string
  /**
   * The address-book entry's client https endpoint (`clientHttpsUrl`), or null when the
   * entry stores none. Access-path data lives on the shell entry, never derived from the
   * gateway. Only clients that refuse plain http (Claude Desktop) consult it.
   */
  clientHttpsUrl: string | null
  /** Route names the target serves (`GET /v1/models`). */
  routeNames: string[]
  /** False when no canonical key could be established: address moves, key does not. */
  hasKey: boolean
  /**
   * The canonical key itself, for the "is the file already correct" comparison only. It
   * never reaches a plan: content carries `KEY_PLACEHOLDER`, so an equality check against
   * the bytes on disk would report a difference forever. The caller is the main process,
   * which already holds the value; nothing here returns it.
   */
  keyValue: string | null
  paths: ClientPaths
  /**
   * Separator style of `paths`, for the joins and dirnames done here. Defaults to the
   * host; a caller that computed the layout for another platform (tests) names it, so
   * the derived paths stay in the same style as the ones handed in.
   */
  pathPlatform?: string
  read(path: string): string | null
  exists(path: string): boolean
}

export interface AppPlan {
  state: ClientSyncState
  paths: string[]
  files: PlannedFile[]
  changes: ClientChange[]
  reason: string | null
  manualStep: string | null
  unserved: string[]
}

export type ClientAppPlanner = (input: AppPlanInput) => AppPlan

const PROFILE_NAME = 'ModelPort'
/** The id every additive client gets for our gateway: lowercase, no slash, no space. */
const ENTRY_ID = 'modelport'

function row(
  state: ClientSyncState,
  paths: string[],
  options: {
    files?: PlannedFile[]
    changes?: ClientChange[]
    reason?: string | null
    manualStep?: string | null
    unserved?: string[]
  } = {},
): AppPlan {
  return {
    state,
    paths,
    files: options.files ?? [],
    changes: options.changes ?? [],
    reason: options.reason ?? null,
    manualStep: options.manualStep ?? null,
    unserved: options.unserved ?? [],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Path arithmetic in the style of the handed-in layout, never the host's. */
export function pathOps(input: AppPlanInput) {
  return (input.pathPlatform ?? process.platform) === 'win32' ? path.win32 : path.posix
}

/** `source[a][b]` when both levels exist and the leaf is a string. */
function nestedString(source: Record<string, unknown> | null, a: string, b: string): string | null {
  const middle = source?.[a]
  if (!isRecord(middle)) return null
  return typeof middle[b] === 'string' ? (middle[b] as string) : null
}

/** `auto` when the gateway serves it, else the first advertised route. */
function pickRoute(input: AppPlanInput): string | null {
  if (input.routeNames.includes('auto')) return 'auto'
  return input.routeNames.length > 0 ? input.routeNames[0] : null
}

/** The clients whose write face is plain JSON, JSON5 or TOML. */
export const CLI_APP_PLANNERS: Record<string, ClientAppPlanner> = {
  'claude-desktop': planClaudeDesktop,
  gemini: planGemini,
  grokbuild: planGrokBuild,
  opencode: planOpenCode,
  openclaw: planOpenClaw,
}

/**
 * Decides `ready` vs `unchanged` from the bytes, not from the change list: a seed key that
 * was missing is a real write even when nothing the panel lists has moved.
 */
function finalize(input: AppPlanInput, base: AppPlan, manualStep: string | null = null): AppPlan {
  const differs = base.files.some(file => {
    const raw = input.read(file.path)
    if (file.content === null) return raw !== null
    const expected = input.keyValue === null ? file.content : file.content.split(KEY_PLACEHOLDER).join(input.keyValue)
    if (expected === raw) return false
    // No key yet: a placeholder cannot match anything, so compare the rest of the file.
    if (input.keyValue === null) return raw !== null && !raw.includes(KEY_PLACEHOLDER) && file.content !== raw
    return true
  })
  // Nothing to write means nothing to list: a key row that compares masked values cannot
  // always tell "already canonical" from "about to change", so the byte reading decides and
  // an unchanged row shows no changes at all.
  if (!differs) return { ...base, state: 'unchanged', changes: [] }
  return { ...base, state: 'ready', manualStep: base.manualStep ?? manualStep }
}

function readJsonDoc(raw: string): Record<string, unknown> | null {
  return parseJsonObject(raw) ?? parseJson5Object(raw)
}

/** Writes `value` at `segments`, whole-file when the document is strict JSON. */
function writeJsonAt(
  raw: string,
  segments: string[],
  value: unknown,
): string | null {
  if (parseJsonObject(raw) !== null) {
    const doc = parseJsonObject(raw) as Record<string, unknown>
    setPath(doc, segments, value)
    return stringifyJson(raw, doc)
  }
  const replaced = replaceJsonValue(raw, segments, value)
  if (replaced !== null) return replaced
  const parent = segments.slice(0, -1)
  const ensured = parent.length === 0 ? raw : ensureJsonObject(raw, parent)
  if (ensured === null) return null
  return insertJsonKey(ensured, parent, segments[segments.length - 1], value)
}

function setPath(doc: Record<string, unknown>, segments: string[], value: unknown): void {
  let cursor: Record<string, unknown> = doc
  for (const key of segments.slice(0, -1)) {
    const next = cursor[key]
    if (!isRecord(next)) {
      cursor[key] = {}
    }
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[segments[segments.length - 1]] = value
}

// ---------------------------------------------------------------------------
// Claude Desktop
// ---------------------------------------------------------------------------

/** Keys the profile owns outright: cleared, then written from the target. */
const DESKTOP_PROFILE_FLOOR = [
  'inferenceProvider',
  'inferenceGatewayBaseUrl',
  'inferenceGatewayApiKey',
  'inferenceGatewayAuthScheme',
  'inferenceModels',
  'modelDiscoveryEnabled',
]

/** Keys seeded only when absent: policy the user may legitimately tighten. */
const DESKTOP_PROFILE_SEED: [string, unknown][] = [
  ['disableDeploymentModeChooser', true],
  ['coworkEgressAllowedHosts', ['*']],
]

/** Desktop refuses a model name it did not define; our routes usually are not Claude names. */
const CLAUDE_MODEL_NAME = /^(?:anthropic\/)?claude-/

/**
 * Claude Desktop: `deploymentMode:"3p"` in **both** config files plus a profile under
 * `Claude-3p/configLibrary/`.
 *
 * This is the face the desktop app actually reads. `~/.claude/settings.json` is Claude
 * *Code*'s file, which is why writing it appeared to succeed while Desktop kept talking to
 * its own endpoint. The key has no other home: Desktop reads neither an environment
 * variable nor an auth file, so without a canonical key there is nothing to write.
 */
export function planClaudeDesktop(input: AppPlanInput): AppPlan {
  const { dirname, basename } = pathOps(input)
  const paths = input.paths
  const configs = [paths.claudeDesktopConfig, paths.claudeDesktop3pConfig]
  if (!input.exists(dirname(paths.claudeDesktopConfig)) && !input.exists(dirname(paths.claudeDesktop3pConfig))) {
    return row('not-installed', configs, { reason: '没有 Claude Desktop 的配置目录' })
  }
  if (!input.hasKey) {
    return row('blocked', configs, {
      reason: '没有规范 key：Claude Desktop 只从它的 profile 里读密钥，不读环境变量，也没有可以手动填的界面',
    })
  }

  // Desktop rejects a non-loopback http origin outright; decide the endpoint before any
  // file is built so an unsatisfiable gateway is a blocked row, not a half-write.
  const endpoint = claudeDesktopEndpoint(input.origin, input.clientHttpsUrl)
  if ('blocked' in endpoint) return row('blocked', configs, { reason: endpoint.blocked })

  const files: PlannedFile[] = []
  const changes: ClientChange[] = []
  for (const path of configs) {
    const raw = input.read(path)
    const doc = raw === null ? {} : parseJsonObject(raw)
    if (!isRecord(doc)) return row('error', [path], { reason: `${basename(path)} 不是可解析的 JSON 对象` })
    if (doc.deploymentMode !== '3p') {
      changes.push({ label: `${basename(path)} deploymentMode`, before: typeof doc.deploymentMode === 'string' ? doc.deploymentMode : null, after: '3p' })
    }
    files.push({ path, content: stringifyJson(raw, { ...doc, deploymentMode: '3p' }) })
  }

  const profileRaw = input.read(paths.claudeDesktopProfile)
  const profile = profileRaw === null ? {} : parseJsonObject(profileRaw)
  if (!isRecord(profile)) return row('error', [paths.claudeDesktopProfile], { reason: 'profile 不是可解析的 JSON 对象' })
  const url = endpoint.url
  const servedModels = input.routeNames.filter(name => CLAUDE_MODEL_NAME.test(name)).slice(0, 200)
  const next: Record<string, unknown> = { ...profile }
  const written: Record<string, unknown> = {
    inferenceProvider: 'gateway',
    inferenceGatewayBaseUrl: url,
    inferenceGatewayApiKey: KEY_PLACEHOLDER,
    inferenceGatewayAuthScheme: 'bearer',
  }
  if (servedModels.length > 0) written.inferenceModels = servedModels
  // A floor key we no longer write is dropped; the ones we do are assigned in place.
  // Deleting and re-adding would move them to the end of the document, so a second switch
  // would rewrite a file that already says exactly what we want it to say.
  for (const key of DESKTOP_PROFILE_FLOOR) if (!(key in written)) delete next[key]
  Object.assign(next, written)
  for (const [key, value] of DESKTOP_PROFILE_SEED) {
    if (!(key in profile)) next[key] = value
  }
  if (profile.inferenceGatewayBaseUrl !== url) {
    changes.push({ label: 'profile 网关地址', before: typeof profile.inferenceGatewayBaseUrl === 'string' ? profile.inferenceGatewayBaseUrl : null, after: url })
  }
  changes.push({ label: 'profile 密钥', before: maskSecret(String(profile.inferenceGatewayApiKey ?? '')), after: KEY_PLACEHOLDER })

  const metaRaw = input.read(paths.claudeDesktopMeta)
  const meta = metaRaw === null ? {} : parseJsonObject(metaRaw)
  if (!isRecord(meta)) return row('error', [paths.claudeDesktopMeta], { reason: '_meta.json 不是可解析的 JSON 对象' })
  const entries = Array.isArray(meta.entries) ? (meta.entries as unknown[]).filter(isRecord) : []
  const nextEntries = [
    { id: CLAUDE_DESKTOP_PROFILE_ID, name: PROFILE_NAME },
    ...entries.filter(entry => entry.id !== CLAUDE_DESKTOP_PROFILE_ID),
  ]
  files.push({ path: paths.claudeDesktopProfile, content: stringifyJson(profileRaw, next), private: true })
  files.push({ path: paths.claudeDesktopMeta, content: stringifyJson(metaRaw, { ...meta, entries: nextEntries, appliedId: CLAUDE_DESKTOP_PROFILE_ID }) })

  // Desktop's own model list is not readable from these files, so nothing here can say
  // "the client lists a model the target does not serve" - the reason line says which
  // routes could not be advertised instead.
  const switchedToHttps = url.startsWith('https:') && input.origin.startsWith('http:')
  return finalize(input, row('ready', [...configs, paths.claudeDesktopProfile, paths.claudeDesktopMeta], {
    files,
    changes,
    reason: servedModels.length === 0 && input.routeNames.length > 0
      ? '目标网关的路由名不是 claude-*：Desktop 的选择器仍列它内置的 Claude 模型名，网关按默认模型接住'
      : null,
    manualStep: switchedToHttps
      ? '重启 Claude Desktop 让新的部署模式生效；若该 https 地址的证书不是公共可信（如网关自签名），还需在网关 HTTPS 设置里「安装到系统信任」，否则 Desktop 会拒绝连接'
      : '重启 Claude Desktop 让新的部署模式生效',
  }))
}

// ---------------------------------------------------------------------------
// Gemini CLI
// ---------------------------------------------------------------------------

/**
 * Gemini CLI: `.env` carries the connection, `settings.json` carries the auth choice.
 *
 * The two var names are asymmetric in the client itself (`GOOGLE_GEMINI_BASE_URL` for the
 * address, `GEMINI_API_KEY` for the key). `security.auth.selectedType` must read
 * `gemini-api-key` or the CLI ignores the key and tries OAuth. `model.name` and the
 * unrelated `GEMINI_*` settings (sandbox, CLI home, telemetry) stay as the user set them.
 */
export function planGemini(input: AppPlanInput): AppPlan {
  const { dirname } = pathOps(input)
  const paths = input.paths
  const envRaw = input.read(paths.geminiEnv)
  const settingsRaw = input.read(paths.geminiSettings)
  if (envRaw === null && settingsRaw === null && !input.exists(dirname(paths.geminiSettings))) {
    return row('not-installed', [paths.geminiEnv], { reason: '没有 ~/.gemini 目录' })
  }
  const url = endpointFor(input.origin, 'origin')
  const entries: [string, string][] = [['GOOGLE_GEMINI_BASE_URL', url]]
  if (input.hasKey) entries.push(['GEMINI_API_KEY', KEY_PLACEHOLDER])
  const edited = dotenvSet(envRaw ?? '', entries)
  const changes: ClientChange[] = []
  for (const [key, value] of entries) {
    const before = edited.before[key]
    const label = key === 'GEMINI_API_KEY' ? maskSecret(String(before ?? '')) : before
    if (before !== value) changes.push({ label: `.env ${key}`, before: label === KEY_PLACEHOLDER ? value : label, after: key === 'GEMINI_API_KEY' ? KEY_PLACEHOLDER : value })
  }
  const files: PlannedFile[] = [{ path: paths.geminiEnv, content: edited.content, private: true }]

  const settings = settingsRaw === null ? {} : parseJsonObject(settingsRaw)
  if (!isRecord(settings)) return row('error', [paths.geminiSettings], { reason: 'settings.json 不是可解析的 JSON 对象' })
  if (settings.security !== undefined && !isRecord(settings.security)) {
    return row('error', [paths.geminiSettings], { reason: 'settings.json 的 security 不是对象' })
  }
  const security = { ...(settings.security as Record<string, unknown> | undefined) }
  const auth = { ...(isRecord(security.auth) ? security.auth : {}) }
  const selected = auth.selectedType
  auth.selectedType = 'gemini-api-key'
  security.auth = auth
  files.push({ path: paths.geminiSettings, content: stringifyJson(settingsRaw, { ...settings, security }) })
  if (selected !== 'gemini-api-key') {
    changes.push({ label: 'security.auth.selectedType', before: typeof selected === 'string' ? selected : null, after: 'gemini-api-key' })
  }

  const current = edited.before['GEMINI_MODEL'] ?? null
  return finalize(
    input,
    row('ready', [paths.geminiEnv, paths.geminiSettings], {
      files,
      changes,
      unserved: current === null ? [] : unservedModels([current], input.routeNames),
      manualStep: input.hasKey ? null : '没有规范 key：地址已改，请把 .env 的 GEMINI_API_KEY 改成目标网关的 key',
    }),
  )
}

// ---------------------------------------------------------------------------
// Grok Build
// ---------------------------------------------------------------------------

/**
 * Grok Build: one whole `[model."<id>"]` table plus `models.default`.
 *
 * The table is replaced rather than patched, because a leftover `env_key` or model name
 * from the previous vendor keeps being used by the client. `api_backend` is the protocol
 * the client speaks; our gateway serves the Responses lane, so `responses`.
 */
export function planGrokBuild(input: AppPlanInput): AppPlan {
  const path = input.paths.grokConfig
  const raw = input.read(path)
  if (raw === null) return row('not-installed', [path], { reason: '没有 ~/.grok/config.toml' })
  if (!input.hasKey) {
    return row('blocked', [path], {
      reason: '没有规范 key：Grok 的密钥写在模型表里，地址改了也连不上',
    })
  }
  const model = pickRoute(input)
  if (model === null) {
    return row('blocked', [path], { reason: '目标网关没有可用路由名：Grok 的模型表必须写一个 model' })
  }
  const document = splitToml(raw)
  const lines = document.lines
  const table = dottedTable(['model', ENTRY_ID])
  const url = endpointFor(input.origin, 'v1')
  const body = [
    tomlTableHeader(['model', ENTRY_ID]),
    tomlStringLiteral('model', model),
    tomlStringLiteral('name', PROFILE_NAME),
    tomlStringLiteral('base_url', url),
    tomlStringLiteral('api_backend', 'responses'),
    tomlStringLiteral('api_key', KEY_PLACEHOLDER),
  ]
  const changes: ClientChange[] = []
  const previous = readTomlString(lines, table, 'base_url')
  if (hasTomlTable(lines, table)) {
    replaceTomlTable(lines, table, body)
  } else {
    appendTomlTable(lines, body)
  }
  if (previous !== null && previous !== url) changes.push({ label: `${table}.base_url`, before: previous, after: url })

  if (!hasTomlTable(lines, 'models')) {
    appendTomlTable(lines, ['[models]', tomlStringLiteral('default', ENTRY_ID)])
  } else {
    const before = readTomlString(lines, 'models', 'default')
    setTomlString(lines, 'models', 'default', ENTRY_ID)
    if (before !== ENTRY_ID) changes.push({ label: 'models.default', before, after: ENTRY_ID })
    // Only move the summary model when it was ours; the user's own choice is theirs.
    const summary = readTomlString(lines, 'models', 'session_summary')
    if (summary === null || summary === ENTRY_ID) setTomlString(lines, 'models', 'session_summary', ENTRY_ID)
  }
  return finalize(input, row('ready', [path], { files: [{ path, content: joinToml(document) }], changes }))
}

// ---------------------------------------------------------------------------
// OpenCode
// ---------------------------------------------------------------------------

/**
 * OpenCode: `provider.<id>` (V1) or `providers.<id>` (V2 native).
 *
 * Additive, and the switch never touches the top-level `model` string - that is the
 * client's own selection. The native map wins whenever it exists; writing V1 next to a
 * valid native declaration would be ignored by the client.
 */
export function planOpenCode(input: AppPlanInput): AppPlan {
  const { join } = pathOps(input)
  const dir = input.paths.opencodeDir
  if (!input.exists(dir)) return row('not-installed', [join(dir, 'opencode.json')], { reason: '没有 ~/.config/opencode 目录' })
  const candidates = [join(dir, 'opencode.jsonc'), join(dir, 'opencode.json')]
  const existing = candidates.find(path => input.exists(path))
  const path = existing ?? join(dir, 'opencode.json')
  const raw = input.read(path) ?? `{\n  "$schema": "https://opencode.ai/config.json"\n}\n`
  const doc = readJsonDoc(raw)
  if (!isRecord(doc)) return row('error', [path], { reason: 'opencode 配置不是可解析的 JSON 对象' })

  const native = isRecord(doc.providers)
  const segments = native ? ['providers', ENTRY_ID] : ['provider', ENTRY_ID]
  const models: Record<string, unknown> = {}
  for (const name of input.routeNames) models[name] = { name }
  const url = endpointFor(input.origin, 'v1')
  const connection: Record<string, unknown> = { baseURL: url }
  if (input.hasKey) connection.apiKey = KEY_PLACEHOLDER
  const node = native
    ? { name: PROFILE_NAME, package: '@ai-sdk/openai-compatible', settings: connection, models }
    : { npm: '@ai-sdk/openai-compatible', name: PROFILE_NAME, options: connection, models }

  const content = writeJsonAt(raw, segments, node)
  if (content === null) {
    return row('error', [path], { reason: `${segments.join('.')} 所在的位置不是对象，拒绝改写` })
  }
  const before = isRecord((doc[segments[0]] as Record<string, unknown> | undefined)?.[ENTRY_ID])
    ? ((doc[segments[0]] as Record<string, unknown>)[ENTRY_ID] as Record<string, unknown>)
    : null
  const beforeUrl = nestedString(before, 'options', 'baseURL') ?? nestedString(before, 'settings', 'baseURL')
  const beforeKey = nestedString(before, 'options', 'apiKey') ?? nestedString(before, 'settings', 'apiKey')
  const changes: ClientChange[] = []
  if (beforeUrl !== url) changes.push({ label: `${segments.join('.')}.baseURL`, before: beforeUrl, after: url })
  if (input.hasKey) changes.push({ label: `${segments.join('.')}.apiKey`, before: maskSecret(beforeKey ?? ''), after: KEY_PLACEHOLDER })
  return finalize(input, row('ready', [path], {
    files: [{ path, content, private: input.hasKey }],
    changes,
    manualStep: input.hasKey ? null : '没有规范 key：地址已改，请把该条目的 apiKey 改成目标网关的 key',
  }))
}

// ---------------------------------------------------------------------------
// OpenClaw
// ---------------------------------------------------------------------------

/**
 * OpenClaw: `models.providers.<id>` inside a JSON5 file.
 *
 * `models.mode` stays whatever the file says; it is only created as `merge` when we create
 * the section, because `replace` would hide the client's own providers. A file with
 * comments that does not yet have our node is refused rather than re-serialised, since
 * re-serialising is how comments disappear.
 */
export function planOpenClaw(input: AppPlanInput): AppPlan {
  const path = input.paths.openclawConfig
  const raw = input.read(path)
  if (raw === null) return row('not-installed', [path], { reason: '没有 ~/.openclaw/openclaw.json' })
  const doc = readJsonDoc(raw)
  if (!isRecord(doc)) return row('error', [path], { reason: 'openclaw.json 不是可解析的 JSON5 对象' })
  if (doc.models !== undefined && !isRecord(doc.models)) {
    return row('error', [path], { reason: 'openclaw.json 的 models 不是对象' })
  }
  const models = { ...(doc.models as Record<string, unknown> | undefined) }
  if (doc.models === undefined) models.mode = 'merge'
  const providers = { ...(isRecord(models.providers) ? models.providers : {}) }
  const url = endpointFor(input.origin, 'v1')
  const previous = isRecord(providers[ENTRY_ID]) ? (providers[ENTRY_ID] as Record<string, unknown>) : null
  const node: Record<string, unknown> = {
    name: PROFILE_NAME,
    baseUrl: url,
    api: 'openai-completions',
    models: input.routeNames.map(name => ({ id: name, name })),
  }
  if (input.hasKey) node.apiKey = KEY_PLACEHOLDER
  providers[ENTRY_ID] = node
  models.providers = providers

  const segments = ['models', 'providers', ENTRY_ID]
  let content: string | null
  if (parseJsonObject(raw) !== null) {
    content = stringifyJson(raw, { ...doc, models })
  } else {
    content = replaceJsonValue(raw, segments, node)
    if (content === null) content = writeJsonAt(raw, segments, node)
  }
  if (content === null) {
    return row('no-entry', [path], {
      reason: 'openclaw.json 带注释且没有 models.providers 这一段，控制台不重建它',
      manualStep: '先在 openclaw.json 里加一个 models.providers 空对象，之后切换由控制台代写',
    })
  }
  const changes: ClientChange[] = []
  const beforeUrl = typeof previous?.baseUrl === 'string' ? previous.baseUrl : null
  if (beforeUrl !== url) changes.push({ label: 'models.providers.modelport.baseUrl', before: beforeUrl, after: url })
  if (input.hasKey) changes.push({ label: 'models.providers.modelport.apiKey', before: maskSecret(String(previous?.apiKey ?? '')), after: KEY_PLACEHOLDER })
  return finalize(input, row('ready', [path], {
    files: [{ path, content, private: input.hasKey }],
    changes,
    manualStep: input.hasKey ? null : '没有规范 key：地址已改，请把该条目的 apiKey 改成目标网关的 key',
  }))
}