/**
 * 官方客户端版本探测（时间敏感）。
 *
 * 目的：身份头里的版本号不再写死在代码里，也**不依赖本机是否安装客户端**。
 * 取值优先级：
 *
 * ```
 * env 覆盖 → 官方更新接口（6h TTL） → 本机安装（mtime 变化即重读） → 兜底常量
 * ```
 *
 * - **官方优先**：上游校验的是「官方现役客户端」；用户本机装的是旧版时，也应
 *   按官网最新版发 UA。官网取不到（断网/被墙）才退回本机版本。
 * - **同步读、异步刷**：请求头构造点调用 `*ClientVersion()` 是同步 O(1)，只读
 *   内存；网络刷新在模块加载时启动，之后每 6h 一次，失败保留旧值。
 * - **mtime 兜底**：本机 `product.json` / `.qoder-versions` 变化时立即重读，
 *   用于官网接口不可达但用户刚升级客户端的场景。
 * - **fallback 显式**：两条路都取不到时用代码常量，`source` 标 `fallback`。
 *
 * 官方接口（2026-11-05 实测）：
 * - WorkBuddy（国内版/国际版同一产品族）：`https://copilot.tencent.com/v2/update?platform=workbuddy-win32-<arch>-user&version=<当前>`
 *   → 200 `{ productVersion: "5.9.3.42398134" }`；204 = 已是最新。
 *   **CodeBuddy（腾讯）已于 2026-11-05 更名为 WorkBuddy（国内版）**，`buddy`
 *   渠道与国际版渠道共用这条取值链。
 * - Qoder CN：`https://static.qoder.com.cn/qoder-app/releases/latest.yml` → `version: 0.5.3`。
 * - Qoder 国际：`https://static.qoder.com/...`（网络不通时自动跳过）。
 *
 * ⚠️ 这里只覆盖已有公开更新接口的渠道。Trae/ZCode/Raccoon 的更新接口尚未确认，
 * 仍走本机安装 + fallback；确认后按同一形状接入。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type ClientVersionSource = 'env' | 'official' | 'local-install' | 'fallback'

export interface ClientVersionInfo {
  version: string
  source: ClientVersionSource
  /** 本次读到的时刻（epoch ms）。`fallback` 时为读取失败的时刻。 */
  checkedAt: number
}

/** 官方接口的刷新周期：6h。客户端发版频率远低于此。 */
const OFFICIAL_TTL_MS = 6 * 60 * 60 * 1000

/** 两次 stat 之间的最小间隔：60s 足够「客户端升级后下一分钟生效」。 */
const STAT_TTL_MS = 60_000

/** 本机没有安装 WorkBuddy、官网也取不到时的兜底值。 */
export const WORKBUDDY_FALLBACK_VERSION = '5.9.3'

/** 本机没有安装 Qoder、官网也取不到时的兜底值。 */
export const QODER_FALLBACK_VERSION = '0.5.3'

/** Trae 的兜底值（2026-11-05 本机 Trae CN 1.107.1 的 product.json）。 */
export const TRAE_FALLBACK_APP_VERSION = '3.4.15'
export const TRAE_FALLBACK_IDE_VERSION = '1.107.1'
export const TRAE_FALLBACK_VERSION_CODE = '20250325'

const VERSION_PATTERN = /^\d+(?:\.\d+){1,3}$/
/** 日期式版本码（`20250325` / `20260811`），不是语义版本。 */
const VERSION_CODE_PATTERN = /^\d{4,}$/
/** 官方返回的 `5.9.3.42398134`：UA 只取前三段。 */
const BUILD_VERSION_PATTERN = /^\d+(?:\.\d+){1,2}/

interface CacheEntry {
  info: ClientVersionInfo
  file: string
  mtimeMs: number
  lastStatAt: number
}

