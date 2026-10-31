/**
 * Gemini（Antigravity / Cloud Code）请求的**客户身份**构造。
 *
 * ## 为什么单独成模块、而且不 import 任何东西
 *
 * `gemini.ts` 导入了 `@deepseek-ai/dsh-llm`，vendor 文件在 `node --test` 下不能直接
 * `import()`（参数属性等 TS 形态），所以这里的规则全部放在一个零导入的纯模块里，
 * 判据可以直接被 `tests/channels/gemini-identity.test.ts` 钉住 —— 与
 * `qoder-session.ts` / `queue-wait.ts` 同款取舍。
 *
 * ## 这次改动换掉了什么（2026-11-01）
 *
 * 旧版把五个头**逐字**写死成第三方工具 `cmdc-pak` 抓到的值：
 *
 * ```
 * User-Agent:        antigravity/4.3.0 (cmdc-pak)
 * x-client-name:     antigravity
 * x-client-version:  4.3.0
 * x-machine-id:      cmdc-pak
 * x-vscode-sessionid: proxy
 * ```
 *
 * 三个问题，按取证强弱排列：
 *
 * 1. **UA 形状已经不是 Antigravity 的**。现役实现发的 UA 是
 *    `antigravity/hub/<version> (aidev_client; os_type=<os>; arch=<arch>; cl=<changelist>)`
 *    （版本号从 Antigravity 自动更新站的 manifest 现取，取不到时退回 `2.24.0` /
 *    changelist `1000335682`；`2.23.0` → `998057262`）。`4.3.0` 这一档根本不在
 *    Antigravity 的版本序列（`2.x`）里。
 * 2. **UA 与 `x-machine-id` 里都带着第三方工具名** `cmdc-pak`。Google 2026-06-18
 *    停的是「个人版这条线」，官方错误句的主语就是 **client**
 *    （`This client is no longer supported…migrate to the Antigravity suite`），
 *    把自己申报成一个已被下架的第三方客户端是自我否决。
 * 3. **现役客户端只发三个头**：`Content-Type`、`Authorization`、`User-Agent`
 *    （第三方实现里是显式的白名单：进来的头全部剥掉，只补协议必需的这几个）。
 *    多出的 `x-machine-id` / `x-vscode-sessionid` 没有任何现役客户端会发。
 *
 * ## 版本号与 changelist 从哪来
 *
 * 写死会腐：2026-11-01 按第三方实现退档值写死 `2.24.0 / 1000335682`，而自动更新站当天
 * 回答 `2.28.2 / 5937220255875072`。所以**现取**（`gemini-hub-manifest.ts`，6 小时缓存，
 * changelist 从 manifest 的 `<version>-<数字>/` 段取），优先级：
 *
 * - 版本：`DSH_GEMINI_ANTIGRAVITY_VERSION` > 更新站现取 > {@link ANTIGRAVITY_FALLBACK_VERSION}
 * - `cl=`：`DSH_GEMINI_CHANGELIST`（空串=不发）> 更新站现取 > {@link ANTIGRAVITY_CHANGELOTS} > 不发
 *
 * ⚠️ **拿不到就不编**：不在表里的版本不发 `cl=`；现取失败只退档，绝不发空 UA。
 * `DSH_GEMINI_HUB_MANIFEST=0` 关掉现取（只用覆盖与退档值）。
 *
 * ## 默认与回退
 *
 * 默认只发 `Content-Type` + `Authorization` + `User-Agent`。
 * `DSH_GEMINI_LEGACY_IDENTITY_HEADERS=1` 恢复旧的五个头**逐字**原样 —— 这是第一件
 * 该试的回退（与 `DSH_QODER_SESSION_REUSE=0` / `DSH_REASONING_REPLAY=0` 同口径）：
 * 若某个上游分支其实仍要那组旧头，一条环境变量就能验出来，不用重新打包。
 *
 * ⚠️ **取值仍未经本机复验**：本轮改动依据的是「现役第三方实现发什么」+ 公开更新清单，
 * 不是从你这台机器抓到的报文。每一个值都可以单独覆盖（下表），所以真机抓到差异时改
 * 默认值即可，不需要动调用点：
 *
 * | 覆盖项 | 作用 |
 * |---|---|
 * | `DSH_GEMINI_USER_AGENT` | 整条 `User-Agent`（给了就照发，不再拼装） |
 * | `DSH_GEMINI_ANTIGRAVITY_VERSION` | `antigravity/hub/` 后面的版本号 |
 * | `DSH_GEMINI_OS_TYPE` / `DSH_GEMINI_ARCH` | `os_type=` / `arch=` 两个字段 |
 * | `DSH_GEMINI_CHANGELIST` | `cl=` 字段（空串=不发） |
 * | `DSH_GEMINI_HUB_MANIFEST` | `0` 关掉更新站现取 |
 * | `DSH_GEMINI_LEGACY_IDENTITY_HEADERS` | `1` 恢复旧的五个头 |
 */

