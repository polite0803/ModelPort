#!/usr/bin/env node
/**
 * 宿主机代理探测脚本：让 WSL/Linux 里的网关**跟着宿主机的代理走**，
 * 宿主机的代理没开就自动退回直连。
 *
 * ## 为什么需要它（截图里那句「渠道网络请求失败（直连；ETIMEDOUT）」的根因）
 *
 * 浏览器能登录 Gemini，是因为浏览器读的是 Windows 注册表里的代理；而跑在 WSL 里的
 * 网关是另一个网络栈：systemd 单元没有 `HTTPS_PROXY`，NAT 模式下也不共享 Windows 的
 * loopback —— 于是它只能直连，`cloudcode-pa.googleapis.com` 必然超时。
 * 出口路由本身（`vendor/channel-pack/src/channel-fetch.ts`）早就支持代理，缺的只是
 * 「代理地址从哪来、代理关了怎么办」。
 *
 * ## 机制（脚本探测、网关消费）
 *
 * 1. 脚本发现候选地址：Windows 注册表的代理端口（经 WSL interop 现读，不写死）
 *    + 宿主机全部 IPv4 + WSL 默认网关 + 常见代理客户端端口。
 * 2. 逐个真探测：TCP 建连 → 再**穿过代理**对目标做 CONNECT（默认
 *    `cloudcode-pa.googleapis.com:443`）。只有真的能隧道出去才算可用。
 * 3. 结果写进 `<数据目录>/host-proxy.json`。探测失败时**保留**上一次的可用地址
 *    （只有 `--off` 才写 null）—— 网关自己会做存活探测，代理客户端重新打开就自动接上。
 * 4. 网关每次出网读这个文件（5 秒缓存）并对代理端口做存活探测（15 秒缓存）：
 *    **代理开着就用、关掉就直连，两个方向都不需要重启服务、也不需要再跑脚本**。
 *
 * ⚠️ 交互式 shell 里 `export HTTPS_PROXY`（`~/.config/modelport/proxy.sh` 那一套）到不了网关：
 * systemd 单元不 source `.bashrc`，读的是 root 的环境。宿主机代理只有经本文件（或单元 drop-in）
 * 才对服务生效 —— 这正是界面上「浏览器能登录、渠道显示直连 ETIMEDOUT」的原因。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/wsl-host-proxy.mjs                 # 探测一次并写文件
 * node scripts/wsl-host-proxy.mjs --status        # 只看当前配置与该代理现在是否通
 * node scripts/wsl-host-proxy.mjs --watch 30      # 常驻，每 30 秒复检（换端口/IP 时自愈）
 * node scripts/wsl-host-proxy.mjs --off           # 停用（写 null，网关立刻退回直连）
 * node scripts/wsl-host-proxy.mjs --url http://192.168.0.239:7890   # 指定地址（跳过发现）
 * node scripts/wsl-host-proxy.mjs --file /root/.modelport/host-proxy.json
 * ```
 *
 * ⚠️ 网关以 systemd **root** 运行时读的是 `/root/.modelport/host-proxy.json`，脚本默认
 * 就按单元的运行用户去解析这个路径；用普通用户跑而目标不可写时会直接报错并给出
 * root 执行方式，不会「写成功」却写到一个没人读的位置。
 *
 * ## 探测不到时的唯一前提（Windows 侧）
 *
 * Clash/Mihomo 默认只听 `127.0.0.1:7890`，NAT 下的 WSL 到不了。打开「允许局域网连接」
 * （`allow-lan: true`）后 WSL 才能访问 `<宿主机 IP>:<端口>`；若仍不通，就是 Windows 防火墙
 * 拦了 vEthernet(WSL) 的入站。脚本会把这两条连同现读到的注册表值一起打出来。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const UNIT = process.env.MODELPORT_UNIT ?? 'modelport'
const POWERSHELL = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
/** 常见代理客户端的本地端口：Clash 7890 / Clash Verge 7897 / v2rayN 10808(SOCKS)、10809(HTTP)。 */
const DEFAULT_PORTS = [7890, 7891, 7897, 10809, 10808, 1080, 2080]
const DEFAULT_TEST = 'cloudcode-pa.googleapis.com:443'
const TCP_TIMEOUT_MS = 1_200
const CONNECT_TIMEOUT_MS = 3_000

