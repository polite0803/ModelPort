/**
 * The additive tool clients: Hermes, Kimi Code, MiniMax Code, Oh My Pi, Pi, GitHub
 * Copilot CLI, DeepSeek Harness and Antigravity CLI.
 *
 * Same contract as `clientApps.ts` - one owned node per client, everything else byte
 * identical - but these configs are YAML, TOML or arrays, so each planner says which
 * section it touches and which field carries the key. Field names come from the clients
 * themselves; a wrong name is a setting nobody reads.
 */
import { KEY_PLACEHOLDER } from '../shared/clientSync.ts'
import type { ClientChange } from '../shared/clientSync.ts'
import { endpointFor, maskSecret } from './clientSyncPlan.ts'
import { parseJsonObject, stringifyJson } from './clientFormats.ts'
import {
  appendTomlTable,
  dottedTable,
  hasTomlTable,
  headerName,
  isHeaderLine,
  joinToml,
  readTomlString,
  removeTomlTable,
  setTomlString,
  splitToml,
  tomlStringLiteral,
  tomlTableHeader,
} from './clientToml.ts'
import {
  readChildBlock,
  readNestedBlock,
  readTopBlock,
  readYamlScalar,
  rootSeqItemRange,
  setChildBlock,
  setNestedBlock,
  setSeqItem,
} from './clientYaml.ts'
import { pathOps } from './clientApps.ts'
import type { AppPlan, AppPlanInput, ClientAppPlanner } from './clientApps.ts'
import type { PlannedFile } from './clientLiveWrite.ts'

const PROFILE_NAME = 'ModelPort'
const ENTRY_ID = 'modelport'

