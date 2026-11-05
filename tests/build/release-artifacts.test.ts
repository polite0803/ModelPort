import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

/**
 * The release wiring for the two new artifacts.
 *
 * Each assertion blocks one concrete accident:
 * - a second `latest.yml` in the same Release (electron-builder names the Windows update
 *   metadata the same for every nsis target) would point the main app's auto-updater at
 *   the shell binary, so the shell must never be published with `--publish`;
 * - a shared `appId`/`productName` would collide on registry keys, the uninstaller, the
 *   taskbar group and the updater channel;
 * - a feature doc that is not in the index is exactly the "no orphan files" claim the
 *   index itself makes, so registration is checked here rather than remembered.
 */
const mainBuild = JSON.parse(readFileSync('package.json', 'utf8')).build
const shellConfig = readFileSync('electron-builder.shell.yml', 'utf8')
const release = readFileSync('.github/workflows/release.yml', 'utf8')

test('the shell has its own identity and no updater metadata', () => {
  assert.match(shellConfig, /appId: com\.modelport\.shell/)
  assert.notEqual(mainBuild.appId, 'com.modelport.shell', 'the two products must not share an appId')
  assert.match(shellConfig, /productName: ModelPort Shell/)
  assert.match(shellConfig, /publish: null/, 'publishing the shell would write a second latest.yml')
  assert.match(shellConfig, /artifactName: ModelPort-Shell-/)
  assert.match(shellConfig, /main: out\/main\/shell\.js/, 'extraMetadata must retarget the entry')
})

test('release.yml publishes the desktop app but only uploads the shell and the daemon', () => {
  // Counted on run lines only: the file's own header comment quotes the old
  // `--publish=always` behaviour, and prose is not a wiring site.
  const publishSteps = release
    .split('\n')
    .filter(line => !line.trim().startsWith('#'))
    .filter(line => line.includes('--publish=always'))
  assert.equal(publishSteps.length, 3, 'only the mac/win/linux desktop steps may publish')

  const shellStep = release.slice(
    release.indexOf('Build and upload the Windows shell'),
    release.indexOf('Build and Publish (Linux)'),
  )
  assert.ok(shellStep.includes('electron-builder.shell.yml'), 'the shell step must use its own config')
  assert.ok(!shellStep.includes('--publish=always'), 'the shell step must not publish updater metadata')
  assert.match(shellStep, /gh release upload/)

  const daemonStep = release.slice(release.indexOf('Package and upload the headless daemon'))
  assert.match(daemonStep, /npm run build:daemon/)
  assert.match(daemonStep, /gh release upload/)
  assert.match(daemonStep, /modelport-daemon-\*-\$\{\{ matrix\.arch \}\}\.tar\.gz/)
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

/** The filename pattern electron-builder will emit, expressed as the `gh release upload` glob. */
function expectedShellGlob(configText: string): string {
  return `dist-shell/${configText
    .match(/artifactName: (\S+)/)![1]
    .replace(/\$\{version\}/, '*')
    .replace(/\$\{arch\}/, '*')
    .replace(/\$\{ext\}/, 'exe')}`
}

test('the shell artifact name and the CI upload glob are the same string', () => {
  // A rename in one place only is a release that silently ships without the shell:
  // electron-builder writes whatever `artifactName` says, `gh release upload` is handed a glob
  // that then matches nothing.
  assert.equal(release.match(/gh release upload "[^"]+" (dist-shell\/\S+)/)![1], expectedShellGlob(shellConfig))

  // Same guard, mutated input: proves it reads the pattern from the builder config rather
  // than restating a literal that can never disagree with itself.
  assert.notEqual(expectedShellGlob(shellConfig), expectedShellGlob(shellConfig.replace('-${arch}', '')))
})

test('the shell output directory is ignored', () => {
  // `dist-shell/` is a second build root; without this line a locally packaged installer
  // (60-90MB) is one `git add -A` away from the repository. The trailing `*` also covers a
  // throwaway output dir, which a killed NSIS stub can leave half-deletable behind.
  assert.ok(readFileSync('.gitignore', 'utf8').split('\n').includes('dist-shell*/'))
})

test('the new feature doc exists and is registered in the index', () => {
  assert.ok(existsSync('docs/features/wsl-daemon.md'), 'the WSL/headless behaviour must be documented')
  const index = readFileSync('docs/README.md', 'utf8')
  assert.match(index, /\[`features\/wsl-daemon\.md`\]\(features\/wsl-daemon\.md\)/,
    'a doc the index does not list is an orphan, and the index claims there are none')
  const plan = readFileSync('docs/README.md', 'utf8')
  assert.match(plan, /PLAN-wsl-headless-daemon-and-shell\.md/)
})