const HELP = `用法：node scripts/wsl-host-proxy.mjs [选项]

  --status              只看当前配置文件与该代理现在是否可达
  --off                 写入空值（网关退回直连）
  --watch [秒]          常驻复检（默认 30 秒），变化时才写盘
  --file <路径>         指定配置文件（默认按 systemd 单元的运行用户解析数据目录）
  --url <地址>          跳过发现，直接用这个代理（http:// 或 socks5://，需带端口）
  --force               与 --url 同用：探测失败也照样写入
  --host <IP>           追加候选地址（可重复或逗号分隔）
  --ports <csv>         替换默认候选端口
  --test-host <host:port> 隧道验证的目标（默认 ${DEFAULT_TEST}）
  --no-windows          不通过 WSL interop 读宿主机代理与网卡（非 WSL 环境自动跳过）
  --json                机器可读输出
  --dry-run             只打印将要写入的内容
`

function parseArgs(argv) {
  const options = {
    mode: 'detect', file: undefined, url: undefined, force: false, hosts: [],
    ports: undefined, testHost: DEFAULT_TEST, watchSeconds: 30, json: false,
    dryRun: false, windows: true,
  }
  const csv = (value) => value.split(',').map(item => item.trim()).filter(Boolean)
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => argv[++i]
    switch (arg) {
      case '--status': options.mode = 'status'; break
      case '--off': options.mode = 'off'; break
      case '--watch': {
        options.mode = 'watch'
        const value = argv[i + 1]
        if (value !== undefined && /^\d+$/.test(value)) { options.watchSeconds = Math.max(5, Number(value)); i++ }
        break
      }
      case '--file': options.file = next(); break
      case '--url': options.url = next(); break
      case '--force': options.force = true; break
      case '--host': options.hosts.push(...csv(next())); break
      case '--ports': options.ports = csv(next()).map(Number).filter(port => Number.isInteger(port) && port > 0); break
      case '--test-host': options.testHost = next(); break
      case '--no-windows': options.windows = false; break
      case '--json': options.json = true; break
      case '--dry-run': options.dryRun = true; break
      case '--help': case '-h': process.stdout.write(HELP); process.exit(0);
      default:
        process.stderr.write(`未知参数：${arg}\n\n${HELP}`)
        process.exit(2)
    }
  }
  if (options.ports === undefined || options.ports.length === 0) options.ports = DEFAULT_PORTS
  return options
}

/* ------------------------------------------------------------------ 目标文件 */

