import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

/**
 * The release wiring for a single product.
 *
 * After the three-mode change the console *is* the app: one installer per platform, one
 * `appId`, and one update mechanism (GitHub Release API + `.sha256`, no `latest.yml`).
 * Each assertion blocks one concrete accident:
 * - a second packaging config left behind would keep shipping a binary nobody maintains;
 * - a `publish` section would make electron-builder write update metadata that no updater
 *   reads (and reintroduce the two-`latest.yml` collision the old split existed to avoid);
 * - an artifact whose name is not scanned by the upload step is a release that silently
 *   ships without it, and the console refuses an update without a `.sha256`.
 */
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const mainBuild = pkg.build
const release = readFileSync('.github/workflows/release.yml', 'utf8')

test('one product: one identity, one entry, no publish section', () => {
  assert.equal(mainBuild.appId, 'com.modelport.manager')
  assert.equal(mainBuild.productName, 'ModelPort')
  assert.equal(pkg.main, './out/main/index.js', 'the shipped entry is the role orchestrator')
  assert.equal(mainBuild.publish, undefined, 'no latest.yml: updates are release assets + sha256')
  assert.equal(pkg.scripts['build:shell'], undefined, 'the second product no longer has a build script')
  assert.ok(!existsSync('electron-builder.shell.yml'), 'the second product must not keep a packaging config')
})

test('release.yml packages one console per platform and publishes no updater metadata', () => {
  const commandLines = release
    .split('\n')
    .filter(line => !line.trim().startsWith('#'))
  assert.equal(
    commandLines.filter(line => line.includes('publish=always')).length,
    0,
    'publishing metadata is exactly what one product no longer needs',
  )
  for (const platform of ['macOS', 'Windows', 'Linux']) {
    assert.ok(release.includes(`name: Package the console (${platform})`), `missing the ${platform} package step`)
  }
  assert.equal(
    commandLines.filter(line => line.includes('electron-builder --')).length,
    3,
    'one packaging command per platform, and only the console',
  )
})

test('every shipped artifact is uploaded with a checksum', () => {
  const step = release.slice(release.indexOf('Upload installers with checksums'))
  assert.ok(step.includes('sha256sum'), 'the console refuses an artifact without one')
  assert.match(step, /gh release upload/)
  assert.match(step, /modelport-daemon-\*/, 'the daemon tarball is uploaded by its own step')
  for (const pattern of ['*.exe', '*.dmg', '*.AppImage', '*.deb', '*.tar.gz']) {
    assert.ok(step.includes(pattern), `the upload sweep must include ${pattern}`)
  }
  assert.equal(mainBuild.directories.output, 'dist', 'the sweep scans exactly the packaging output')
})

test('the daemon tarball carries the UI, the resources and a unit template', () => {
  const script = readFileSync('scripts/build-daemon.mjs', 'utf8')
  for (const part of ['renderer', 'systemd', 'bin', 'resources/channel-pack']) {
    assert.ok(script.includes(part), `build-daemon must stage ${part}`)
  }
  // Absolute paths handed to tar break under MSYS ("Cannot connect to D:"); the cwd does
  // the resolving instead. And the staged directory must be archived *as a directory*:
  // the install doc shows `modelport-daemon-<version>/`, so a flat `.` archive makes
  // every documented `mv` fail mid-deploy (that is how the first WSL deploy stalled).
  assert.match(
    script,
    /execFileSync\('tar', \['-czf', tarballName, stageName\], \{\n\s*cwd: stageRoot,/,
    'the tarball must untar to modelport-daemon-<version>/, the layout the install doc shows',
  )
})

test('the artifacts match the place the updater looks for them', () => {
  // electron-builder writes the installer name from this pattern, and `selectReleaseAssets`
  // rebuilds the same name from the console's own architecture. A rename on one side only is
  // an updater that "cannot find the release" on a release that is right there. The arch stays
  // a variable here on purpose: pinning `x64` would let an arm64 row ship while the updater
  // still looked only at x64.
  assert.equal(mainBuild.nsis.artifactName, '${productName}-${version}-${arch}-setup.${ext}')
  assert.equal(mainBuild.win.artifactName, '${productName}-${version}-${arch}-setup.${ext}')
  const plan = readFileSync('src/shell/updatePlan.ts', 'utf8')
  assert.ok(
    plan.includes('ModelPort-${release.version}-${consoleArch}-setup.exe'),
    'the updater must derive the installer name from the same template, arch as a variable',
  )
  const packagedWindowsArch = mainBuild.win.target.flatMap((target: { arch: string[] }) => target.arch)
  assert.deepEqual(
    [...new Set<string>(packagedWindowsArch)].sort(),
    ['arm64', 'x64'],
    'every architecture the updater can ask for must actually be packaged',
  )
})

test('the new feature doc and plan are registered in the index', () => {
  assert.ok(existsSync('docs/features/wsl-daemon.md'), 'the WSL/headless behaviour must be documented')
  const index = readFileSync('docs/README.md', 'utf8')
  assert.match(index, /\[`features\/wsl-daemon\.md`\]\(features\/wsl-daemon\.md\)/,
    'a doc the index does not list is an orphan, and the index claims there are none')
  assert.match(index, /PLAN-wsl-headless-daemon-and-shell\.md/)
  assert.match(index, /PLAN-shell-three-modes\.md/, 'the three-mode decision record must be indexed')
})
