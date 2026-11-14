/**
 * Repointing the installed clients at the active gateway: gather, preview, apply.
 *
 * The shape follows `gatewayTrust.ts` on purpose. The page is a remote document served by
 * the gateway, so it gets **named capabilities, not paths**: it asks for a preview and
 * then names client ids, and this file re-derives every path, every current value and
 * every edit itself. A preview is therefore not a contract the page can tamper with -
 * `apply` runs the same gather again and writes what it finds now.
 *
 * The canonical key never leaves this process. Plans carry `KEY_PLACEHOLDER`; the value
 * is substituted immediately before the write, and a file that still contains the
 * placeholder is refused rather than written.
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { GatewayEntry } from './addressBook.ts'
import { normalizeOrigin } from './addressBook.ts'
import {
  catalogSlugs,
  CLIENT_LABELS,
  isClientId,
  maskSecret,
  planClaudeSettings,
  planCodeBuddySettings,
  planCodexToml,
  planQoderSettings,
  planTraeModelList,
  planWorkBuddyModels,
  unservedModels,
} from './clientSyncPlan.ts'
import type { ClientPaths, PlanResult } from './clientSyncPlan.ts'
import { ensureCanonicalKey, fetchRoutes } from './clientSyncRpc.ts'
import type { GatewayCredential } from './clientSyncRpc.ts'
import { readSqliteItemsLike, sqliteSidecar, writeSqliteItems } from './clientSqlite.ts'
import type { SqliteItem } from './clientSqlite.ts'
import { applyPlannedFiles } from './clientLiveWrite.ts'
import type { PlannedFile } from './clientLiveWrite.ts'
import { CLI_APP_PLANNERS } from './clientApps.ts'
import { TOOL_APP_PLANNERS } from './clientAppsTools.ts'
import type { AppPlan, AppPlanInput } from './clientApps.ts'
import { KEY_PLACEHOLDER } from '../shared/clientSync.ts'
import type {
  ClientApplyResult,
  ClientChange,
  ClientId,
  ClientSyncApplyResult,
  ClientSyncModel,
  ClientSyncPreview,
  ClientSyncRow,
  ClientSyncState,
} from '../shared/clientSync.ts'

const run = promisify(execFile)

/** Image names whose presence means "this fork will flush its state over our write". */
const SQLITE_GUARDS: Partial<Record<ClientId, string[]>> = {
  'trae-cn': ['Trae CN.exe', 'Trae CN'],
}

/**
 * Claude is installed when either its config dir exists or Desktop's MSIX package does.
 *
 * The package family is the measured one (`Claude_pzs8sxrjxfjjc`, Desktop 5.11492.2):
 * Desktop installs under `WindowsApps` and keeps its data in `Local\Packages`, so neither
 * `Roaming\Claude` nor `Program Files\Claude` exists - looking only there reads a real
 * install as absent.
 */
export function claudeClientInstalled(paths: ClientPaths, localAppData: string | undefined): boolean {
  if (existsSync(dirname(paths.claudeSettings))) return true
  if (localAppData && existsSync(join(localAppData, 'Packages', 'Claude_pzs8sxrjxfjjc'))) return true
  return false
}

/** Running process image names, lowercased, and whether the query itself succeeded. */
export async function runningImageNames(): Promise<{ names: Set<string>; known: boolean }> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await run('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true })
      const names = new Set<string>()
      for (const line of stdout.split(/\r?\n/)) {
        const match = /^"([^"]+)"/.exec(line)
        if (match) names.add(match[1].toLowerCase())
      }
      return { names, known: true }
    }
    const { stdout } = await run('ps', ['-axo', 'comm='])
    return {
      names: new Set(stdout.split(/\r?\n/).map(line => line.trim().toLowerCase()).filter(line => line !== '')),
      known: true,
    }
  } catch {
    // A failed query must not read as "nothing is running": the caller treats it as
    // unknown and refuses the write rather than editing a live fork's database.
    return { names: new Set(), known: false }
  }
}

