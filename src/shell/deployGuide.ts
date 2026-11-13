/**
 * The remote row's deployment path: the console holds no credentials for that host, so
 * "deploy" means handing the operator the exact artifacts and commands, not pretending
 * to run them. The steps mirror docs/features/wsl-daemon.md's manual section, and the
 * unit text comes from the same builder the automatic install uses.
 */
import { escapeHtml } from './htmlEscape.ts'
import { buildSystemdUnit } from './wslInstallPlan.ts'
import { selectAsset, type ReleaseInfo } from './updatePlan.ts'

const RELEASES_PAGE = 'https://github.com/polite0803/ModelPort/releases'
const INSTALL_DIR = '/opt/modelport'

export interface DeployGuideInput {
  name: string
  url: string
  release: ReleaseInfo | null
  error?: string
}

function assetLinks(release: ReleaseInfo, arch: 'x64' | 'arm64'): string {
  const name = `modelport-daemon-${release.version}-${arch}.tar.gz`
  const pair = selectAsset(release, name)
  if (!pair) {
    return `<li>${arch}：这个发布里没有 ${escapeHtml(name)} 或它的 .sha256，不能部署。</li>`
  }
  return `<li>${arch}：<a href="${escapeHtml(pair.url)}">${escapeHtml(pair.name)}</a>` +
    `（<a href="${escapeHtml(pair.checksumUrl)}">SHA-256</a>）</li>`
}

function commandsBlock(release: ReleaseInfo): string {
  const name = `modelport-daemon-${release.version}-x64.tar.gz`
  const pair = selectAsset(release, name)
  // Without a checksum pair there is nothing safe to hand over; the links section above
  // already says which artifact is missing.
  if (!pair) return ''
  const unit = buildSystemdUnit({ nodePath: '/usr/bin/node', installDir: INSTALL_DIR, service: 'modelport' })
  const script = [
    '# 在远程主机上执行（需要 systemd 与 Node 20+；arm64 机器把两处 x64 换成 arm64）',
    `curl -fLO ${pair.url}`,
    `curl -fLO ${pair.checksumUrl}`,
    `sha256sum -c ${name}.sha256`,
    `sudo mkdir -p ${INSTALL_DIR}`,
    `sudo tar -xzf ${name} -C ${INSTALL_DIR} --strip-components=1`,
    '',
    '# 写 system 作用域单元（node 不在 /usr/bin/node 时，把 ExecStart 改成 command -v node 的输出）',
    `sudo tee /etc/systemd/system/modelport.service >/dev/null <<'UNIT'`,
    unit.trimEnd(),
    'UNIT',
    'sudo systemctl daemon-reload',
    'sudo systemctl enable modelport',
    '',
    '# 写非回环监听、API Key 与管理口令，再重启生效；记下打印的 MODELPORT_HANDSHAKE 一行',
    `sudo node ${INSTALL_DIR}/modelport-daemon.cjs --init-host --port 8080`,
    'sudo systemctl restart modelport',
  ].join('\n')
  return `<h2>部署命令</h2><pre>${escapeHtml(script)}</pre>`
}

function dockerCommandsBlock(release: ReleaseInfo): string {
  const name = `modelport-daemon-${release.version}-docker-x64.tar.gz`
  const pair = selectAsset(release, name)
  if (!pair) return ''
  const tag = `modelport-daemon:${release.version}`
  const script = [
    '# 在远程主机上执行（需要 Docker；arm64 机器把两处 x64 换成 arm64）',
    `curl -fLO ${pair.url}`,
    `curl -fLO ${pair.checksumUrl}`,
    `sha256sum -c ${name}.sha256`,
    `docker load -i ${name}`,
    'docker volume create modelport-data',
    '',
    '# 一次性初始化：非回环监听 + API Key + 管理口令；记下打印的 MODELPORT_HANDSHAKE 一行',
    `docker run --rm -v modelport-data:/data ${tag} --init-host --port 8080`,
    '',
    '# 常驻；宿主发布端口与容器监听端口保持相同（恒等映射）。数据在卷里，升级重建容器不丢',
    '# 宿主 8080 被占：监听端口改同一个空闲端口（--init-host --port 18080 或 config:update',
    '#   proxyPort），再 -p 18080:18080；不要 18080:8080，界面监听端口会与可达端口不一致',
    'docker run -d --name modelport --restart unless-stopped \\',
    `  -p 8080:8080 -p 8443:8443 -v modelport-data:/data ${tag}`,
  ].join('\n')
  return `<pre>${escapeHtml(script)}</pre>`
}