interface OfficialEntry {
  version: string
  checkedAt: number
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
const official = new Map<string, OfficialEntry>()

function isVersion(value: unknown): value is string {
  return typeof value === 'string' && VERSION_PATTERN.test(value.trim())
}

/** `5.9.3.42398134` → `5.9.3`；已经合规的值原样返回。 */
export function normalizeBuildVersion(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const match = BUILD_VERSION_PATTERN.exec(value.trim())
  return match?.[0]
}

function envVersion(name: string): string | undefined {
  const raw = process.env[name]
  return isVersion(raw) ? raw.trim() : undefined
}

function envVersionCode(name: string): string | undefined {
  const raw = process.env[name]
  if (typeof raw !== 'string') return undefined
  const value = raw.trim()
  return VERSION_CODE_PATTERN.test(value) ? value : undefined
}

/** 版本码：日期式（`20250325`）或 build 号（`2.3.100185`）都接受。 */
export function normalizeVersionCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (VERSION_CODE_PATTERN.test(trimmed)) return trimmed
  return normalizeBuildVersion(trimmed)
}

function readJsonRecord(file: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function readJsonField(file: string, fields: readonly string[]): string | undefined {
  const parsed = readJsonRecord(file)
  if (parsed === undefined) return undefined
  for (const field of fields) {
    const value = normalizeBuildVersion(parsed[field])
    if (value !== undefined) return value
  }
  return undefined
}

/**
 * Windows `LOCALAPPDATA/Programs/...` 的候选路径。
 *
 * ## 为什么 Linux 宿主也要找 Windows 路径（2026-11-08 实测）
 *
 * 网关可以跑在 WSL 的 headless 守护进程里，而官方客户端装在**同一台机器的
 * Windows 侧**。进程内 `LOCALAPPDATA` 为空，旧实现直接跳过本机安装分支，
 * 于是 WorkBuddy / Qoder / Trae 在 WSL 上恒为 `fallback`（UI 显示「落后」），
 * 即使官方客户端就在 `/mnt/c/Users/<user>/AppData/Local/Programs` 下。
 * 本机安装只是**兜底来源**，读它不改变「官方优先」的取值链。
 */
function winPrograms(...rest: string[]): string[] {
  const roots = new Set<string>()
  const local = process.env.LOCALAPPDATA
  if (local !== undefined && local !== '') roots.add(join(local, 'Programs'))
  if (process.platform !== 'win32') {
    for (const drive of ['c']) {
      const users = `/mnt/${drive}/Users`
      try {
        for (const user of readdirSync(users)) {
          roots.add(join(users, user, 'AppData', 'Local', 'Programs'))
        }
      } catch {
        // 不是 WSL / 没挂载 C:：没有候选路径，走官方源或 fallback。
      }
    }
  }
  return [...roots].map(root => join(root, ...rest))
}

function workbuddyProductFiles(): string[] {
  return [
    ...winPrograms('WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'product.json'),
    '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/product.json',
  ]
}

/**
 * WorkBuddy 桌面客户端版本。
 *
 * `product.json` 的 `genieVersion` 就是安装器写入的桌面版本，比
 * `cli/package.json` 的 `@genie/agent-cli` 版本更贴近 UA 里的客户端形态。
 */
export function workbuddyClientVersion(now = Date.now()): ClientVersionInfo {
  const fromEnv = envVersion('MODELPORT_WORKBUDDY_VERSION')
  if (fromEnv !== undefined) return { version: fromEnv, source: 'env', checkedAt: now }
  const fromOfficial = readOfficial('workbuddy', now)
  if (fromOfficial !== undefined) return fromOfficial
  for (const file of workbuddyProductFiles()) {
    const found = readFileVersion('workbuddy', file, ['genieVersion'], now)
    if (found !== undefined) return found
  }
  return { version: WORKBUDDY_FALLBACK_VERSION, source: 'fallback', checkedAt: now }
}

/**
 * WorkBuddy 国内版（原 CodeBuddy）客户端版本。
 *
 * 2026-11-05 起腾讯把「CodeBuddy（腾讯）」更名为 **WorkBuddy（国内版）**——
 * 与 `workbuddy` 渠道（WorkBuddy 国际版）是同一产品的两个区域发行，共用同一
 * 套客户端与更新源。因此版本号直接复用国际版那条取值链
 * （env → 官方 /v2/update → 本机 product.json → fallback），**不再**单独抓
 * CodeBuddy IDE release notes：那是另一条产品线（4.12.x），与国内版客户端的
 * 5.9.x 版本体系不同，混用会把身份头改回错误形态。
 */
export function codebuddyClientVersion(now = Date.now()): ClientVersionInfo {
  const fromEnv = envVersion('MODELPORT_CODEBUDDY_VERSION')
  if (fromEnv !== undefined) return { version: fromEnv, source: 'env', checkedAt: now }
  return workbuddyClientVersion(now)
}

/** Qoder（国际版 / 中国版）客户端版本：官方 latest.yml → `.qoder-versions` 最大目录。 */
export function qoderClientVersion(channel: 'qoder' | 'qodercn' = 'qoder', now = Date.now()): ClientVersionInfo {
  const fromEnv = envVersion(
    channel === 'qodercn' ? 'MODELPORT_QODERCN_VERSION' : 'MODELPORT_QODER_VERSION',
  )
  if (fromEnv !== undefined) return { version: fromEnv, source: 'env', checkedAt: now }
  const fromOfficial = readOfficial(channel, now)
  if (fromOfficial !== undefined) return fromOfficial

  const dirs = channel === 'qodercn'
    ? [
      ...winPrograms('Qoder CN', '.qoder-versions'),
      ...winPrograms('QoderWork CN', '.qoder-versions'),
    ]
    : [
      ...winPrograms('Qoder', '.qoder-versions'),
      join(homedir(), 'Library', 'Application Support', 'Qoder', '.qoder-versions'),
    ]
  for (const dir of dirs) {
    const found = readDirVersion(channel, dir, now)
    if (found !== undefined) return found
  }
  return { version: QODER_FALLBACK_VERSION, source: 'fallback', checkedAt: now }
}

export interface TraeClientIdentity {
  /** `X-Ide-Version` / `Trae/<version>` 用；product.json 的 `appVersion`。 */
  appVersion: string
  /** `X-Ide-Version-Code` / `X-App-Version-Code` 用；product.json 的 `traeVersionCode`。 */
  versionCode: string
  /** VS Code 基线版本；market 头的 `VSCode <ver>` 用。 */
  ideVersion: string
  source: ClientVersionSource
  checkedAt: number
}

/**
 * Trae 现役客户端的身份字段。
 *
 * 官方工作台在 `productService.appVersion` 里读 `product.json` 的 `appVersion`
 * （本机 3.4.15），`X-Ide-Version` 与 `X-Ide-Version-Code` 由 native 从
 * common params 填入；`X-Device-Type` / `X-OS-Version` / `X-Device-Brand`
 * 分别来自运行时的 `os_name` / `os_version` / `device_model`（见
 * `workbench.desktop.main.js` 的 `icube.event.getCommonParams` 映射）。
 *
 * 本机 `product.json` 还带 `version`（1.107.1，VS Code 基线）与
 * `traeVersionCode`（20250325，日期式代码），分别给 market 头与版本码用。
 */
export function traeClientIdentity(now = Date.now()): TraeClientIdentity {
  const envApp = envVersion('MODELPORT_TRAE_VERSION')
  const envCode = envVersionCode('MODELPORT_TRAE_VERSION_CODE')
  const envIde = envVersion('MODELPORT_TRAE_IDE_VERSION')
  if (envApp !== undefined) {
    return {
      appVersion: envApp,
      versionCode: envCode ?? TRAE_FALLBACK_VERSION_CODE,
      ideVersion: envIde ?? TRAE_FALLBACK_IDE_VERSION,
      source: 'env',
      checkedAt: now,
    }
  }

  const files = [
    ...winPrograms('Trae CN', 'resources', 'app', 'product.json'),
    ...winPrograms('Trae', 'resources', 'app', 'product.json'),
    '/Applications/Trae.app/Contents/Resources/app/product.json',
    '/Applications/Trae CN.app/Contents/Resources/app/product.json',
  ]

  for (const file of files) {
    if (!existsSync(file)) continue
    const parsed = readJsonRecord(file)
    if (parsed === undefined) continue
    const appVersion = normalizeBuildVersion(parsed.appVersion) ?? normalizeBuildVersion(parsed.version)
    if (appVersion === undefined) continue
    const versionCode = normalizeVersionCode(parsed.traeVersionCode) ?? TRAE_FALLBACK_VERSION_CODE
    const ideVersion = normalizeBuildVersion(parsed.version) ?? TRAE_FALLBACK_IDE_VERSION
    return { appVersion, versionCode, ideVersion, source: 'local-install', checkedAt: now }
  }

  return {
    appVersion: TRAE_FALLBACK_APP_VERSION,
    versionCode: TRAE_FALLBACK_VERSION_CODE,
    ideVersion: TRAE_FALLBACK_IDE_VERSION,
    source: 'fallback',
    checkedAt: now,
  }
}

/** 管理端快照条目：一条渠道「下一笔请求实际会发」的客户端身份（B4）。 */
export interface ClientIdentitySnapshotEntry {
  channel: string
  /** 当前生效的版本号（请求头里实际会发的值）。 */
  version: string
  source: ClientVersionSource
  checkedAt: number
  /** 人类可读补充（如 Trae 的版本码与 VS Code 基线）。 */
  detail?: string
}

/**
 * 汇总全部接入 `client-identity` 的渠道的当前身份。
 *
 * 供 `identity.snapshot` RPC / 管理 API / 渠道页徽标使用。同步、无副作用：
 * 每次调用都会走一遍各自的取值链（内部有 stat 节流，不会真的每笔都打文件系统）。
 */
export function clientIdentitySnapshot(now = Date.now()): ClientIdentitySnapshotEntry[] {
  const workbuddy = workbuddyClientVersion(now)
  const buddy = codebuddyClientVersion(now)
  const qoderIntl = qoderClientVersion('qoder', now)
  const qoderCn = qoderClientVersion('qodercn', now)
  const trae = traeClientIdentity(now)
  return [
    { channel: 'workbuddy', version: workbuddy.version, source: workbuddy.source, checkedAt: workbuddy.checkedAt },
    { channel: 'buddy', version: buddy.version, source: buddy.source, checkedAt: buddy.checkedAt },
    { channel: 'qoder', version: qoderIntl.version, source: qoderIntl.source, checkedAt: qoderIntl.checkedAt },
    { channel: 'qodercn', version: qoderCn.version, source: qoderCn.source, checkedAt: qoderCn.checkedAt },
    {
      channel: 'trae',
      version: trae.appVersion,
      source: trae.source,
      checkedAt: trae.checkedAt,
      detail: `X-Ide-Version-Code: ${trae.versionCode} · VSCode ${trae.ideVersion}`,
    },
  ]
}

function readOfficial(channel: string, now: number): ClientVersionInfo | undefined {
  const entry = official.get(channel)
  if (entry === undefined) return undefined
  // 过期后仍用旧值顶一阵（官网临时不可达），但超过 24h 就退回本机/常量，
  // 避免把一个早已过期的版本号当成「官方确认值」无限期发出去。
  if (now - entry.checkedAt > OFFICIAL_TTL_MS * 4) return undefined
  return { version: entry.version, source: 'official', checkedAt: entry.checkedAt }
}

/* ------------------------------------------------------------------ 官方刷新 */

function cacheFilePath(): string {
  const home = process.env.MODELPORT_HOME?.trim() || join(homedir(), '.modelport')
  return join(home, 'identity-cache.json')
}

function loadOfficialCache(): void {
  try {
    const parsed = JSON.parse(readFileSync(cacheFilePath(), 'utf8')) as Record<string, unknown>
    for (const [channel, value] of Object.entries(parsed)) {
      if (value === null || typeof value !== 'object') continue
      const record = value as Record<string, unknown>
      const version = normalizeBuildVersion(record.version)
      const checkedAt = typeof record.checkedAt === 'number' ? record.checkedAt : 0
      if (version === undefined || checkedAt <= 0) continue
      official.set(channel, { version, checkedAt, expiresAt: checkedAt + OFFICIAL_TTL_MS })
    }
  } catch {
    // 缓存不存在/损坏都不影响请求：下一次官方刷新会重建。
  }
}

function saveOfficialCache(): void {
  try {
    const payload: Record<string, { version: string; checkedAt: number }> = {}
    for (const [channel, entry] of official) {
      payload[channel] = { version: entry.version, checkedAt: entry.checkedAt }
    }
    const file = cacheFilePath()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  } catch {
    // 落盘失败只是下次启动少一个缓存，不影响本次进程内的值。
  }
}

function setOfficial(channel: string, version: string, now: number): boolean {
  const normalized = normalizeBuildVersion(version)
  if (normalized === undefined) return false
  const previous = official.get(channel)?.version
  official.set(channel, { version: normalized, checkedAt: now, expiresAt: now + OFFICIAL_TTL_MS })
  return previous !== normalized
}

/** Playwright/测试环境禁止启动定时器与网络。 */
function shouldAutoStart(): boolean {
  return process.env.NODE_TEST_CONTEXT === undefined
    && process.env.MODELPORT_DISABLE_IDENTITY_FETCH !== '1'
}

/**
 * 启动官方版本刷新：模块加载时跑一次，之后每 6h 一次。
 *
 * `unref()` 保证 worker 退出不被定时器拖住；刷新失败只保留旧值，不抛错。
 */
export function startClientIdentityRefresh(): void {
  loadOfficialCache()
  void refreshOfficialVersions()
  const timer = setInterval(() => {
    void refreshOfficialVersions()
  }, OFFICIAL_TTL_MS)
  timer.unref?.()
}

/** 手动刷新（测试/管理接口用）。 */
export async function refreshOfficialVersions(now = Date.now()): Promise<void> {
  await Promise.allSettled([
    refreshWorkbuddyOfficial(now),
    refreshQoderOfficial('qodercn', now),
    refreshQoderOfficial('qoder', now),
  ])
  saveOfficialCache()
}

/**
 * B5 配套：风控事件触发的**立即**刷新。
 *
 * 上游把账号判为「非官方客户端使用」（`channel_risk_control`）时，最常见的原因
 * 是身份头里的版本号过期。6h 定时刷新在这种场景下太慢——宿主会在命中风控时
 * 通过 `identity.refresh` RPC 调这里，强制重拉官方源；刷新结果下一笔请求生效。
 */
export async function forceIdentityRefresh(): Promise<ClientIdentitySnapshotEntry[]> {
  await refreshOfficialVersions()
  return clientIdentitySnapshot()
}

async function refreshWorkbuddyOfficial(now: number): Promise<void> {
  // ⚠️ `platform` 描述的是**要呈现的客户端**，不是跑网关的宿主（2026-11-08 实测）：
  // `workbuddy-linux-x64-user` 被端点判为非法（HTTP 400），而
  // `workbuddy-win32-x64-user` 从 WSL 里请求同样返回 204。网关跑在 WSL 时发的
  // 仍是 WorkBuddy 桌面身份，官方源必须按 win32 查，平台守卫只会让 WSL 恒 fallback。
  const asset = process.arch === 'arm64' ? 'arm64' : 'x64'
  const current = official.get('workbuddy')?.version
    ?? workbuddyClientVersion(now).version
  const url = 'https://copilot.tencent.com/v2/update'
    + `?platform=workbuddy-win32-${asset}-user`
    + `&version=${encodeURIComponent(current)}`
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) })
    // 204 = 已是最新，把 current 记为官方确认值，刷新 TTL。
    if (response.status === 204) {
      setOfficial('workbuddy', current, now)
      return
    }
    if (!response.ok) return
    const data = await response.json() as Record<string, unknown>
    const version = data.productVersion ?? data.version
    if (typeof version === 'string') setOfficial('workbuddy', version, now)
  } catch {
    // 断网/超时：保留已有值（官方缓存或本机安装或兜底）。
  }
}