export function isClientRunning(id: ClientId, running: Set<string>): boolean {
  const guards = SQLITE_GUARDS[id]
  if (!guards) return false
  return guards.some(name => running.has(name.toLowerCase()))
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/** Trae keeps its model list inside a SQLite table; every other client has a file. */
type Write = { kind: 'sqlite'; dbPath: string; items: SqliteItem[] }

interface ClientPlan {
  row: ClientSyncRow
  writes: Write[]
  /** Files this plan writes through the live-write engine (staged, journaled, backed up). */
  files: PlannedFile[]
}

function row(
  id: ClientId,
  state: ClientSyncState,
  paths: string[],
  changes: ClientChange[] = [],
  reason: string | null = null,
  manualStep: string | null = null,
  unserved: string[] = [],
): ClientPlan {
  return {
    row: { id, label: CLIENT_LABELS[id], state, paths, changes, reason, manualStep, unservedModels: unserved },
    writes: [],
    files: [],
  }
}

/** Turns a ported app planner's outcome into the row + files shape the page renders. */
function appPlan(id: ClientId, plan: AppPlan): ClientPlan {
  const result = row(id, plan.state, plan.paths, plan.changes, plan.reason, plan.manualStep, plan.unserved)
  result.files = plan.files
  return result
}

/**
 * The placeholder is what the plan carries; the panel must show something a person can
 * read. Swapped on the way out only, so the page never sees the token and `apply` still
 * substitutes the real value.
 */
function displayRow(item: ClientSyncRow, keyLabel: string): ClientSyncRow {
  return {
    ...item,
    changes: item.changes.map(change => ({
      ...change,
      before: change.before === KEY_PLACEHOLDER ? keyLabel : change.before,
      after: change.after === KEY_PLACEHOLDER ? keyLabel : change.after,
    })),
  }
}

function readText(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null
  } catch {
    return null
  }
}

/** Turns a planner result into a row + one file write, keeping the reason it gave. */
function filePlan(
  id: ClientId,
  path: string,
  result: PlanResult,
  unserved: string[] = [],
  manualStep: string | null = null,
): ClientPlan {
  if (result.kind === 'no-entry') return row(id, 'no-entry', [path], [], result.reason, manualStep, unserved)
  if (result.kind === 'bad-input') return row(id, 'error', [path], [], result.reason, null, unserved)
  if (result.kind === 'unchanged') return row(id, 'unchanged', [path], [], null, manualStep, unserved)
  const plan = row(id, 'ready', [path], result.changes, null, manualStep, unserved)
  plan.files.push({ path, content: result.content, private: result.content.includes(KEY_PLACEHOLDER) })
  return plan
}

export interface GatherInput {
  active: GatewayEntry
  gateways: GatewayCredential[]
  paths: ClientPaths
  running: Set<string>
  /** False when the platform query failed - never read as "nothing is running". */
  runningKnown: boolean
  /**
   * Claude is the one client whose config file may legitimately not exist yet: Desktop
   * bundles the CLI but never writes `~/.claude/settings.json` until it is configured.
   * Without this, "not installed" and "installed, never configured" would both create a
   * file for a client that may not be there.
   */
  claudeInstalled: boolean
  /** Where first-write backups and the write journal live (Electron `userData`). */
  dataDir: string
}

export interface Gathered {
  preview: ClientSyncPreview
  plans: ClientPlan[]
  /** The plaintext canonical key. Never serialized, never sent to the page. */
  key: string | null
}

/**
 * One gather serves both preview and apply, so what the user confirmed is what gets
 * written - the two cannot drift into different code paths.
 */
