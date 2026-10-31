/**
 * Antigravity 客户端版本号的**现取**（自动更新站 manifest）。
 *
 * ⚠️ **本模块零导入**：`parseAntigravityHubManifest` / `hubManifestName` 是身份正确性的
 * 判据，必须能被 `node --test` 直接 `import()`（`--experimental-strip-types` 不把 `.js`
 * 说明符回退到同名 `.ts`，所以带导入的 vendor 文件在测试里导不进来）。取到的发布号由
 * 调用方交给 `gemini-identity.ts::publishAntigravityHubRelease`，缓存与 TTL 也住在那里 ——
 * 与 `qoder-session.ts` / `queue-wait.ts` 同款取舍。
 *
 * ## 为什么不能写死
 *
 * 身份头里的 `antigravity/hub/<version>` 与 `cl=<changelist>` 必须像现役客户端。
 * 2026-11-01 实测：本仓按第三方实现退档值写死 `2.24.0 / 1000335682`，而更新站当天回答
 * **`2.28.2 / 5937220255875072`** —— 写死值当天就落后四个版本。这类常量一定会腐。
 *
 * ## manifest 形态（按实测解析，不猜）
 *
 * `GET <base>/manifest/latest-<arch>-<os>.yml`
 *
 * ```yaml
 * version: 2.28.2
 * files:
 *   - url: https://storage.googleapis.com/antigravity-public/antigravity-hub/2.28.2-5937220255875072/windows-x64/Antigravity.zip
 * ```
 *
 * - 版本号取顶层 `version:`；
 * - **changelist 藏在 `url` 的 `<version>-<数字>/` 段里**（manifest 没有独立的
 *   `changelist` 键）；
 * - 实测存在：`x64-win`、`arm64-win`、`arm64-mac`、`x64-mac`、`x64-linux`；
 *   `arm64-linux` **404** ⇒ Linux 一律走 `x64-linux`（我们只要版本号与 changelist，
 *   本机是 arm linux 时拿 x64 清单也一样给这两个号）。
 *
 * ⚠️ 只拿 `version` / `changelist`。UA 里的 `os_type=…; arch=…` 用**我们进程**的平台，
 * 不拿 manifest 的 `windows-x64` token —— 那是打包产物目录名，拼法与 UA 字段不是同一套
 * （`darwin-arm` vs `arch=arm64`）。
 *
 * ## 失败面
 *
 * 无网 / 非 2xx / 解析不出 / 超时 ⇒ 返回 `undefined`，调用方**不动已发布的值**
 * （见 `gemini-identity.ts`）：这条线取不到版本号不能把对话打死。
 * `DSH_GEMINI_HUB_MANIFEST=0` 由调用方判，本模块只管取。
 */

// ⚠️ 只 `import type`（运行时被抹掉，不产生模块解析）：类型的事实来源在
// `gemini-identity.ts`（发布状态住那边），这里不重复定义一份。
import type { AntigravityHubRelease } from './gemini-identity.js'

/** manifest 基址（第三方实现用的是同一个自动更新站）。 */
export const GEMINI_HUB_MANIFEST_BASE =
  'https://antigravity-hub-auto-updater-974169037036.us-central1.run.app/manifest'

/** manifest 拉取超时。 */
export const GEMINI_HUB_MANIFEST_TIMEOUT_MS = 10_000

/**
 * manifest 文件名。
 *
 * @returns `latest-<arch>-<os>.yml`；认不出的平台返回 `undefined`（**不猜 URL**）。
 */
export function hubManifestName(platform: string, arch: string): string | undefined {
  const os = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform === 'linux' ? 'linux' : undefined
  if (os === undefined) return undefined
  if (os === 'linux') return 'latest-x64-linux.yml'
  return `latest-${arch === 'arm64' ? 'arm64' : 'x64'}-${os}.yml`
}

/**
 * 解析 `version:` 与 `url` 里的 `<version>-<数字>/`。
 *
 * ⚠️ changelist 只在**与该版本号一致**的段里认：`/2.28.2-5937220255875072/windows-x64/`。
 * 别的号段（旧版本残留、依赖包路径）的数字不得当成本次的号。
 */
export function parseAntigravityHubManifest(text: string): AntigravityHubRelease | undefined {
  const version = /^version:\s*([0-9][0-9A-Za-z.\-]*)\s*$/m.exec(text)?.[1]
  if (version === undefined || version === '') return undefined
  const changelist = new RegExp(`/${version}-(\\d+)/`).exec(text)?.[1]
  return changelist === undefined ? { version } : { version, changelist }
}

/**
 * 拉一次 manifest。
 *
 * @param options.fetchImpl - 注入的 fetch（渠道出网由调用方桥接，默认 `fetch`）。
 * @returns 解析出的发布号；任何失败（含平台认不出）返回 `undefined`，**不抛**。
 */
export async function fetchAntigravityHubRelease(options: {
  platform: string
  arch: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<AntigravityHubRelease | undefined> {
  const name = hubManifestName(options.platform, options.arch)
  if (name === undefined) return undefined
  try {
    const fetchImpl = options.fetchImpl ?? fetch
    const response = await fetchImpl(`${GEMINI_HUB_MANIFEST_BASE}/${name}`, {
      signal: AbortSignal.timeout(options.timeoutMs ?? GEMINI_HUB_MANIFEST_TIMEOUT_MS),
    })
    if (!response.ok) return undefined
    return parseAntigravityHubManifest(await response.text())
  } catch {
    return undefined
  }
}