const QODER_OFFICIAL_URLS: Readonly<Record<'qoder' | 'qodercn', readonly string[]>> = {
  qodercn: ['https://static.qoder.com.cn/qoder-app/releases/latest.yml'],
  // ⚠️ `static.qoder.com` 在 2026-11-08 的 WSL 网络里不可达（fetch failed），
  // 而同一份国际版清单在 `download.qoder.com`（实测 200，version 0.5.6）。
  // 把可达的那个排在前面，静态站留作回退；国际版与国内版是两条产品线，
  // 不互相借用版本号。
  qoder: [
    'https://download.qoder.com/qoder-app/releases/latest.yml',
    'https://static.qoder.com/qoder-app/releases/latest.yml',
  ],
}

async function refreshQoderOfficial(channel: 'qoder' | 'qodercn', now: number): Promise<void> {
  for (const url of QODER_OFFICIAL_URLS[channel]) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8_000) })
      if (!response.ok) continue
      const text = await response.text()
      const match = /^version:\s*(\S+)/m.exec(text)
      if (match?.[1] !== undefined && setOfficial(channel, match[1], now)) return
      if (match?.[1] !== undefined) return
    } catch {
      // 换下一个官方源。
    }
  }
}

/* ------------------------------------------------------------------ 本机读取 */

