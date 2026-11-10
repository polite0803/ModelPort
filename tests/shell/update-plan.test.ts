import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  archFromUname,
  buildWslInstallScript,
  buildWslRollbackScript,
  compareVersions,
  isNewer,
  normalizeVersion,
  parseBackupPath,
  parseRelease,
  parseSha256,
  parseSystemdUnit,
  selectReleaseAssets,
  shellQuote,
} from '../../src/shell/updatePlan.ts'

const ASSET_BASE = 'https://github.com/polite0803/ModelPort/releases/download/v1.7.5'
const SHELL = 'ModelPort-1.7.5-x64-setup.exe'
const SHELL_ARM = 'ModelPort-1.7.5-arm64-setup.exe'
const DAEMON = 'modelport-daemon-1.7.5-x64.tar.gz'

function releasePayload(extra: { omitChecksum?: string; extraAssets?: unknown[] } = {}): unknown {
  const assets = [
    { name: SHELL, browser_download_url: `${ASSET_BASE}/${SHELL}`, size: 123 },
    { name: `${SHELL}.sha256`, browser_download_url: `${ASSET_BASE}/${SHELL}.sha256` },
    { name: DAEMON, browser_download_url: `${ASSET_BASE}/${DAEMON}`, size: 456 },
    { name: `${DAEMON}.sha256`, browser_download_url: `${ASSET_BASE}/${DAEMON}.sha256` },
  ].filter(asset => asset.name !== extra.omitChecksum)
  return {
    tag_name: 'v1.7.5',
    html_url: 'https://github.com/polite0803/ModelPort/releases/tag/v1.7.5',
    assets: [...assets, ...(extra.extraAssets ?? [])],
  }
}

test('版本比较：数字段而非字典序，v 前缀归一', () => {
  assert.equal(normalizeVersion('v1.7.5'), '1.7.5')
  assert.equal(normalizeVersion('1.7.5'), '1.7.5')
  assert.equal(compareVersions('1.7.10', '1.7.9'), 1)
  assert.equal(compareVersions('1.7.5', '1.7.5'), 0)
  assert.equal(compareVersions('1.7.4', '1.7.5'), -1)
  assert.equal(compareVersions('1.7.5-beta.1', '1.7.5'), -1)
  assert.equal(isNewer('1.7.5', '1.7.4'), true)
  assert.equal(isNewer('1.7.4', '1.7.4'), false)
})

test('release 解析：归一 tag、只保留 https 资源', () => {
  const info = parseRelease(releasePayload({
    extraAssets: [
      { name: 'plain-http.exe', browser_download_url: 'http://example.com/plain-http.exe' },
      { name: 'localhost-fixture.exe', browser_download_url: 'http://127.0.0.1:18999/localhost-fixture.exe' },
      { name: 'not-a-url', browser_download_url: 'not a url' },
    ],
  }))
  assert.equal(info.version, '1.7.5')
  assert.equal(info.tag, 'v1.7.5')
  assert.equal(info.pageUrl.includes('/releases/tag/v1.7.5'), true)
  assert.equal(info.assets.some(asset => asset.name === 'plain-http.exe'), false)
  assert.equal(info.assets.some(asset => asset.name === 'localhost-fixture.exe'), true)
  assert.equal(info.assets.some(asset => asset.name === 'not-a-url'), false)
})

test('资源选择：shell 与 daemon 都要求同名 .sha256', () => {
  const selection = selectReleaseAssets(parseRelease(releasePayload()), 'x64', 'x64')
  assert.equal(selection.shell?.name, SHELL)
  assert.equal(selection.shell?.checksumName, `${SHELL}.sha256`)
  assert.equal(selection.daemon?.name, DAEMON)
  assert.equal(selection.daemon?.checksumName, `${DAEMON}.sha256`)
  assert.deepEqual(selection.missing, [])
})

test('资源选择：缺校验文件时不给出可安装项，并点名缺的是哪个', () => {
  const selection = selectReleaseAssets(
    parseRelease(releasePayload({ omitChecksum: `${DAEMON}.sha256` })),
    'x64',
    'x64',
  )
  assert.equal(selection.shell?.name, SHELL)
  assert.equal(selection.daemon, null)
  assert.deepEqual(selection.missing, [`${DAEMON}.sha256`])
})

test('资源选择：控制台按自身包架构取安装包，缺 arm64 包时不拿 x64 凑数', () => {
  const withArm = releasePayload({
    extraAssets: [
      { name: SHELL_ARM, browser_download_url: `${ASSET_BASE}/${SHELL_ARM}`, size: 123 },
      { name: `${SHELL_ARM}.sha256`, browser_download_url: `${ASSET_BASE}/${SHELL_ARM}.sha256` },
    ],
  })
  assert.equal(selectReleaseAssets(parseRelease(withArm), 'x64', 'arm64').shell?.name, SHELL_ARM)
  // A release published before the arm64 row exists has no arm64 installer. An arm64 console
  // must report that gap instead of quietly installing the x64 build over itself.
  const armConsole = selectReleaseAssets(parseRelease(releasePayload()), 'x64', 'arm64')
  assert.equal(armConsole.shell, null)
  assert.deepEqual(armConsole.missing, [SHELL_ARM])
})

