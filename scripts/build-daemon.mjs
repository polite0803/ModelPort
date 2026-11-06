/**
 * Builds the headless daemon bundle for non-Electron hosts (WSL, containers).
 *
 * Two things this script is responsible for, because both fail silently otherwise:
 *
 * 1. every runtime dependency must be inlined. The packaged app carries no
 *    `node_modules` (`build.files` excludes it) and the daemon tarball carries none
 *    either, so one externalised require is a startup crash on the target machine -
 *    the 1.4.5 `electron-store` failure, one release later and in a new host.
 * 2. nothing may reference `electron`. The daemon reaches its shell through
 *    `src/main/runtime/host.ts`; if a gateway module grows a direct electron import
 *    again, the bundle would still build (esbuild happily inlines the launcher stub)
 *    and then die at runtime with `app.getVersion is not a function`.
 */
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const outDir = join(root, 'out', 'daemon')
const bundlePath = join(outDir, 'modelport-daemon.cjs')

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

await build({
  entryPoints: [join(root, 'src', 'main', 'daemon', 'entry.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  define: { __MODELPORT_VERSION__: JSON.stringify(pkg.version) },
  legalComments: 'none',
  logLevel: 'warning',
})

const bundle = readFileSync(bundlePath, 'utf8')

const electronRefs = [
  ...bundle.matchAll(/require\(\s*["']electron["']\s*\)/g),
  ...bundle.matchAll(/__require\(\s*["']electron["']\s*\)/g),
]
if (electronRefs.length > 0) {
  writeFileSync(join(outDir, 'BUILD-FAILURE.txt'), `electron referenced ${electronRefs.length}x`)
  console.error(`::error::daemon bundle references electron ${electronRefs.length} time(s); ` +
    'route that call through src/main/runtime/host.ts')
  process.exit(1)
}

if (!bundle.includes(JSON.stringify(pkg.version))) {
  console.error(`::error::__MODELPORT_VERSION__ was not inlined (${pkg.version} missing from the bundle)`)
  process.exit(1)
}

const resourceSources = [
  { from: 'resources/channel-pack', to: 'resources/channel-pack', required: 'worker.mjs' },
  { from: 'resources/catalog', to: 'resources/catalog', required: null },
  // The UI the daemon serves to a browser and to the console window: the same
  // `electron-vite build` output. Missing means the operator built the daemon without
  // the app, so `/ui` would answer "not built" - fail loudly at build time instead.
  { from: 'out/renderer', to: 'renderer', required: 'index.html' },
]
for (const item of resourceSources) {
  const from = join(root, item.from)
  if (!existsSync(from)) {
    console.error(`::error::${item.from} is missing - run \`npm run build\` first (it produces out/renderer, ` +
      'and build:channel-pack produces resources/channel-pack)')
    process.exit(1)
  }
  if (item.required && !existsSync(join(from, item.required))) {
    console.error(`::error::${item.from}/${item.required} is missing - the channel pack was not built`)
    process.exit(1)
  }
  cpSync(from, join(outDir, item.to), { recursive: true })
}

// The sha3 wasm is shipped at the resources root by electron-builder's extraResources;
// the daemon layout mirrors that so the channel pack finds it the same way.
const wasmAtRoot = join(root, `sha3_wasm_bg.7b9ca65ddd.wasm`)
if (existsSync(wasmAtRoot)) cpSync(wasmAtRoot, join(outDir, 'resources', 'sha3_wasm_bg.7b9ca65ddd.wasm'))

// ---------------------------------------------------------------- tarball layout
//
// `modelport-daemon-<version>/` with the bundle, its resources, the served UI, a
// launcher and a systemd unit template. The unit is a *template*: the node binary path
// differs per machine (WSL distros have no node by default), so the install doc fills
// NODE with `sed`. Shipping a unit that hardcodes a path we cannot know is how an
// install guide turns into "service failed to start, reason unknown".
const arch = process.env.DAEMON_ARCH || process.arch
const stageRoot = join(root, 'dist', 'daemon-stage')
const stageName = `modelport-daemon-${pkg.version}`
const stageDir = join(stageRoot, stageName)

rmSync(stageRoot, { recursive: true, force: true })
mkdirSync(join(stageDir, 'systemd'), { recursive: true })

cpSync(join(outDir, 'modelport-daemon.cjs'), join(stageDir, 'modelport-daemon.cjs'))
cpSync(join(outDir, 'resources'), join(stageDir, 'resources'), { recursive: true })
if (existsSync(join(outDir, 'renderer'))) {
  cpSync(join(outDir, 'renderer'), join(stageDir, 'renderer'), { recursive: true })
}

mkdirSync(join(stageDir, 'bin'), { recursive: true })
writeFileSync(
  join(stageDir, 'bin', 'modelport'),
  [
    '#!/bin/sh',
    '# Launcher for the headless ModelPort gateway. All flags are passed through:',
    '#   --print-paths    what this host actually resolved',
    '#   --init-host      bind beyond loopback + API key + management API, in one step',
    '#   --import-backup  restore a desktop backup (password via stdin or the env var)',
    'DIR=$(cd "$(dirname "$0")/.." && pwd)',
    'exec node "$DIR/modelport-daemon.cjs" "$@"',
    '',
  ].join('\n'),
  { mode: 0o755 },
)

writeFileSync(
  join(stageDir, 'systemd', 'modelport.service'),
  [
    '[Unit]',
    'Description=ModelPort gateway (headless daemon)',
    'After=network-online.target',
    '',
    '[Service]',
    '# Replace NODE and PATH below with the real install paths (`which node`).',
    'ExecStart=NODE /opt/modelport/modelport-daemon-CHANGE_ME/modelport-daemon.cjs',
    'Environment=MODELPORT_RESOURCE_ROOT=/opt/modelport/modelport-daemon-CHANGE_ME/resources',
    'Environment=MODELPORT_WEB_ROOT=/opt/modelport/modelport-daemon-CHANGE_ME/renderer',
    'Restart=on-failure',
    'RestartSec=2',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
    '# System scope, not --user: a user unit dies with the login session that started it,',
    '# and `enable` is what brings the gateway back when the WSL distro boots.',
    '# Install: sudo cp modelport.service /etc/systemd/system/ && sudo systemctl enable --now modelport',
    '',
  ].join('\n'),
)

const tarballName = `${stageName}-${arch}.tar.gz`
try {
  // Relative paths only, with the cwd doing the resolving: GNU tar under MSYS reads an
  // absolute `D:\...` argument as `host:path` and dies with "Cannot connect to D:".
  // The staged directory itself is archived, so the tarball untars to
  // `modelport-daemon-<version>/` exactly as `docs/features/wsl-daemon.md` documents it -
  // a flat `.` archive makes every install command in that doc wrong.
  execFileSync('tar', ['-czf', tarballName, stageName], {
    cwd: stageRoot,
    stdio: 'inherit',
  })
  renameSync(join(stageRoot, tarballName), join(root, 'dist', tarballName))
} catch {
  console.error('::error::`tar` is unavailable; the daemon tarball was not packaged. ' +
    `The staged tree is at ${stageDir} and can be archived manually.`)
  process.exit(1)
}

console.log(
  `daemon: out/daemon/modelport-daemon.cjs (${(statSync(bundlePath).size / 1024).toFixed(0)} KB, v${pkg.version}) ` +
    `+ out/daemon/resources, packaged as dist/${tarballName}`,
)