/** 读 systemd 单元的运行用户：网关以 root 跑时数据目录是 `/root/.modelport`。 */
function serviceUser(unit) {
  try {
    const out = execFileSync('systemctl', ['show', unit, '-p', 'User', '-p', 'LoadState', '--value'], {
      encoding: 'utf8', timeout: 3_000, stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\n').map(line => line.trim())
    if (out[1] !== 'loaded') return undefined
    return out[0].length > 0 ? out[0] : 'root'
  } catch {
    return undefined
  }
}

function homeOf(user) {
  try {
    const line = execFileSync('getent', ['passwd', user], { encoding: 'utf8', timeout: 3_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const home = line.split(':')[5]
    if (home) return home
  } catch {
    // 非 unix 账户（如目录服务里的名字）退回约定路径
  }
  return user === 'root' ? '/root' : path.join('/home', user)
}

function resolveConfigFile(options) {
  if (options.file) return { file: path.resolve(options.file), reason: '--file' }
  const envFile = (process.env.MODELPORT_HOST_PROXY_FILE ?? '').trim()
  if (envFile.length > 0 && envFile !== 'off' && envFile !== '0' && envFile !== 'false') {
    return { file: envFile, reason: 'MODELPORT_HOST_PROXY_FILE' }
  }
  const user = serviceUser(UNIT)
  if (user !== undefined) {
    return { file: path.join(homeOf(user), '.modelport', 'host-proxy.json'), reason: `${UNIT} 单元的运行用户 ${user}` }
  }
  return { file: path.join(os.homedir(), '.modelport', 'host-proxy.json'), reason: '当前用户 home' }
}

async function readConfig(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return undefined
  }
}

async function writeConfig(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.tmp-${process.pid}`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temp, file)
  try {
    await access(file, 0o0400 | 0o0200)
  } catch {
    // 权限位不影响可读性判断，写成功即可
  }
}

/* ------------------------------------------------------------------ 宿主机发现 */

/**
 * 经 WSL interop 现读 Windows 的代理设置与网卡地址。
 *
 * 端口不写死是刻意的：Clash / Clash Verge / v2rayN 各版本默认端口不同，而注册表里
 * 那份就是浏览器正在用的那份 —— 读它等于读「宿主机的代理到底是哪个口」。
 */
function windowsFacts() {
  try {
    const script = [
      '$p = Get-ItemProperty "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"',
      '"PROXY=" + $p.ProxyEnable + "|" + $p.ProxyServer',
      'Get-NetIPAddress -AddressFamily IPv4 | ForEach-Object { "IP=" + $_.IPAddress + "|" + $_.InterfaceAlias }',
    ].join('; ')
    const out = execFileSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
    })
    const facts = { proxyEnable: false, proxyServer: '', proxyPorts: [], ips: [] }
    for (const raw of out.split(/\r?\n/)) {
      const line = raw.trim()
      if (line.startsWith('PROXY=')) {
        // `slice(6)` 已经去掉「PROXY=」，所以首元素就是 ProxyEnable —— 不要再跳一格
        const [enable, server] = line.slice('PROXY='.length).split('|')
        facts.proxyEnable = enable === '1'
        facts.proxyServer = (server ?? '').trim()
        for (const entry of facts.proxyServer.split(';')) {
          const port = /:(\d{2,5})\s*$/.exec(entry)?.[1]
          if (port !== undefined) facts.proxyPorts.push(Number(port))
        }
      } else if (line.startsWith('IP=')) {
        const [ip, alias] = line.slice(3).split('|')
        if (ip) facts.ips.push({ ip, alias: alias ?? '' })
      }
    }
    return facts
  } catch {
    // 非 WSL、interop 被策略关掉、或 powershell 不在标准路径：候选集退回本机推断
    return undefined
  }
}

function wslGatewayIp() {
  try {
    for (const line of readFileSyncSafe('/proc/net/route').split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/)
      if (cols.length < 3 || cols[1] !== '00000000') continue
      const value = Number.parseInt(cols[2], 16) >>> 0
      const ip = [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff].join('.')
      if (ip !== '0.0.0.0') return ip
    }
  } catch {
    // 读不到路由表就用空值，候选集仍包含显式 --host
  }
  return undefined
}

function readFileSyncSafe(file) {
  // 同步读：本脚本只在启动时调用一次，不值得为它把候选集改成异步构造
  return readFileSync(file, 'utf8')
}

/** 候选代理端点：注册表端口优先，其次常见客户端端口；地址含宿主机所有网卡 + 回环。 */
function candidateEndpoints(options, facts) {
  const hosts = [...options.hosts]
  if (facts !== undefined) {
    for (const entry of facts.ips) {
      if (entry.ip.startsWith('169.254.')) continue // APIPA：链路本地，跨不到
      hosts.push(entry.ip)
    }
  }
  const gateway = wslGatewayIp()
  if (gateway !== undefined) hosts.push(gateway)
  hosts.push('127.0.0.1') // mirrored 网络模式下宿主机与 WSL 共享 loopback

  const ports = [...new Set([...(facts?.proxyPorts ?? []), ...options.ports])]
  const seen = new Set()
  const endpoints = []
  for (const port of ports) {
    for (const host of hosts) {
      const url = `http://${host}:${port}`
      if (seen.has(url)) continue
      seen.add(url)
      endpoints.push({ url, host, port })
    }
  }
  return endpoints
}

/* ------------------------------------------------------------------ 探测 */

function withSocket(socket, finish, timeoutMs) {
  socket.setTimeout(timeoutMs)
  socket.once('timeout', () => finish(false, '探测超时'))
  socket.once('error', (error) => finish(false, error.code ?? error.message))
}

/** TCP 建连：先过滤掉没人 listening 的端点，免得对每个都做一次 CONNECT。 */
function tcpReachable(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    const finish = (ok, detail) => {
      socket.destroy()
      resolve({ ok, detail })
    }
    withSocket(socket, finish, TCP_TIMEOUT_MS)
    socket.once('connect', () => finish(true, ''))
  })
}