export async function gather(input: GatherInput): Promise<Gathered> {
  const origin = normalizeOrigin(input.active.url)
  if (origin === null) {
    return {
      preview: {
        origin: input.active.url,
        gatewayName: input.active.name,
        keyPreview: null,
        models: [],
        rows: [],
        keyDistribution: [],
        error: '当前网关地址无效',
      },
      plans: [],
      key: null,
    }
  }

  const canonical = await ensureCanonicalKey(input.gateways, origin)
  const key = canonical.key
  const keyPreview = key === null ? null : maskSecret(key)
  // Claude Desktop refuses a non-loopback http origin. The way out is access-path data
  // stored on the shell entry itself: an https entry is its own url, an http entry carries
  // the client https endpoint the user filled (or probed once). Never ask the gateway -
  // it cannot know whether this entry reaches it by IP or by a domain behind a proxy.
  const clientHttpsUrl = origin.startsWith('https:')
    ? origin
    : (typeof input.active.clientHttpsUrl === 'string' ? input.active.clientHttpsUrl : null)
  let models: ClientSyncModel[] = []
  let routeError: string | null = null
  try {
    models = await fetchRoutes(origin, key)
  } catch (error) {
    routeError = error instanceof Error ? error.message : String(error)
  }
  const routeNames = models.map(model => model.name)
  const plans: ClientPlan[] = []

  // --- Codex -------------------------------------------------------------
  {
    const raw = readText(input.paths.codexConfig)
    if (raw === null) {
      plans.push(row('codex', 'not-installed', [input.paths.codexConfig], [], '没有 ~/.codex/config.toml'))
    } else {
      const result = planCodexToml(raw, { origin, routeNames, writeKey: key !== null })
      const catalogRaw = readText(input.paths.codexCatalog)
      const slugs = catalogRaw === null ? [] : (catalogSlugs(catalogRaw) ?? [])
      const plan = filePlan('codex', input.paths.codexConfig, result, unservedModels(slugs, routeNames))
      if (key === null && (plan.row.state === 'ready' || plan.row.state === 'unchanged')) {
        plan.row.manualStep = '没有规范 key：地址已改，但 provider 表里没写密钥，请把 experimental_bearer_token 设成目标网关的 key'
      }
      if (catalogRaw === null && (plan.row.state === 'ready' || plan.row.state === 'unchanged')) {
        plan.row.reason = '没有 modelport-catalog.json：Codex 选择器仍会用内置模型名'
      }
      plans.push(plan)
    }
  }

  // --- Claude Code -------------------------------------------------------
  {
    const raw = readText(input.paths.claudeSettings)
    if (raw === null && !input.claudeInstalled) {
      plans.push(row('claude', 'not-installed', [input.paths.claudeSettings], [], '没有 Claude 的配置目录，也没有检测到 Claude Desktop'))
    } else {
      const result = planClaudeSettings(raw, { origin, writeKey: key !== null })
      const plan = filePlan('claude', input.paths.claudeSettings, result)
      if (key === null && (plan.row.state === 'ready' || plan.row.state === 'unchanged')) {
        plan.row.manualStep = '没有规范 key：请自己在 Claude 设置里填 ANTHROPIC_AUTH_TOKEN'
      }
      plans.push(plan)
    }
  }

  // --- Qoder / Qoder CN --------------------------------------------------
  for (const [id, path] of [['qoder', input.paths.qoder], ['qoder-cn', input.paths.qoderCn]] as [ClientId, string][]) {
    const raw = readText(path)
    if (raw === null) {
      plans.push(row(id, 'not-installed', [path], [], `没有 ${path}`))
      continue
    }
    // With a canonical key and the gateway's routes, the custom model list is rebuilt to
    // exactly those routes (see planQoderSettings); the old model names are replaced, so
    // there is nothing left "unserved" to warn about.
    const rebuild = key !== null && models.length > 0
    const result = planQoderSettings(raw, { origin, writeKey: key !== null, routes: models, keyPreview })
    const plan = filePlan(id, path, result, rebuild ? [] : unservedModels(qoderModelNames(raw), routeNames))
    if (plan.row.state === 'no-entry') {
      plan.row.manualStep = '先在客户端里添加一个自定义模型（OpenAI 兼容），之后控制台才能代它改地址'
    } else if (key === null && (plan.row.state === 'ready' || plan.row.state === 'unchanged')) {
      plan.row.manualStep = NO_KEY_MANUAL_STEP
    } else if (rebuild && (plan.row.state === 'ready' || plan.row.state === 'unchanged')) {
      plan.row.manualStep = '写入后若客户端未显示新建的自定义模型，重启它重新读取 settings.json 即可'
    }
    plans.push(plan)
  }

  // --- WorkBuddy ---------------------------------------------------------
  {
    const raw = readText(input.paths.workbuddy)
    if (raw === null) {
      plans.push(row('workbuddy', 'not-installed', [input.paths.workbuddy], [], '没有 ~/.workbuddy/models.json'))
    } else {
      const result = planWorkBuddyModels(raw, { origin, writeKey: key !== null, routes: models, keyPreview })
      const plan = filePlan(
        'workbuddy',
        input.paths.workbuddy,
        result,
        key !== null && models.length > 0 ? [] : unservedModels(workBuddyModelNames(raw), routeNames),
      )
      if (key === null && (plan.row.state === 'ready' || plan.row.state === 'unchanged')) {
        plan.row.manualStep = NO_KEY_MANUAL_STEP
      }
      plans.push(plan)
    }
  }

  // --- CodeBuddy CN ------------------------------------------------------
  {
    const path = input.paths.codeBuddyCn
    const raw = readText(path)
    if (raw === null) {
      plans.push(row('codebuddy-cn', 'not-installed', [path], [], '没有 CodeBuddy CN 的 User/settings.json'))
    } else {
      const result = planCodeBuddySettings(raw, { origin, writeKey: false, routes: models })
      const plan = filePlan(
        'codebuddy-cn',
        path,
        result,
        models.length > 0 ? [] : unservedModels(codeBuddyModelNames(raw), routeNames),
      )
      // The key lives in the fork's encrypted secret storage, so it cannot be minted
      // here - same boundary as TRAE, and it has to be said out loud.
      plan.row.manualStep = '在 CodeBuddy 的自定义端点里把 API Key 改成目标网关的 key（一次即可，之后切换不用再改）'
      plans.push(plan)
    }
  }

  // --- Trae CN -----------------------------------------------------------
  {
    const path = input.paths.traeCn
    if (!existsSync(path)) {
      plans.push(row('trae-cn', 'not-installed', [path], [], '没有 Trae CN 的 state.vscdb'))
    } else if (!input.runningKnown) {
      plans.push(row('trae-cn', 'blocked', [path], [], '无法确认 Trae CN 是否在运行，拒绝写入'))
    } else if (isClientRunning('trae-cn', input.running)) {
      plans.push(row('trae-cn', 'app-running', [path], [], 'Trae CN 正在运行：它退出时会整份回写状态，现在写入会被覆盖。请先退出 Trae CN'))
    } else {
      const sidecar = sqliteSidecar(path)
      if (sidecar !== null) {
        plans.push(row('trae-cn', 'app-running', [path], [], `${sidecar} 非空，数据库还有未合并的页`))
      } else {
        plans.push(await planTrae(path, origin, routeNames))
      }
    }
  }

  // --- The ported client integrations -----------------------------------
  //
  // Registry-driven on purpose: adding a client is a planner plus one id, not another
  // block in this function. Each planner decides its own install / no-entry / blocked
  // state, because "no such file" means something different for every one of them.
  {
    const appInput: AppPlanInput = {
      origin,
      clientHttpsUrl,
      routeNames,
      hasKey: key !== null,
      keyValue: key,
      paths: input.paths,
      read: readText,
      exists: path => existsSync(path),
    }
    for (const [id, planner] of Object.entries({ ...CLI_APP_PLANNERS, ...TOOL_APP_PLANNERS })) {
      if (!isClientId(id)) continue
      plans.push(appPlan(id, planner(appInput)))
    }
  }

  const preview: ClientSyncPreview = {
    origin,
    gatewayName: input.active.name,
    keyPreview,
    models,
    rows: plans.map(plan => displayRow(plan.row, key === null ? '目标网关的 key' : maskSecret(key))),
    keyDistribution: canonical.distribution,
    ...(canonical.error !== null || routeError !== null
      ? { error: [canonical.error, routeError === null ? null : `读取目标网关模型清单失败：${routeError}`].filter(Boolean).join('；') }
      : {}),
  }
  return { preview, plans, key }
}

