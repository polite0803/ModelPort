/**
 * 宿主机代理：**脚本写文件、网关读文件**，代理关掉时自动退回直连。
 *
 * ## 为什么需要这个机制（WSL/NAT 的真实边界）
 *
 * WSL 里的网关访问不到 `cloudcode-pa.googleapis.com`，而宿主机的 Clash 默认只监听
 * `127.0.0.1:7890`；NAT 模式下 WSL 与 Windows **不共享 loopback**，唯一能通的路是
 * 「Clash 允许局域网 + 访问 Windows 的 vEthernet 地址」。这些开关会随 Clash 启停、
 * 换端口、换机器而变化，所以不能钉死在 systemd 的 `Environment=` 里（那需要重启服务，
 * 而且代理没开时整批渠道会一起失败）。
 *
 * 分工：
 * - `scripts/wsl-host-proxy.mjs` 负责**探测**（TCP + 真正穿过代理 CONNECT），
 *   写出可达的地址；没探测到就写空值。
 * - 本模块负责**使用**：每次出网前带缓存地读文件，再对本机到代理端口做一次
 *   存活探测（15 秒缓存）。文件缺失 / 空值 / 探测失败一律当「没有宿主机代理」，
 *   请求照常走直连 —— 绝不把「宿主机的代理没开」变成全渠道故障。
 *
 * ## 文件格式（脚本是唯一写者）
 *
 * ```json
 * {
 *   "url": "http://172.29.144.1:7890",
 *   "checkedAt": "2026-11-11T04:05:00.000Z",
 *   "test": "cloudcode-pa.googleapis.com:443"
 * }
 * ```
 *
 * `url` 为 `null`、文件不存在、JSON 损坏、协议不支持、端口探测失败 —— 全部按
 * 「没有宿主机代理」处理，不抛错。
 *
 * 位置：`$MODELPORT_HOST_PROXY_FILE`（`off`/`0` 表示彻底关闭该机制），
 * 缺省 `~/.modelport/host-proxy.json`（worker 宿主会按数据目录显式设置）。
 */
import { readFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import path from 'node:path'
import { normalizeProxy } from './opencode.js'

/** 文件内容最长 4 KiB：它只是一行地址，超大文件只可能是写坏了。 */
const MAX_CONFIG_BYTES = 4096
/** 文件读取缓存：脚本可能每 30 秒重写，网关不必每个请求都读盘。 */
const FILE_TTL_MS = 5_000
/** 端口存活探测缓存：代理中途关掉后，最多 15 秒退回直连。 */
const PROBE_TTL_MS = 15_000
/** 探测超时：本机/局域网的连接建立只需毫秒级，超过就是不通。 */
const PROBE_TIMEOUT_MS = 800

let fileCache: { path: string; at: number; url?: string } | undefined
let probeCache: { url: string; at: number; ok: boolean } | undefined

/** 清空缓存（测试用；也让「刚写完文件」在进程内立即可见）。 */
export function resetHostProxyCache(): void {
  fileCache = undefined
  probeCache = undefined
}

/**
 * 配置文件位置。
 *
 * - `MODELPORT_HOST_PROXY_FILE=off` / `0` / `false`：显式关闭，
 *   连读盘都不做（给「确定不需要代理的环境」一个零成本开关）。
 * - 其它非空值：按给定路径读（worker 宿主会设成 `<dataDir>/host-proxy.json`）。
 * - 缺省：`~/.modelport/host-proxy.json`。
 */
export function hostProxyConfigPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const override = env.MODELPORT_HOST_PROXY_FILE?.trim()
  if (override === 'off' || override === '0' || override === 'false') return undefined
  if (override !== undefined && override !== '') return override
  return path.join(homedir(), '.modelport', 'host-proxy.json')
}

/**
 * 解析配置文件内容。
 *
 * 只接受 `{ "url": "<host:port>" }`：地址还要过 `normalizeProxy`（协议白名单
 * http/https/socks5、必须有显式端口），与账号表单里手填代理同一套判据，
 * 免得脚本写出一个「看着能用、undici 侧却建不出 dispatcher」的地址。
 *
 * @returns 归一化后的代理地址；不可用时 `undefined`（不是错误）。
 */
export function parseHostProxyConfig(text: string): string | undefined {
  if (text.length > MAX_CONFIG_BYTES) return undefined
  let record: unknown
  try {
    record = JSON.parse(text)
  } catch {
    return undefined
  }
  if (record === null || typeof record !== 'object') return undefined
  const url = (record as { url?: unknown }).url
  if (typeof url !== 'string' || url.trim().length === 0) return undefined
  const parsed = normalizeProxy(url)
  return parsed.ok ? parsed.proxy.url : undefined
}

/** TCP 握手到代理端口；只证明「这个端口有人 listening」，不验证代理本身能用。 */
function portAlive(address: string): Promise<boolean> {
  const parsed = new URL(address)
  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : parsed.protocol.startsWith('socks') ? 1080 : 80))
  const host = parsed.hostname.replace(/^\[|\]$/g, '')
  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }
    const socket = connect({ host, port })
    socket.setTimeout(PROBE_TIMEOUT_MS)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

/**
 * 取当前可用的宿主机代理。
 *
 * 想定：`undefined` 是**正常结果**（代理没开），调用方直接走直连；只有配置读不到
 * 或探测失败的差别，都收敛成同一个返回值，因为两者对出网选择的含义相同。
 */
export async function resolveHostProxy(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const file = hostProxyConfigPath(env)
  if (file === undefined) return undefined

  const now = Date.now()
  if (fileCache === undefined || fileCache.path !== file || now - fileCache.at >= FILE_TTL_MS) {
    let url: string | undefined
    try {
      url = parseHostProxyConfig(await readFile(file, 'utf8'))
    } catch {
      // 文件不存在是常态（脚本没探测到可达代理），不是故障。
      url = undefined
    }
    fileCache = { path: file, at: now, url }
  }
  const url = fileCache.url
  if (url === undefined) return undefined

  if (probeCache === undefined || probeCache.url !== url || now - probeCache.at >= PROBE_TTL_MS) {
    probeCache = { url, at: now, ok: await portAlive(url) }
  }
  return probeCache.ok ? url : undefined
}