function dockerSection(release: ReleaseInfo): string {
  const names = (['x64', 'arm64'] as const).map(arch => `modelport-daemon-${release.version}-docker-${arch}.tar.gz`)
  // Releases before the Docker form carry no such asset at all: say so instead of
  // printing two "undeployable" lines for an artifact that was never shipped.
  if (!names.some(name => release.assets.some(asset => asset.name === name))) {
    return '<h2>Docker 部署</h2><p class="hint">这个发布没有 Docker 镜像资产，请用上面的 systemd 路径。</p>'
  }
  const links = names.map(name => {
    const pair = selectAsset(release, name)
    if (!pair) return `<li>${escapeHtml(name)}：缺资产或 .sha256，不能部署。</li>`
    return `<li><a href="${escapeHtml(pair.url)}">${escapeHtml(pair.name)}</a>` +
      `（<a href="${escapeHtml(pair.checksumUrl)}">SHA-256</a>）</li>`
  }).join('')
  return `<h2>Docker 部署（替代 systemd）</h2><ul>${links}</ul>${dockerCommandsBlock(release)}`
}

export function deployGuideHtml(input: DeployGuideInput): string {
  const release = input.release
  const downloads = release
    ? `<h2>下载（版本 ${escapeHtml(release.version)}）</h2><ul>${assetLinks(release, 'x64')}${assetLinks(release, 'arm64')}</ul>` +
      commandsBlock(release) + dockerSection(release)
    : `<p style="color:#f87171">读取发布失败${input.error ? `：${escapeHtml(input.error)}` : ''}。` +
      `可直接到 <a href="${RELEASES_PAGE}">Release 页面</a>下载 modelport-daemon-&lt;版本&gt;-&lt;架构&gt;.tar.gz 与同名 .sha256。</p>`
  const html = `<!doctype html><meta charset="utf-8"><title>部署指南</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; font:13px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
         background:#1a1a1a; color:#eee; padding:24px 28px; }
  h1 { font-size:16px; margin:0 0 4px; } h2 { font-size:14px; margin:22px 0 6px; }
  a { color:#60a5fa; } ul { margin:6px 0; padding-left:20px; }
  pre { background:#111; border:1px solid #2a2a2a; border-radius:8px; padding:12px;
        overflow:auto; font-size:12px; color:#d4d4d8; white-space:pre; }
  .hint { color:#a1a1aa; }
</style>
<h1>部署网关到远程主机</h1>
<p class="hint">条目：${escapeHtml(input.name)} · 目标地址：${escapeHtml(input.url)}</p>
<p>控制台没有这台主机的凭据，下面的步骤由你在那台主机上执行。部署完成后回到控制台
「添加网关」，填它的地址；首次连接时粘贴 <code>MODELPORT_HANDSHAKE</code> 里的管理口令。</p>
${downloads}
<h2>注意</h2>
<ul class="hint">
  <li>常驻必须用 system 作用域单元并 <code>enable</code>：<code>--user</code> 单元会随登录会话结束。</li>
  <li>防火墙放行监听端口；控制台所在机器要能访问它。</li>
  <li>缺 <code>.sha256</code> 的包不要装：校验只防传输损坏，发布物没有代码签名。</li>
  <li>Docker 形态的数据在命名卷 <code>modelport-data</code> 里；升级 = <code>docker load</code> 新镜像后重建容器，卷不动。</li>
  <li>WSL 主机不用手动做这些：新增网关时选 WSL，控制台会自动安装。</li>
</ul>`
  return html
}