test('sha256 解析：支持 basename/路径/裸哈希，文件名不符即拒绝', () => {
  const hash = 'a'.repeat(64)
  assert.equal(parseSha256(`${hash}  ${DAEMON}`, DAEMON), hash)
  assert.equal(parseSha256(`${hash}  dist/${DAEMON}`, DAEMON), hash)
  assert.equal(parseSha256(`${hash} *${DAEMON}`, DAEMON), hash)
  assert.equal(parseSha256(hash, DAEMON), hash)
  assert.equal(parseSha256(`${hash}  other.tar.gz`, DAEMON), null)
  assert.equal(parseSha256('not-a-hash', DAEMON), null)
  assert.equal(parseSha256('', DAEMON), null)
})

test('WSL 架构映射', () => {
  assert.equal(archFromUname('x86_64'), 'x64')
  assert.equal(archFromUname('amd64'), 'x64')
  assert.equal(archFromUname('aarch64'), 'arm64')
  assert.equal(archFromUname('arm64'), 'arm64')
  assert.equal(archFromUname('riscv64'), null)
})

test('systemd 单元解析：ExecStart 与资源根都读得到', () => {
  const parsed = parseSystemdUnit([
    '[Service]',
    'ExecStart=/root/opt/node-v22.14.0-linux-x64/bin/node /root/mpd/modelport-daemon.cjs',
    'Environment=MODELPORT_RESOURCE_ROOT=/root/mpd/resources',
  ].join('\n'))
  assert.equal(parsed?.installDir, '/root/mpd')
  assert.equal(parsed?.resourceDir, '/root/mpd/resources')
  assert.equal(parsed?.nodePath, '/root/opt/node-v22.14.0-linux-x64/bin/node')
})

test('systemd 单元解析：引号与单文件 ExecStart 都处理', () => {
  const quoted = parseSystemdUnit('ExecStart="/opt/node bin/node" "/opt/model port/modelport-daemon.cjs"')
  assert.equal(quoted?.installDir, '/opt/model port')
  const single = parseSystemdUnit('ExecStart=/opt/modelport/modelport-daemon.cjs')
  assert.equal(single?.installDir, '/opt/modelport')
  assert.equal(single?.nodePath, null)
})

test('安装脚本：备份在停服之前，路径单引号安全，失败可回滚', () => {
  const script = buildWslInstallScript({
    tarballPath: "/mnt/c/Users/a b/it's.tar.gz",
    installDir: "/root/mpd",
    service: 'modelport',
  })
  assert.match(script, /^set -eu/m)
  assert.match(script, /tar -xzf "\$SRC" -C "\$STAGE"/)
  assert.match(script, /cp -a "\$INSTALL" "\$BACKUP"/)
  assert.match(script, /INSTALL=\$\(readlink -f "\$INSTALL"\)/, 'a versioned current-symlink must resolve')
  assert.ok(
    script.indexOf('echo "BACKUP=$BACKUP"') < script.indexOf('systemctl stop'),
    'backup path must be printed before the service is stopped',
  )
  assert.match(script, /systemctl start "\$SERVICE"/)
  assert.match(script, /it'\\''s\.tar\.gz/, 'single quotes inside a path must be escaped')
})

test('安装/回滚脚本拒绝相对路径与非法服务名', () => {
  assert.throws(() => buildWslInstallScript({ tarballPath: 'relative.tar.gz', installDir: '/root/mpd', service: 'modelport' }))
  assert.throws(() => buildWslInstallScript({ tarballPath: '/tmp/a.tar.gz', installDir: 'root/mpd', service: 'modelport' }))
  assert.throws(() => buildWslInstallScript({ tarballPath: '/tmp/a.tar.gz', installDir: '/root/mpd', service: 'model; rm -rf /' }))
  assert.throws(() => buildWslRollbackScript({ installDir: '/root/mpd', backupDir: 'backup', service: 'modelport' }))
})

test('回滚脚本会先停服、清空安装目录再从备份恢复', () => {
  const script = buildWslRollbackScript({
    installDir: '/root/mpd',
    backupDir: '/root/mpd.bak-20261106',
    service: 'modelport',
  })
  assert.match(script, /systemctl stop "\$SERVICE"/)
  assert.match(script, /cp -a "\$BACKUP"\/\. "\$INSTALL"\//)
  assert.match(script, /ROLLED_BACK/)
})

test('BACKUP= 行可被调用方解析', () => {
  assert.equal(parseBackupPath('installing\nBACKUP=/root/mpd.bak-1\nok'), '/root/mpd.bak-1')
  assert.equal(parseBackupPath('no backup here'), null)
})

test('shell 引号函数处理单引号', () => {
  assert.equal(shellQuote("a'b"), "'a'\\''b'")
})
