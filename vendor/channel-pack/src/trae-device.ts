/**
 * TRAE 签到设备号（16 位纯数字）的发现与校验。
 *
 * ## 为什么不能自己生成
 *
 * 上游只认**官方客户端登记过的**设备号。2026-11-09 实测（同一账号、同一 token）：
 *
 * | `X-Device-Id` | claim 响应 |
 * |---|---|
 * | 本插件生成的 32 位 hex | `{"code":9074,"message":"签到人数过多"}`（连续多天、每次都是） |
 * | 官方客户端 `storage.json` 里的 16 位号 | `{"code":0,"message":"success"}` |
 *
 * 9074 的文案指向「人多」，实际是设备号未登记的拒签码 —— 拿它当瞬时失败重试
 * 只会每 30 分钟空转一次（见 `auto-checkin.ts` 的 `isDeviceFailure`）。
 *
 * 官方客户端的登记形态：`%APPDATA%\Trae CN\User\globalStorage\storage.json`
 * 里以 `iCubeAuthInfo://icube-dc:<16 位数字>` 为键的条目，**每个登录会话一条**
 * （两个账号就是两个号）。值本身是客户端加密的，无需也不应解析。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 一个候选设备号及其来源（来源写进面板提示，便于排障）。 */
export interface TraeDeviceCandidate {
  deviceId: string
  /** 读到该号的 `storage.json` 绝对路径。 */
  source: string
}

export interface TraeDeviceDiscovery {
  /** 官方客户端登记过的设备号（按文件内出现顺序去重）。 */
  devices: TraeDeviceCandidate[]
  /** 实际检查过的路径（含不存在的），排障用。 */
  searched: string[]
}

/** `iCubeAuthInfo://icube-dc:<16 位数字>` —— 官方客户端登记签到设备号的键。 */
const DEVICE_KEY = /^iCubeAuthInfo:\/\/icube-dc:(\d{16})$/

/** 设备号必须是 16 位纯数字；其它形态（含本插件旧版生成的 32 位 hex）一律拒签。 */
export function isTraeDeviceId(value: unknown): value is string {
  return typeof value === 'string' && /^\d{16}$/.test(value)
}

/**
 * 从一份 `storage.json` 文本里取设备号。
 *
 * 坏 JSON / 非对象一律返回空数组：这是纯读取，读不懂就当没有，不要抛给调用方。
 */
export function extractTraeDeviceIds(raw: string, source: string): TraeDeviceCandidate[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return []
  const out: TraeDeviceCandidate[] = []
  for (const key of Object.keys(parsed as Record<string, unknown>)) {
    const match = DEVICE_KEY.exec(key)
    if (match !== null) out.push({ deviceId: match[1], source })
  }
  return out
}

/**
 * 官方客户端 `storage.json` 的候选路径。
 *
 * - Windows（控制台本机）：`%APPDATA%\Trae CN\…`
 * - macOS：`~/Library/Application Support/Trae CN/…`
 * - Linux / WSL：`~/.config/Trae CN/…`；WSL 网关另外扫 `/mnt/c/Users/*`，
 *   因为官方客户端通常装在 Windows 侧 —— 网关与客户端不同机时自然扫不到，
 *   此时面板让用户手工粘贴。
 */
export function traeStorageCandidates(
  platform: string = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const suffix = join('User', 'globalStorage', 'storage.json')
  const roots: string[] = []
  if (platform === 'win32') {
    const appData = env.APPDATA
    if (typeof appData === 'string' && appData.length > 0) roots.push(join(appData, 'Trae CN'))
  } else if (platform === 'darwin') {
    roots.push(join(homedir(), 'Library', 'Application Support', 'Trae CN'))
  } else {
    roots.push(join(homedir(), '.config', 'Trae CN'))
    for (const home of listWindowsUserHomes()) {
      roots.push(join(home, 'AppData', 'Roaming', 'Trae CN'))
    }
  }
  return roots.map((root) => join(root, suffix))
}

/** `/mnt/c/Users` 下可读的用户目录；不存在（非 WSL）或不可读时返回空。 */
function listWindowsUserHomes(): string[] {
  const base = '/mnt/c/Users'
  try {
    return readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^(?!Public$|Default$|Default User$|All Users$)/.test(entry.name))
      .map((entry) => join(base, entry.name))
  } catch {
    return []
  }
}

/** 汇总本机（及 WSL 宿主的 Windows 侧）能读到的全部已登记设备号。 */
export function discoverTraeDevices(): TraeDeviceDiscovery {
  const searched = traeStorageCandidates()
  const seen = new Set<string>()
  const devices: TraeDeviceCandidate[] = []
  for (const path of searched) {
    if (!existsSync(path)) continue
    let raw: string
    try {
      raw = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    for (const candidate of extractTraeDeviceIds(raw, path)) {
      if (seen.has(candidate.deviceId)) continue
      seen.add(candidate.deviceId)
      devices.push(candidate)
    }
  }
  return { devices, searched }
}