function row(
  state: AppPlan['state'],
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

function pickRoute(input: AppPlanInput): string | null {
  if (input.routeNames.includes('auto')) return 'auto'
  return input.routeNames.length > 0 ? input.routeNames[0] : null
}

function finalize(input: AppPlanInput, base: AppPlan): AppPlan {
  const differs = base.files.some(file => {
    const raw = input.read(file.path)
    if (file.content === null) return raw !== null
    const expected = input.keyValue === null ? file.content : file.content.split(KEY_PLACEHOLDER).join(input.keyValue)
    if (expected === raw) return false
    if (input.keyValue === null) return raw !== null && !raw.includes(KEY_PLACEHOLDER) && file.content !== raw
    return true
  })
  if (!differs) return { ...base, state: 'unchanged', changes: [] }
  return { ...base, state: 'ready' }
}

function urlOf(input: AppPlanInput): string {
  return endpointFor(input.origin, 'v1')
}

/** A top-level YAML block whose first content line is `- …`, or that is absent. */
function isSequenceBlock(raw: string, key: string): boolean {
  const block = readTopBlock(raw, key)
  if (block === null) return true
  const first = block
    .split('\n')
    .slice(1)
    .find(line => line.trim() !== '' && !line.trim().startsWith('#'))
  if (first === undefined) return true
  return first.trimStart().startsWith('-')
}

// ---------------------------------------------------------------------------
// Hermes
// ---------------------------------------------------------------------------

/**
 * Hermes: a `custom_providers:` list entry keyed by `name`.
 *
 * The v12 `providers:` mapping is the client's own and is never written here; a sequence
 * that is actually a mapping is refused instead of corrupted. `model.base_url` deliberately
 * keeps whatever the previous provider left (Hermes only reads it for that provider), so
 * only `model.provider` / `model.default` move with the switch.
 */
export function planHermes(input: AppPlanInput): AppPlan {
  const path = input.paths.hermesConfig
  const raw = input.read(path)
  if (raw === null) return row('not-installed', [path], { reason: '没有 Hermes 的 config.yaml' })
  if (!isSequenceBlock(raw, 'custom_providers')) {
    return row('error', [path], { reason: 'config.yaml 的 custom_providers 不是列表，拒绝改写' })
  }
  const model = pickRoute(input)
  const models: Record<string, unknown> = {}
  for (const name of input.routeNames) models[name] = {}
  const item: Record<string, unknown> = {
    name: ENTRY_ID,
    base_url: urlOf(input),
    api_mode: 'chat_completions',
  }
  if (input.hasKey) item.api_key = KEY_PLACEHOLDER
  if (model !== null) item.model = model
  if (Object.keys(models).length > 0) item.models = models

  let content = setSeqItem(raw, 'custom_providers', 'name', ENTRY_ID, item)
  content = setChildBlock(content, 'model', 'provider', ENTRY_ID)
  if (model !== null) content = setChildBlock(content, 'model', 'default', model)

  const existingBlock = readChildBlock(raw, 'custom_providers', ENTRY_ID) ?? ''
  const beforeUrl = readYamlScalar(existingBlock, 'base_url')
  const changes: ClientChange[] = []
  if (beforeUrl !== urlOf(input)) {
    changes.push({ label: `custom_providers.${ENTRY_ID}.base_url`, before: beforeUrl, after: urlOf(input) })
  }
  if (input.hasKey) {
    changes.push({
      label: `custom_providers.${ENTRY_ID}.api_key`,
      before: maskSecret(String(readYamlScalar(existingBlock, 'api_key') ?? '')),
      after: KEY_PLACEHOLDER,
    })
  }
  return finalize(input, row('ready', [path], {
    files: [{ path, content, private: input.hasKey }],
    changes,
    manualStep: input.hasKey ? null : '没有规范 key：地址已改，请把该条目的 api_key 改成目标网关的 key',
  }))
}

// ---------------------------------------------------------------------------
// Kimi Code
// ---------------------------------------------------------------------------

/**
 * Kimi Code: `[providers.<id>]` plus a global `[models.*]` table whose rows name their
 * provider.
 *
 * Our rows are prefixed `<id>-` and the rows we own are dropped before the new ones are
 * written, because membership is decided by `provider == <id>` and a stale row would keep
 * being listed. A model key owned by a different provider is never touched, and a native
 * `[providers.<id>.oauth]` login survives the table rewrite.
 */
export function planKimi(input: AppPlanInput): AppPlan {
  const { dirname } = pathOps(input)
  const path = input.paths.kimiConfig
  const raw = input.read(path)
  if (raw === null && !input.exists(dirname(path))) {
    return row('not-installed', [path], { reason: '没有 ~/.kimi-code 目录' })
  }
  const document = splitToml(raw ?? '')
  const lines = document.lines
  const table = dottedTable(['providers', ENTRY_ID])
  const url = urlOf(input)
  const changes: ClientChange[] = []

  const previousUrl = readTomlString(lines, table, 'base_url')
  if (previousUrl !== url) changes.push({ label: `${table}.base_url`, before: previousUrl, after: url })
  if (input.hasKey) {
    changes.push({ label: `${table}.api_key`, before: maskSecret(String(readTomlString(lines, table, 'api_key') ?? '')), after: KEY_PLACEHOLDER })
  }

  const body = [
    tomlTableHeader(['providers', ENTRY_ID]),
    tomlStringLiteral('type', 'openai'),
    tomlStringLiteral('base_url', url),
    ...(input.hasKey ? [tomlStringLiteral('api_key', KEY_PLACEHOLDER)] : []),
  ]
  if (hasTomlTable(lines, table)) {
    // Splicing only up to the next header leaves `[providers.modelport.oauth]` in place,
    // so a native login is not lost by rewriting the connection keys.
    const start = lines.findIndex(line => isHeaderLine(line) && headerName(line) === table)
    let end = start + 1
    while (end < lines.length && !isHeaderLine(lines[end])) end += 1
    lines.splice(start, end - start, ...body)
  } else {
    appendTomlTable(lines, body)
  }

  const owned = lines
    .filter(line => isHeaderLine(line))
    .map(line => headerName(line))
    .filter(name => name.startsWith('models.'))
    .filter(name => readTomlString(lines, name, 'provider') === ENTRY_ID)
  for (const name of owned) removeTomlTable(lines, name)
  const modelKeys: string[] = []
  for (const route of input.routeNames) {
    const key = `${ENTRY_ID}-${route}`
    modelKeys.push(key)
    appendTomlTable(lines, [
      tomlTableHeader(['models', key]),
      tomlStringLiteral('model', route),
      tomlStringLiteral('provider', ENTRY_ID),
    ])
  }
  if (readTomlString(lines, null, 'default_model') === null && modelKeys.length > 0) {
    setTomlString(lines, null, 'default_model', modelKeys[0])
  }
  return finalize(input, row('ready', [path], {
    files: [{ path, content: joinToml(document), private: input.hasKey }],
    changes,
    manualStep: input.hasKey ? null : '没有规范 key：地址已改，请把该条目的 api_key 改成目标网关的 key',
  }))
}

// ---------------------------------------------------------------------------
// MiniMax Code
// ---------------------------------------------------------------------------

/**
 * MiniMax Code: `custom_provider.<id>` in `config.yaml`.
 *
 * A node whose `kind` is not `custom` is the client's own account provider, so it is
 * reported rather than overwritten. `defaultModel` and the sibling providers stay exactly
 * as they were: this console does not choose the user's model here.
 */
export function planMcode(input: AppPlanInput): AppPlan {
  const path = input.paths.mcodeConfig
  const raw = input.read(path)
  if (raw === null) return row('not-installed', [path], { reason: '没有 MiniMax Code 的 config.yaml' })
  const existing = readChildBlock(raw, 'custom_provider', ENTRY_ID)
  const kind = existing === null ? null : readYamlScalar(existing, 'kind')
  if (existing !== null && kind !== null && kind !== 'custom') {
    return row('no-entry', [path], {
      reason: `custom_provider.${ENTRY_ID} 的 kind 是 ${kind}，那是客户端自己的账号位，控制台不覆盖`,
    })
  }
  const url = urlOf(input)
  const models: Record<string, unknown> = {}
  for (const name of input.routeNames) models[name] = { name, enabled: true }
  const node: Record<string, unknown> = {
    name: PROFILE_NAME,
    kind: 'custom',
    enabled: true,
    api: 'openai-completions',
    options: input.hasKey ? { baseURL: url, apiKey: KEY_PLACEHOLDER } : { baseURL: url },
    models,
  }
  const content = setChildBlock(raw, 'custom_provider', ENTRY_ID, node)
  const optionsBlock = existing === null ? null : readNestedBlock(existing, ['options'])
  const beforeUrl = optionsBlock === null ? null : readYamlScalar(optionsBlock, 'baseURL')
  const changes: ClientChange[] = []
  if (beforeUrl !== url) changes.push({ label: `custom_provider.${ENTRY_ID}.options.baseURL`, before: beforeUrl, after: url })
  if (input.hasKey) {
    changes.push({
      label: `custom_provider.${ENTRY_ID}.options.apiKey`,
      before: maskSecret(String(optionsBlock === null ? '' : readYamlScalar(optionsBlock, 'apiKey') ?? '')),
      after: KEY_PLACEHOLDER,
    })
  }
  return finalize(input, row('ready', [path], {
    files: [{ path, content, private: input.hasKey }],
    changes,
    manualStep: input.hasKey ? null : '没有规范 key：地址已改，请把该条目的 apiKey 改成目标网关的 key',
  }))
}

// ---------------------------------------------------------------------------
// Oh My Pi
// ---------------------------------------------------------------------------

/**
 * Oh My Pi: `providers.<id>` in `models.yml`.
 *
 * `api` is an enumerated value the client validates for the **whole file**: one bad node
 * drops every custom provider, so only a value from the client's own enum is written.
 * Creating `models.yml` next to an existing `models.json` is refused - that migration is
 * the client's job, and writing the new file would hide the old providers.
 */
export function planOmp(input: AppPlanInput): AppPlan {
  const { join, dirname } = pathOps(input)
  const yml = join(dirname(input.paths.ompModels), 'models.yaml')
  const path = input.exists(yml) ? yml : input.paths.ompModels
  if (input.exists(join(dirname(path), 'models.json')) && !input.exists(path)) {
    return row('no-entry', [path], {
      reason: '这个 Oh My Pi 只有 models.json，迁移成 models.yml 由客户端自己做',
      manualStep: '先启动一次 Oh My Pi 让它生成 models.yml，之后切换由控制台代写',
    })
  }
  const raw = input.read(path)
  if (raw === null && !input.exists(dirname(path))) {
    return row('not-installed', [path], { reason: '没有 Oh My Pi 的 agent 目录' })
  }
  const url = urlOf(input)
  const node: Record<string, unknown> = {
    baseUrl: url,
    api: 'openai-completions',
    models: input.routeNames.map(name => ({ id: name })),
  }
  if (input.hasKey) node.apiKey = KEY_PLACEHOLDER
  const content = setNestedBlock(raw ?? '', ['providers', ENTRY_ID], node)
  const existing = readNestedBlock(raw ?? '', ['providers', ENTRY_ID])
  const beforeUrl = existing === null ? null : readYamlScalar(existing, 'baseUrl')
  const changes: ClientChange[] = []
  if (beforeUrl !== url) changes.push({ label: `providers.${ENTRY_ID}.baseUrl`, before: beforeUrl, after: url })
  if (input.hasKey) {
    changes.push({
      label: `providers.${ENTRY_ID}.apiKey`,
      before: maskSecret(String(existing === null ? '' : readYamlScalar(existing, 'apiKey') ?? '')),
      after: KEY_PLACEHOLDER,
    })
  }
  return finalize(input, row('ready', [path], {
    files: [{ path, content, private: input.hasKey }],
    changes,
    manualStep: input.hasKey ? null : '没有规范 key：地址已改，请把该条目的 apiKey 改成目标网关的 key（它也可以填一个环境变量名）',
  }))
}

// ---------------------------------------------------------------------------
// Pi
// ---------------------------------------------------------------------------

/** Pi's `models.json`: one `providers.<id>` node. The default selection stays the client's. */
export function planPi(input: AppPlanInput): AppPlan {
  const { dirname } = pathOps(input)
  const path = input.paths.piModels
  const raw = input.read(path)
  if (raw === null && !input.exists(dirname(path))) {
    return row('not-installed', [path], { reason: '没有 Pi 的 agent 目录' })
  }
  const doc = raw === null ? {} : parseJsonObject(raw)
  if (!isRecord(doc)) return row('error', [path], { reason: 'models.json 不是可解析的 JSON 对象' })
  const providers = { ...(isRecord(doc.providers) ? doc.providers : {}) }
  const previous = isRecord(providers[ENTRY_ID]) ? (providers[ENTRY_ID] as Record<string, unknown>) : null
  const url = urlOf(input)
  const node: Record<string, unknown> = {
    name: PROFILE_NAME,
    baseUrl: url,
    api: 'openai-completions',
    models: input.routeNames.map(name => ({ id: name, name })),
  }
  if (input.hasKey) node.apiKey = KEY_PLACEHOLDER
  providers[ENTRY_ID] = node
  const content = stringifyJson(raw, { ...doc, providers })
  const beforeUrl = typeof previous?.baseUrl === 'string' ? previous.baseUrl : null
  const changes: ClientChange[] = []
  if (beforeUrl !== url) changes.push({ label: `providers.${ENTRY_ID}.baseUrl`, before: beforeUrl, after: url })
  if (input.hasKey) {
    changes.push({ label: `providers.${ENTRY_ID}.apiKey`, before: maskSecret(String(previous?.apiKey ?? '')), after: KEY_PLACEHOLDER })
  }
  return finalize(input, row('ready', [path], {
    files: [{ path, content, private: input.hasKey }],
    changes,
    reason: 'Pi 的默认供应商与默认模型由客户端自己选（控制台不写它的 settings.json）',
    manualStep: input.hasKey ? null : '没有规范 key：地址已改，请把该条目的 apiKey 改成目标网关的 key',
  }))
}

// ---------------------------------------------------------------------------
// GitHub Copilot CLI
// ---------------------------------------------------------------------------

/**
 * Copilot CLI: `providers.json`, two arrays - `providers` and `models`.
 *
 * Copilot validates the whole file strictly (unknown keys, a name containing `/`,
 * duplicates), so the entry carries only documented fields: `type` openai, `wireApi`
 * completions, literal key. The client's own `settings.json` model selection is not
 * written: removing the model the user is on would break the running session.
 */
export function planCopilot(input: AppPlanInput): AppPlan {
  const { dirname } = pathOps(input)
  const path = input.paths.copilotProviders
  const raw = input.read(path)
  if (raw === null && !input.exists(dirname(path))) {
    return row('not-installed', [path], { reason: '没有 ~/.copilot 目录' })
  }
  const doc = raw === null || raw.trim() === '' ? {} : parseJsonObject(raw)
  if (!isRecord(doc)) return row('error', [path], { reason: 'providers.json 必须是 JSON 对象' })
  if (doc.providers !== undefined && !Array.isArray(doc.providers)) {
    return row('error', [path], { reason: 'providers.json 的 providers 必须是数组' })
  }
  if (doc.models !== undefined && !Array.isArray(doc.models)) {
    return row('error', [path], { reason: 'providers.json 的 models 必须是数组' })
  }
  const providers = Array.isArray(doc.providers) ? (doc.providers as unknown[]) : []
  const models = Array.isArray(doc.models) ? (doc.models as unknown[]) : []
  const url = urlOf(input)
  const entry: Record<string, unknown> = { name: ENTRY_ID, type: 'openai', wireApi: 'completions', baseUrl: url }
  if (input.hasKey) entry.apiKey = KEY_PLACEHOLDER
  const nextProviders = providers.filter(item => !(isRecord(item) && item.name === ENTRY_ID))
  nextProviders.push(entry)
  const nextModels = models.filter(item => !(isRecord(item) && item.provider === ENTRY_ID))
  for (const name of input.routeNames) nextModels.push({ id: name, provider: ENTRY_ID })

  const previous = providers.find(item => isRecord(item) && item.name === ENTRY_ID)
  const beforeUrl = isRecord(previous) && typeof previous.baseUrl === 'string' ? previous.baseUrl : null
  const changes: ClientChange[] = []
  if (beforeUrl !== url) changes.push({ label: `providers.modelport.baseUrl`, before: beforeUrl, after: url })
  if (input.hasKey) {
    changes.push({
      label: 'providers.modelport.apiKey',
      before: maskSecret(String(isRecord(previous) ? (previous.apiKey ?? '') : '')),
      after: KEY_PLACEHOLDER,
    })
  }
  const content = stringifyJson(raw, { ...doc, providers: nextProviders, models: nextModels })
  return finalize(input, row('ready', [path], {
    files: [{ path, content, private: input.hasKey }],
    changes,
    manualStep: input.hasKey ? null : '没有规范 key：地址已改，请把该条目的 apiKey 改成目标网关的 key',
  }))
}

// ---------------------------------------------------------------------------
// DeepSeek Harness
// ---------------------------------------------------------------------------

/** The credential reference the harness resolves; the key itself never sits in the patch. */
export const DSH_REF = 'MODELPORT_DSH_MODELPORT'

const DSH_PROFILES = ['web', 'desktop', 'headless', 'acp']

/** One `llm-pi-ai` sequence item, as a standalone document (dash removed, indent zeroed). */
function harnessItemDocument(raw: string): { lines: string[]; eol: string; item: string[] } | null {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.split(/\r?\n/)
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const range = rootSeqItemRange(lines, 'id', 'llm-pi-ai')
  if (!range) return { lines, eol, item: [] }
  const item = lines
    .slice(range[0], range[1])
    .map((line, index) => (line.trim() === '' ? '' : index === 0 ? `  ${line.slice(1).trimStart()}` : line))
    .map(line => (line.trim() === '' ? '' : line.slice(Math.min(2, line.length))))
  return { lines, eol, item }
}

function indentItem(document: string): string[] {
  const lines = document
    .split(/\r?\n/)
    .filter((line, index, all) => !(line === '' && index === all.length - 1))
    .map(line => (line.trim() === '' ? '' : `  ${line}`))
  const first = lines.shift() ?? 'id: llm-pi-ai'
  return [`- ${first.trimStart()}`, ...lines]
}

/**
 * DeepSeek Harness: `profiles/<p>/cordis.patch.yml`, one `llm-pi-ai` entry per profile.
 *
 * Three ported properties are load-bearing:
 * - the key goes into `.credentials.yaml` under `refs.<ref>` and the patch only names the
 *   reference, so no secret lands in a file the client rewrites;
 * - every existing profile is written in one operation, because a provider that exists
 *   only in `web` reads as a half-switched client;
 * - when two profiles already disagree about our node the write is refused: only one copy
 *   is ours to know, and overwriting the other discards the user's edit.
 */
export function planDsh(input: AppPlanInput): AppPlan {
  const { join } = pathOps(input)
  const home = input.paths.dshHome
  const found = DSH_PROFILES.filter(name => input.exists(join(home, 'profiles', name)))
  if (found.length === 0) {
    return row('not-installed', [join(home, 'profiles')], { reason: '没有 DeepSeek Harness 的 profile 目录' })
  }
  if (!input.hasKey) {
    return row('blocked', [join(home, '.credentials.yaml')], {
      reason: '没有规范 key：Harness 的密钥在凭据文件里，地址改了也连不上',
    })
  }
  const homePatch = input.read(join(home, 'cordis.patch.yml'))
  if (homePatch !== null && homePatch.includes('llm-pi-ai')) {
    const document = harnessItemDocument(homePatch)
    if (document !== null && document.item.length > 0 && readNestedBlock(`${document.item.join('\n')}\n`, ['config']) !== null) {
      return row('blocked', [join(home, 'cordis.patch.yml')], {
        reason: 'home 级补丁里的 llm-pi-ai 带 config，它会盖过所有 profile；请先在那里删掉这一段',
      })
    }
  }

  const url = urlOf(input)
  const node: Record<string, unknown> = {
    displayName: PROFILE_NAME,
    baseURL: url,
    apiKeyEnv: DSH_REF,
    models: input.routeNames.map(name => ({ id: name, name, input: ['text'] })),
  }
  const files: PlannedFile[] = []
  const changes: ClientChange[] = []
  let observed: string | null = null
  for (const name of found) {
    const path = join(home, 'profiles', name, 'cordis.patch.yml')
    const raw = input.read(path) ?? ''
    const parsed = harnessItemDocument(raw)
    if (parsed === null) return row('error', [path], { reason: `${path} 的结构读不出来，拒绝改写` })
    const existing = parsed.item.length === 0 ? null : readNestedBlock(`${parsed.item.join('\n')}\n`, ['config', 'providers', ENTRY_ID])
    if (existing !== null) {
      const text = existing.replace(/\n\s*/g, '\n')
      if (observed === null) observed = text
      else if (observed !== text) {
        return row('error', files.map(file => file.path).concat(path), {
          reason: `${ENTRY_ID} 在各 profile 之间的内容不一致，控制台只认得其中一份，改写会覆盖你在 Harness 里做的修改`,
        })
      }
      const beforeUrl = readYamlScalar(existing, 'baseURL')
      if (beforeUrl !== url && changes.length === 0) {
        changes.push({ label: 'config.providers.modelport.baseURL', before: beforeUrl, after: url })
      }
    }
    const merged = setNestedBlock(
      parsed.item.length === 0 ? '' : `${parsed.item.join('\n')}\n`,
      ['config', 'providers', ENTRY_ID],
      node,
    )
    const body = indentItem(merged)
    const nextLines = [...parsed.lines]
    if (parsed.item.length > 0) {
      const range = rootSeqItemRange(nextLines, 'id', 'llm-pi-ai')
      if (range) nextLines.splice(range[0], range[1] - range[0], ...body)
    } else {
      while (nextLines.length > 0 && nextLines[nextLines.length - 1].trim() === '') nextLines.pop()
      nextLines.push(...body)
    }
    // Splicing a rendered block in can leave two blank lines where the file had one;
    // collapse them so the blank runs stay what the client wrote.
    files.push({ path, content: nextLines.join(parsed.eol).replace(/(\r?\n){3,}/g, '$1$1') + parsed.eol })
  }
  if (observed === null) changes.push({ label: 'config.providers.modelport', before: null, after: '新建' })

  const credentialsPath = join(home, '.credentials.yaml')
  const credentialsRaw = input.read(credentialsPath)
  const credentialsContent =
    credentialsRaw === null || credentialsRaw.trim() === ''
      ? `version: 1\nrefs:\n  ${DSH_REF}: "${KEY_PLACEHOLDER}"\nrecords: {}\n`
      : setNestedBlock(credentialsRaw, ['refs', DSH_REF], KEY_PLACEHOLDER)
  files.push({ path: credentialsPath, content: credentialsContent, private: true })

  return finalize(input, row('ready', files.map(file => file.path), {
    files,
    changes,
    reason: `写入 ${found.length} 个 profile，密钥走凭据引用 ${DSH_REF}`,
  }))
}

// ---------------------------------------------------------------------------
// Antigravity CLI
// ---------------------------------------------------------------------------

/**
 * Antigravity CLI reads no persistent endpoint: the reference implementation hands it
 * `GEMINI_API_KEY` / `GOOGLE_GEMINI_BASE_URL` in the environment of the terminal it
 * launches, and deliberately writes nothing into the client's own settings.
 *
 * This console does not launch terminals, so there is no honest write to make. The row
 * says exactly that instead of pretending the client was switched.
 */
export function planAgy(input: AppPlanInput): AppPlan {
  const { dirname } = pathOps(input)
  const path = input.paths.agySettings
  if (!input.exists(dirname(path))) return row('not-installed', [path], { reason: '没有 Antigravity CLI 的配置目录' })
  return row('no-entry', [path], {
    reason: 'Antigravity CLI 不读持久端点：地址与密钥只在启动它时注入环境，控制台不代它启动进程',
    manualStep: `启动前设 GOOGLE_GEMINI_BASE_URL=${input.origin} 与 GEMINI_API_KEY=目标网关的 key`,
  })
}

export const TOOL_APP_PLANNERS: Record<string, ClientAppPlanner> = {
  hermes: planHermes,
  kimi: planKimi,
  mcode: planMcode,
  omp: planOmp,
  pi: planPi,
  copilot: planCopilot,
  dsh: planDsh,
  agy: planAgy,
}