/** 读单个 JSON 文件里的版本字段；mtime 未变则直接复用缓存。 */
function readFileVersion(
  cacheKey: string,
  file: string,
  fields: readonly string[],
  now: number,
): ClientVersionInfo | undefined {
  if (!existsSync(file)) return undefined
  const cached = cache.get(cacheKey)
  if (cached !== undefined && cached.file === file && now - cached.lastStatAt < STAT_TTL_MS) {
    return cached.info
  }
  try {
    const mtimeMs = statSync(file).mtimeMs
    if (cached !== undefined && cached.file === file && cached.mtimeMs === mtimeMs) {
      cached.lastStatAt = now
      return cached.info
    }
    const version = readJsonField(file, fields)
    if (version === undefined) return undefined
    const info: ClientVersionInfo = { version, source: 'local-install', checkedAt: now }
    cache.set(cacheKey, { info, file, mtimeMs, lastStatAt: now })
    return info
  } catch {
    return undefined
  }
}

/** 读目录下最大的语义版本子目录；目录 mtime 未变则复用缓存。 */
function readDirVersion(cacheKey: string, dir: string, now: number): ClientVersionInfo | undefined {
  if (!existsSync(dir)) return undefined
  const cached = cache.get(cacheKey)
  if (cached !== undefined && cached.file === dir && now - cached.lastStatAt < STAT_TTL_MS) {
    return cached.info
  }
  try {
    const mtimeMs = statSync(dir).mtimeMs
    if (cached !== undefined && cached.file === dir && cached.mtimeMs === mtimeMs) {
      cached.lastStatAt = now
      return cached.info
    }
    const versions = readdirSync(dir)
      .filter(name => VERSION_PATTERN.test(name))
      .sort(compareVersions)
    const latest = versions.at(-1)
    if (latest === undefined) return undefined
    const info: ClientVersionInfo = { version: latest, source: 'local-install', checkedAt: now }
    cache.set(cacheKey, { info, file: dir, mtimeMs, lastStatAt: now })
    return info
  } catch {
    return undefined
  }
}

/** 语义版本比较（只处理数字段，够用于 0.5.3 / 5.9.3 这类客户端版本）。 */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** 测试用：清空缓存，让下一次调用重新读文件/等官方刷新。 */
export function resetClientVersionCache(): void {
  cache.clear()
  official.clear()
}

// worker 加载即开始刷新；测试环境（NODE_TEST_CONTEXT）不启动，避免网络依赖。
if (shouldAutoStart()) startClientIdentityRefresh()