// ⚠️ **值层面零导入**：本模块要能被 `node --test` 直接 `import()`，而 node 的类型剥离
// 不把 `.js` 说明符回退到同名 `.ts`，所以这里不 import 任何运行时值（`gemini-hub-manifest.ts`
// 反过来只 `import type` 本模块的类型）。发布状态与 TTL 住在这里，「怎么去取」住在那边，
// 由调用方把两者接起来 —— 与 `qoder-session.ts` / `queue-wait.ts` 同款取舍。

/** 身份模块要读的进程特征（抽出来便于单测注入）。 */
export interface GeminiIdentityEnv {
  env: Record<string, string | undefined>
  platform: string
  arch: string
}

function defaultGeminiIdentityEnv(): GeminiIdentityEnv {
  return { env: process.env, platform: process.platform, arch: process.arch }
}

/**
 * 从自动更新站取到的发布号。
 *
 * `changelist` **可能没有**（manifest 的 url 段解析不出时不编造）。
 */
export interface AntigravityHubRelease {
  version: string
  changelist?: string
}

/** 与第三方实现同款：6 小时换一次，一天最多打 4 次。 */
export const GEMINI_HUB_MANIFEST_TTL_MS = 6 * 60 * 60 * 1000

let publishedRelease: AntigravityHubRelease | undefined
let publishedAt = 0

/**
 * 发布一次现取结果。
 *
 * ⚠️ `undefined`（取失败）**不动已有值**：一次网络意外不该把身份打回退档值，
 * 而「客户端版本太旧」恰恰是这条线最像被拒的形态。
 */
export function publishAntigravityHubRelease(release: AntigravityHubRelease | undefined, now = Date.now()): void {
  if (release === undefined || release.version === '') return
  publishedRelease = release
  publishedAt = now
}

/** 当前已发布的发布号（`undefined` = 这个进程还没取到过）。 */
export function antigravityHubRelease(): AntigravityHubRelease | undefined {
  return publishedRelease
}

/** 是否该去更新站重新取一次（TTL 过期或从没取到）。 */
export function antigravityHubReleaseStale(now = Date.now()): boolean {
  return publishedRelease === undefined || now - publishedAt >= GEMINI_HUB_MANIFEST_TTL_MS
}

/** 单测与回退路径用：清掉发布状态。 */
export function resetAntigravityHubRelease(): void {
  publishedRelease = undefined
  publishedAt = 0
}

/** 旧版那组 `cmdc-pak` 头，`DSH_GEMINI_LEGACY_IDENTITY_HEADERS=1` 时逐字恢复。 */
export const GEMINI_LEGACY_IDENTITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'User-Agent': 'antigravity/4.3.0 (cmdc-pak)',
  'x-client-name': 'antigravity',
  'x-client-version': '4.3.0',
  'x-machine-id': 'cmdc-pak',
  'x-vscode-sessionid': 'proxy',
})

/**
 * 版本 → changelist。
 *
 * ⚠️ 只有表里这两档有出处的 changelist 号。版本号换到别的档时**不要**编一个 `cl=`：
 * 发错 `cl=` 比不发更可疑，所以 {@link antigravityUserAgent} 在查不到时省略该字段。
 */
export const ANTIGRAVITY_CHANGELOTS: Readonly<Record<string, string>> = Object.freeze({
  '2.23.0': '998057262',
  '2.24.0': '1000335682',
})

/** 取不到更新站 manifest 时的退档（第三方实现的 `antigravityFallbackVersion`）。 */
export const ANTIGRAVITY_FALLBACK_VERSION = '2.24.0'

/** `process.platform` → Antigravity 的 `os_type=` 写法。 */
export function antigravityOsType(platform: string): string {
  if (platform === 'darwin') return 'darwin'
  if (platform === 'win32') return 'windows'
  return 'linux'
}