/** HTTP CONNECT 隧道：这是对「代理能不能出去」的真判据，不是端口开着就算。 */
function httpConnectReachable(host, port, target) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    let buffered = ''
    let settled = false
    const finish = (ok, detail) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve({ ok, detail })
    }
    withSocket(socket, finish, CONNECT_TIMEOUT_MS)
    socket.once('connect', () => {
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`)
    })
    socket.on('data', (chunk) => {
      buffered += chunk.toString('latin1')
      const head = /\r?\n/.exec(buffered)
      if (head === null) return
      const status = Number(/^HTTP\/1\.[01][ \t]+(\d{3})/.exec(buffered.slice(0, head.index))?.[1] ?? 0)
      if (status === 0) finish(false, `应答无法解析：${buffered.slice(0, 40).trim()}`)
      else finish(status === 200, `HTTP ${status}`)
    })
    socket.once('close', () => { if (!settled) finish(false, '代理在应答前关闭连接') })
  })
}

/** SOCKS5 CONNECT：只用于「这个口是 SOCKS 而非 HTTP」的候选（v2rayN 的 10808 等）。 */
function socks5Reachable(host, port, targetHost, targetPort) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    let buffered = Buffer.alloc(0)
    let stage = 0
    let settled = false
    const finish = (ok, detail) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve({ ok, detail })
    }
    withSocket(socket, finish, CONNECT_TIMEOUT_MS)
    const target = Buffer.from(targetHost, 'utf8')
    socket.once('connect', () => socket.write(Buffer.from([0x05, 0x01, 0x00])))
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk])
      if (stage === 0 && buffered.length >= 2) {
        if (buffered[1] !== 0x00) { finish(false, `SOCKS5 要求认证方式 0x${buffered[1].toString(16)}`); return }
        stage = 1
        buffered = Buffer.alloc(0)
        socket.write(Buffer.from([0x05, 0x01, 0x00, 0x03, target.length, ...target, (targetPort >>> 8) & 0xff, targetPort & 0xff]))
        return
      }
      if (stage === 1 && buffered.length >= 4) {
        if (buffered[1] === 0x00) finish(true, 'SOCKS5 CONNECT 成功')
        else finish(false, `SOCKS5 应答码 0x${buffered[1].toString(16)}`)
      }
    })
    socket.once('close', () => { if (!settled) finish(false, '代理在握手前关闭连接') })
  })
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

/**
 * 找出第一个真能出去代理。
 *
 * 顺序有讲究：先并发做 TCP 过滤（毫秒级），只对建连成功的端点做 CONNECT ——
 * 否则候选里有 40 个地址时，串行隧道验证最坏要几十秒，`--watch` 会跟不上代理客户端的启停。
 */
async function detectProxy(options, log) {
  const facts = options.windows && options.url === undefined ? windowsFacts() : undefined
  const endpoints = options.url === undefined
    ? candidateEndpoints(options, facts)
    : [{ url: options.url, ...splitProxyUrl(options.url) }]
  if (endpoints.length === 0) return { url: null, checked: [], facts }

  const [targetHost, targetPortRaw] = options.testHost.split(':')
  const targetPort = Number(targetPortRaw ?? 443)

  const checked = await mapLimit(endpoints, 8, async (endpoint) => {
    const tcp = await tcpReachable(endpoint.host, endpoint.port)
    if (!tcp.ok) return { url: endpoint.url, ok: false, detail: `TCP ${tcp.detail}` }
    const tunnel = await httpConnectReachable(endpoint.host, endpoint.port, options.testHost)
    if (tunnel.ok) return { url: endpoint.url, ok: true, detail: tunnel.detail }
    const socks = await socks5Reachable(endpoint.host, endpoint.port, targetHost, targetPort)
    if (socks.ok) return { url: endpoint.url.replace(/^http/, 'socks5'), ok: true, detail: socks.detail }
    return { url: endpoint.url, ok: false, detail: `CONNECT ${tunnel.detail}；SOCKS5 ${socks.detail}` }
  })

  const winner = checked.find(entry => entry.ok)
  if (winner !== undefined) {
    log(`可用代理：${winner.url}（${winner.detail}，隧道目标 ${options.testHost}）`)
  } else {
    log(`没有可达的宿主机代理（试过 ${checked.length} 个端点，隧道目标 ${options.testHost}）`)
  }
  return { url: winner?.url ?? null, checked, facts }
}

function splitProxyUrl(url) {
  const parsed = new URL(/^[a-z]+:\/\//i.test(url) ? url : `http://${url}`)
  return { host: parsed.hostname, port: Number(parsed.port || (parsed.protocol.startsWith('socks') ? 1080 : 7890)) }
}

/* ------------------------------------------------------------------ 输出 */

function hintFor(facts, checked) {
  const lines = ['Windows 侧至少要满足一项，WSL 才可能连上宿主机代理：']
  lines.push('  1) Clash/Mihomo 打开「允许局域网连接」(allow-lan: true)，让它监听 0.0.0.0:<端口>')
  lines.push('  2) 或在宿主机做端口转发：netsh interface portproxy add v4tov4 listenaddress=<WSL 网关 IP> listenport=<端口> connectaddress=127.0.0.1 connectport=<端口>（需管理员）')
  lines.push('  3) 仍不通就是 Windows 防火墙拦了 vEthernet(WSL) 的入站，放行该端口')
  lines.push('  4) 或把 WSL 切成 mirrored 网络（%UserProfile%\\.wslconfig 里 networkingMode=mirrored，然后 wsl --shutdown）')
  if (facts !== undefined) {
    lines.push(`现读到的宿主机代理：${facts.proxyEnable ? '已启用' : '未启用'} ${facts.proxyServer || '(注册表为空)'}`)
    lines.push(`宿主机 IPv4：${facts.ips.map(entry => `${entry.ip}(${entry.alias})`).join('、') || '(读不到)'}`)
    if (facts.proxyEnable && /(^|;)127\.0\.0\.1:/.test(facts.proxyServer)) {
      lines.push('⚠ 注册表里的代理只绑 127.0.0.1 —— NAT 模式的 WSL 到不了，必须先开「允许局域网连接」。')
    }
  }
  const closed = checked.filter(entry => entry.detail.startsWith('TCP')).length
  if (closed > 0) lines.push(`（其中 ${closed} 个端点 TCP 都没建连，说明该地址上没有监听）`)
  return lines.join('\n')
}

function summary(record, file, reason) {
  return [
    `配置文件：${file}（${reason}）`,
    `生效代理：${record.url ?? '(无 → 网关直连)'}`,
    `检查时间：${record.checkedAt}`,
    record.test ? `隧道目标：${record.test}` : undefined,
    record.url === null && Array.isArray(record.checked)
      ? record.checked.map(entry => `  ✗ ${entry.url} —— ${entry.detail}`).join('\n')
      : undefined,
  ].filter(Boolean).join('\n')
}

/* ------------------------------------------------------------------ 主流程 */

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const { file, reason } = resolveConfigFile(options)
  const log = (message) => { if (!options.json) process.stdout.write(`${message}\n`) }

  if (options.mode === 'status') {
    const current = await readConfig(file)
    const probe = current?.url !== undefined && current.url !== null
      ? await (async () => {
        const { host, port } = splitProxyUrl(current.url)
        const tcp = await tcpReachable(host, port)
        return tcp.ok ? '端口可达' : `端口不可达（${tcp.detail}）→ 网关此刻走直连`
      })()
      : '(没有可用代理)'
    const payload = { file, reason, config: current ?? null, live: probe }
    if (options.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
    else {
      process.stdout.write(`${summary({
        url: current?.url ?? null,
        checkedAt: current?.checkedAt ?? '(文件不存在)',
        test: current?.test,
        checked: current?.checked,
      }, file, reason)}\n当前状态：${probe}\n`)
    }
    return 0
  }

  const build = async () => {
    if (options.mode === 'off') {
      return { url: null, checkedAt: new Date().toISOString(), test: options.testHost, source: 'wsl-host-proxy', note: '手动停用' }
    }
    const found = await detectProxy(options, log)
    const previous = await readConfig(file)
    const record = {
      // 探测失败时**保留**上次可用地址：网关出网层自己会做端口存活探测，
      // 代理客户端重新打开后无需再跑脚本就会自动接上（写 null 才会把它锁死成直连）。
      url: found.url ?? previous?.url ?? null,
      checkedAt: new Date().toISOString(),
      test: options.testHost,
      source: 'wsl-host-proxy',
    }
    if (found.url === null) {
      record.checked = found.checked.map(({ url, ok, detail }) => ({ url, ok, detail }))
      if (record.url !== null) record.state = 'unreachable-armed'
      if (found.url === null && options.url === undefined) record.hint = hintFor(found.facts, found.checked)
    }
    if (options.url !== undefined && found.url === null && options.force) {
      record.url = options.url
      record.note = '按 --force 写入，探测未通过'
    }
    return record
  }

  const record = await build()
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`)
    return record.url === null ? 1 : 0
  }

  try {
    await writeConfig(file, record)
  } catch (error) {
    const uid = process.getuid?.()
    process.stderr.write([
      `写入失败：${error instanceof Error ? error.message : String(error)}`,
      `目标 ${file}（${reason}）；当前 uid=${uid ?? '未知'}。`,
      '网关以 root 跑 systemd 时，请用 root 身份执行本脚本，例如：',
      `  wsl.exe -u root bash -lc "cd <仓库> && node scripts/wsl-host-proxy.mjs"`,
      '或先 `sudo -i` 再执行。',
    ].join('\n') + '\n')
    return 2
  }

  if (options.json) process.stdout.write(`${JSON.stringify({ file, reason, ...record }, null, 2)}\n`)
  else {
    process.stdout.write(`${summary(record, file, reason)}\n`)
    if (record.hint !== undefined) process.stdout.write(`${record.hint}\n`)
    process.stdout.write('网关侧无需重启：出网层 5 秒内重读该文件，代理端口不通就自动退回直连。\n')
  }

  if (options.mode !== 'watch') return record.url === null ? 1 : 0

  // 常驻模式：只在「有没有可用代理」变化时写盘，避免每 30 秒无意义重写。
  let last = record.url ?? null
  process.stdout.write(`进入常驻复检（每 ${options.watchSeconds} 秒），Ctrl-C 结束。\n`)
  for (;;) {
    await new Promise(resolve => setTimeout(resolve, options.watchSeconds * 1000))
    const found = await detectProxy(options, () => {})
    // 与一次性模式同一条语义：探测失败不撤销已经写好的地址，网关的存活探测会自己接管
    const url = found.url ?? last
    if (url === last) continue
    last = url
    await writeConfig(file, {
      url,
      checkedAt: new Date().toISOString(),
      test: options.testHost,
      source: 'wsl-host-proxy',
      ...(url === null ? { state: 'unreachable', checked: found.checked.map(({ url: candidate, ok, detail }) => ({ url: candidate, ok, detail })) } : {}),
    })
    process.stdout.write(`${new Date().toISOString()} 宿主机代理${url === null ? '已停用 → 网关直连' : `已就绪 → ${url}`}\n`)
  }
}

main()
  .then((code) => { if (code !== 0) process.exitCode = code })
  .catch((error) => {
    process.stderr.write(`脚本失败：${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 2
  })