function qoderModelNames(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as { providers?: Record<string, { models?: { model?: unknown }[] }> }
    const names: string[] = []
    for (const provider of Object.values(parsed.providers ?? {})) {
      for (const model of provider?.models ?? []) if (typeof model?.model === 'string') names.push(model.model)
    }
    return names
  } catch {
    return []
  }
}

function workBuddyModelNames(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as { vendor?: unknown; id?: unknown }[]
    return parsed.filter(entry => entry?.vendor === 'Custom' && typeof entry.id === 'string').map(entry => entry.id as string)
  } catch {
    return []
  }
}

function codeBuddyModelNames(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as { 'oaicopilot.models'?: { id?: unknown }[] }
    return (parsed['oaicopilot.models'] ?? []).filter(model => typeof model?.id === 'string').map(model => model.id as string)
  } catch {
    return []
  }
}

/**
 * TRAE: every account-prefixed `model_list_map` row, all agent labels at once.
 *
 * The same custom model is repeated in each label it is offered to, so rewriting one
 * label would leave the client behaving differently per mode.
 */
async function planTrae(dbPath: string, origin: string, routeNames: string[]): Promise<ClientPlan> {
  let items: Map<string, string>
  try {
    items = await readSqliteItemsLike(dbPath, '%AI.agent.model.model_list_map')
  } catch (error) {
    return row('trae-cn', 'error', [dbPath], [], error instanceof Error ? error.message : String(error))
  }
  if (items.size === 0) return row('trae-cn', 'no-entry', [dbPath], [], 'state.vscdb 里没有 model_list_map')

  const changes: ClientChange[] = []
  const writes: SqliteItem[] = []
  const current: string[] = []
  let missing = 0
  for (const [key, value] of items) {
    current.push(...traeModelNames(value))
    const result = planTraeModelList(value, { origin, writeKey: false })
    if (result.kind === 'no-entry') {
      missing += 1
      continue
    }
    if (result.kind === 'bad-input') return row('trae-cn', 'error', [dbPath], [], result.reason)
    if (result.kind === 'unchanged') continue
    for (const change of result.changes) {
      if (!changes.some(existing => existing.label === change.label)) changes.push(change)
    }
    writes.push({ key, value: result.content })
  }
  if (writes.length === 0) {
    return missing === items.size
      ? row('trae-cn', 'no-entry', [dbPath], [], 'model_list_map 里没有 custom_openai_compatible 模型')
      : row('trae-cn', 'unchanged', [dbPath], [], null, TRAE_MANUAL_STEP, unservedModels(current, routeNames))
  }
  const plan = row('trae-cn', 'ready', [dbPath], changes, null, TRAE_MANUAL_STEP, unservedModels(current, routeNames))
  plan.writes.push({ kind: 'sqlite', dbPath, items: writes })
  return plan
}