/** `process.arch` → Antigravity 的 `arch=` 写法（未认出的架构原样透传，不折算）。 */
export function antigravityArch(arch: string): string {
  return arch
}

/**
 * 拼 Antigravity hub 的 `User-Agent`。
 *
 * 形态：`antigravity/hub/<version> (aidev_client; os_type=<os>; arch=<arch>[; cl=<cl>])`
 *
 * ⚠️ `DSH_GEMINI_USER_AGENT` 给了就**整条照发**：真机抓到的 UA 与此拼装不同时，
 * 覆盖即可，不必改代码里的默认值。
 */
export function antigravityUserAgent(now: GeminiIdentityEnv = defaultGeminiIdentityEnv()): string {
  const override = now.env.DSH_GEMINI_USER_AGENT
  const trimmedOverride = typeof override === 'string' ? override.trim() : ''
  if (trimmedOverride !== '') return trimmedOverride

  // 版本号优先级：**显式覆盖 > 更新站现取 > 写死退档值**。
  const hub = antigravityHubRelease()
  const pinned = (now.env.DSH_GEMINI_ANTIGRAVITY_VERSION ?? '').trim()
  const version = pinned !== '' ? pinned : (hub?.version ?? ANTIGRAVITY_FALLBACK_VERSION)
  const osType = (now.env.DSH_GEMINI_OS_TYPE ?? '').trim() || antigravityOsType(now.platform)
  const arch = (now.env.DSH_GEMINI_ARCH ?? '').trim() || antigravityArch(now.arch)
  const changelistRaw = now.env.DSH_GEMINI_CHANGELIST
  // `DSH_GEMINI_CHANGELIST=''` 是显式「不发 cl」；没给这个变量时才按
  // 现取值 → 写死表 的顺序查。
  const changelist =
    changelistRaw !== undefined
      ? changelistRaw.trim()
      : (hub?.changelist ?? ANTIGRAVITY_CHANGELOTS[version] ?? '')

  const metadata = changelist === ''
    ? `aidev_client; os_type=${osType}; arch=${arch}`
    : `aidev_client; os_type=${osType}; arch=${arch}; cl=${changelist}`
  return `antigravity/hub/${version} (${metadata})`
}

/**
 * 除 `Content-Type` / `Authorization` 之外还要发哪些头。
 *
 * 默认 `{}` —— 现役客户端就只发那两个加 UA（UA 在返回值里，因为它属于身份）。
 * `DSH_GEMINI_LEGACY_IDENTITY_HEADERS=1` 时返回旧五件套。
 */
export function geminiIdentityHeaders(now: GeminiIdentityEnv = defaultGeminiIdentityEnv()): Record<string, string> {
  const legacy = (now.env.DSH_GEMINI_LEGACY_IDENTITY_HEADERS ?? '').trim() === '1'
  if (legacy) return { ...GEMINI_LEGACY_IDENTITY_HEADERS }
  return { 'User-Agent': antigravityUserAgent(now) }
}

/** 是否处于旧头回退态（调用方据此在日志里说清当前用的是哪套身份）。 */
export function geminiLegacyIdentityActive(now: GeminiIdentityEnv = defaultGeminiIdentityEnv()): boolean {
  return (now.env.DSH_GEMINI_LEGACY_IDENTITY_HEADERS ?? '').trim() === '1'
}

/**
 * 日志用的一行身份自述：用哪套头、版本与 changelist 从哪来。
 *
 * ⚠️ 「版本来源」必须写出来：更新站取不到时它会**静默**退到写死档，而那正是最像
 * 「客户端太旧被拒」的形态 —— 事后没有这行日志就查不出来。
 */
export function describeGeminiIdentity(now: GeminiIdentityEnv = defaultGeminiIdentityEnv()): string {
  if (geminiLegacyIdentityActive(now)) return 'legacy cmdc-pak header set (回退态)'
  const pinned = (now.env.DSH_GEMINI_ANTIGRAVITY_VERSION ?? '').trim()
  const hub = antigravityHubRelease()
  const source = pinned !== '' ? '覆盖值' : (hub === undefined ? '退档值（未取到更新站）' : '更新站现取')
  return `antigravity hub UA ${antigravityUserAgent(now)} [版本来源：${source}]`
}
