/**
 * Packages the headless daemon as a Docker image tarball (`docker load` ready).
 *
 * Consumes the staged tree produced by `npm run build:daemon`, builds the image with
 * docker/Dockerfile, then `docker save | gzip`s it to
 * dist/modelport-daemon-<version>-docker-<arch>.tar.gz plus a basename-only .sha256
 * (the same checksum shape the release workflow uploads for every other artifact).
 *
 * Requires a Docker daemon on the build host: CI runners and deployment targets have
 * one, the WSL dev host does not - fail loudly there instead of shipping a broken asset.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { createGzip } from 'node:zlib'
import { createWriteStream } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const arch = process.env.DAEMON_ARCH || process.arch
const tag = `modelport-daemon:${pkg.version}`
const stageDir = join(root, 'dist', 'daemon-stage', `modelport-daemon-${pkg.version}`)
const outName = `modelport-daemon-${pkg.version}-docker-${arch}.tar.gz`
const outPath = join(root, 'dist', outName)

const required = [
  'modelport-daemon.cjs',
  join('resources', 'channel-pack', 'worker.mjs'),
  join('renderer', 'index.html'),
  'update-swap.cjs',
]
for (const item of required) {
  if (!existsSync(join(stageDir, item))) {
    console.error(`::error::${item} is missing from ${stageDir} - run \`npm run build && npm run build:daemon\` first`)
    process.exit(1)
  }
}

const probe = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' })
if (probe.status !== 0) {
  console.error('::error::docker is unavailable on this host; build the image where a Docker daemon runs ' +
    '(a CI runner or the deployment target)')
  process.exit(1)
}

const build = spawnSync('docker', ['build', '-f', join(root, 'docker', 'Dockerfile'), '-t', tag, stageDir], {
  stdio: 'inherit',
})
if (build.status !== 0) process.exit(build.status ?? 1)

await mkdir(join(root, 'dist'), { recursive: true })
const save = spawn('docker', ['save', tag])
// Attach before the pipeline: docker save closes once stdout drains; a listener added after `await pipeline` misses it (exit 13).
const closed = new Promise(resolve => save.on('close', resolve))
try {
  await pipeline(save.stdout, createGzip(), createWriteStream(outPath))
} catch (error) {
  save.kill()
  console.error(`::error::docker save failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
const code = await closed
if (code !== 0) {
  console.error(`::error::docker save exited with ${code}`)
  process.exit(1)
}

const hash = createHash('sha256')
for await (const chunk of createReadStream(outPath)) hash.update(chunk)
writeFileSync(`${outPath}.sha256`, `${hash.digest('hex')}  ${outName}\n`)

console.log(
  `docker: ${tag} packaged as dist/${outName} (${(statSync(outPath).size / 1024 / 1024).toFixed(1)} MB) + .sha256`,
)