const TRAE_MANUAL_STEP = '在 Trae 的自定义模型里把 API Key 改成目标网关的 key（一次即可；ak 由客户端加密保存，控制台不能代写）'

/**
 * Without a canonical key the endpoint still moves, but the client keeps its old key and
 * every request would 401 - so the row has to say so rather than look finished.
 */
const NO_KEY_MANUAL_STEP = '没有规范 key：地址已改，但 API Key 仍是旧的，请自己在客户端里填成目标网关的 key'

function traeModelNames(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const names: string[] = []
    for (const list of Object.values(parsed)) {
      if (!Array.isArray(list)) continue
      for (const item of list) {
        if (item === null || typeof item !== 'object') continue
        const entry = item as { provider?: unknown; name?: unknown }
        if (entry.provider !== 'custom_openai_compatible' || typeof entry.name !== 'string') continue
        const at = entry.name.indexOf('//')
        names.push(at === -1 ? entry.name : entry.name.slice(at + 2))
      }
    }
    return names
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

/** Substitutes the key and refuses to write a plan that still contains the placeholder. */
function materialize(content: string, key: string | null): string {
  if (key === null) {
    if (content.includes(KEY_PLACEHOLDER)) throw new Error('没有规范 key，无法写入需要密钥的配置')
    return content
  }
  const written = content.split(KEY_PLACEHOLDER).join(key)
  if (written.includes(KEY_PLACEHOLDER)) throw new Error('密钥占位符未被替换，拒绝写入')
  return written
}

export async function buildPreview(input: GatherInput): Promise<ClientSyncPreview> {
  return (await gather(input)).preview
}

/**
 * Writes the named clients. Everything is re-derived here: the page supplies ids only,
 * so a stale or forged preview cannot aim a write at another file.
 */
export async function applySync(input: GatherInput, clientIds: string[]): Promise<ClientSyncApplyResult> {
  const wanted = clientIds.filter(isClientId)
  if (wanted.length === 0) return { ok: false, results: [], error: '没有指定要写入的客户端' }
  const { plans, key, preview } = await gather(input)
  // A key-distribution failure still leaves address-only plans whose rows carry a manual
  // step; only an unusable origin leaves nothing to write at all.
  if (plans.length === 0) return { ok: false, results: [], error: preview.error ?? '没有可写入的客户端' }

  const results: ClientApplyResult[] = []
  for (const id of wanted) {
    const plan = plans.find(item => item.row.id === id)
    if (!plan) {
      results.push({ id, ok: false, message: '这个客户端不在本次预览里', backups: [] })
      continue
    }
    if (plan.row.state !== 'ready') {
      results.push({ id, ok: false, message: plan.row.reason ?? `状态为 ${plan.row.state}，未写入`, backups: [] })
      continue
    }
    const backups: string[] = []
    try {
      const files = plan.files.map(file => ({
        ...file,
        content: file.content === null ? null : materialize(file.content, key),
      }))
      if (files.length > 0) {
        const written = await applyPlannedFiles(files, input.dataDir)
        backups.push(...written.backups)
      }
      for (const write of plan.writes) {
        const items = write.items.map(item => ({ key: item.key, value: materialize(item.value, key) }))
        const { backup } = await writeSqliteItems(write.dbPath, items)
        if (backup !== '') backups.push(backup)
      }
      const manual = plan.row.manualStep === null ? '' : `；还需你手动：${plan.row.manualStep}`
      const touched = files.length + plan.writes.length
      results.push({ id, ok: true, message: `已写入 ${touched} 处${manual}`, backups: backups.filter(item => item !== '') })
    } catch (error) {
      results.push({ id, ok: false, message: error instanceof Error ? error.message : String(error), backups })
    }
  }
  return { ok: results.every(item => item.ok), results }
}