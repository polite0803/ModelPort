#!/usr/bin/env node
/**
 * One-shot swap helper for the Docker gateway's in-UI update.
 *
 * Runs as a short-lived container from the RUNNING daemon's own image (entrypoint
 * overridden to this file), with /var/run/docker.sock mounted. The daemon cannot stop
 * itself - it is PID 1 - so this external actor does: stop old -> start new -> probe
 * /health -> remove old on success, or roll back to the old container on failure.
 *
 * Env (set by src/main/gateway/dockerUpdate.ts):
 *   MP_OLD         old container name (<name>-prev while the swap runs)
 *   MP_NEW         new container name (the original name)
 *   MP_PORT        port the daemon listens on inside the container
 *   MP_SCHEME      http | https
 *   MP_PROBE_HOST  empty = resolve the new container's bridge IP; else use as-is
 *   MP_TIMEOUT_MS  health-probe window
 *   MP_GRACE_MS    sleep before stopping the old daemon (lets the RPC response flush)
 *
 * Kept dependency-free CJS: it runs inside the shipped image, which has no
 * node_modules. Logs stay readable via `docker logs modelport-update-swap`
 * (the container is NOT auto-removed; the next update cleans it up).
 */
'use strict'
const http = require('node:http')
const https = require('node:https')

const SOCK = '/var/run/docker.sock'
const OLD = process.env.MP_OLD || ''
const NEW = process.env.MP_NEW || ''
const PORT = Number(process.env.MP_PORT || 8080)
const SCHEME = process.env.MP_SCHEME === 'https' ? 'https' : 'http'
const PROBE_HOST = process.env.MP_PROBE_HOST || ''
const TIMEOUT_MS = Number(process.env.MP_TIMEOUT_MS || 60000)
const GRACE_MS = Number(process.env.MP_GRACE_MS || 3000)

function log(line) {
  console.log(`[update-swap] ${line}`)
}

function docker(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body)
    const req = http.request(
      {
        socketPath: SOCK,
        method,
        path,
        headers: {
          Host: 'docker',
          ...(payload !== null
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          const status = res.statusCode || 0
          if (status >= 400) {
            reject(new Error(`docker ${method} ${path} -> ${status}: ${text.slice(0, 300)}`))
            return
          }
          try {
            resolve(text === '' ? null : JSON.parse(text))
          } catch {
            resolve(null)
          }
        })
      },
    )
    req.on('error', reject)
    if (payload !== null) req.write(payload)
    req.end()
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function probeOnce(host) {
  return new Promise((resolve) => {
    const mod = SCHEME === 'https' ? https : http
    const req = mod.request(
      {
        host,
        port: PORT,
        path: '/health',
        method: 'GET',
        timeout: 3000,
        ...(SCHEME === 'https' ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          resolve(res.statusCode === 200 && text.includes('"ok":true'))
        })
      },
    )
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.on('error', () => resolve(false))
    req.end()
  })
}

async function resolveProbeHost() {
  if (PROBE_HOST !== '') return PROBE_HOST
  const inspect = await docker('GET', `/containers/${encodeURIComponent(NEW)}/json`)
  const settings = (inspect && inspect.NetworkSettings) || {}
  if (settings.IPAddress) return settings.IPAddress
  const networks = settings.Networks || {}
  for (const key of Object.keys(networks)) {
    if (networks[key] && networks[key].IPAddress) return networks[key].IPAddress
  }
  throw new Error(`cannot resolve an IP for container ${NEW}`)
}

async function probeHealthy() {
  const host = await resolveProbeHost()
  log(`probing ${SCHEME}://${host}:${PORT}/health (window ${TIMEOUT_MS}ms)`)
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await probeOnce(host)) return true
    await sleep(1000)
  }
  return false
}

// Docker binds host ports at container start. The new container is created while the
// old one still holds them, and if the old docker-proxy has not released the port by
// the time the new one starts, Docker silently drops that binding (the container runs,
// the bridge IP answers, but the host port is dead). NetworkSettings.Ports is the
// authoritative record of what actually got bound - HostConfig.PortBindings is only
// the request.
async function portPublished() {
  const inspect = await docker('GET', `/containers/${encodeURIComponent(NEW)}/json`)
  const ports = (inspect && inspect.NetworkSettings && inspect.NetworkSettings.Ports) || {}
  const binding = ports[`${PORT}/tcp`]
  return Array.isArray(binding) && binding.some((b) => b && b.HostPort)
}

// Re-create the new container from its own inspect. A full delete+create re-allocates
// the host ports (a mere restart reuses the broken allocation); with the old container
// already stopped the ports are free, so the binding sticks this time.
async function recreateNew() {
  const inspect = await docker('GET', `/containers/${encodeURIComponent(NEW)}/json`)
  const host = (inspect && inspect.HostConfig) || {}
  const cfg = (inspect && inspect.Config) || {}
  const body = {
    Image: cfg.Image,
    Env: cfg.Env || [],
    HostConfig: {
      Binds: host.Binds || [],
      PortBindings: host.PortBindings || {},
      RestartPolicy: host.RestartPolicy || { Name: 'no' },
      NetworkMode: host.NetworkMode || 'bridge',
      GroupAdd: host.GroupAdd || [],
    },
  }
  await docker('DELETE', `/containers/${encodeURIComponent(NEW)}?force=true`)
  await docker('POST', `/containers/create?name=${encodeURIComponent(NEW)}`, body)
  await docker('POST', `/containers/${encodeURIComponent(NEW)}/start`)
}

async function ensurePublished() {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await portPublished()) return true
    log(`host port ${PORT} not bound; re-creating ${NEW} (attempt ${attempt + 1})`)
    await recreateNew()
    await sleep(1500)
  }
  return portPublished()
}

async function rollback(reason) {
  log(`ROLLBACK: ${reason}`)
  try {
    await docker('POST', `/containers/${encodeURIComponent(NEW)}/stop?t=5`).catch(() => undefined)
    await docker('DELETE', `/containers/${encodeURIComponent(NEW)}?force=true&v=true`).catch(() => undefined)
    // The new container held the original name; removing it frees the name for the old one.
    await docker('POST', `/containers/${encodeURIComponent(OLD)}/rename?name=${encodeURIComponent(NEW)}`)
    await docker('POST', `/containers/${encodeURIComponent(OLD)}/start`)
    log(`ROLLED_BACK: ${OLD} is running again as ${NEW}`)
  } catch (error) {
    log(`ROLLBACK FAILED: ${error.message}`)
    log(`manual recovery: docker start ${OLD}`)
    process.exitCode = 2
    return
  }
  process.exitCode = 1
}

async function main() {
  if (OLD === '' || NEW === '') {
    log('MP_OLD/MP_NEW missing; refusing to swap')
    process.exitCode = 2
    return
  }
  log(`grace ${GRACE_MS}ms, then stop ${OLD} -> start ${NEW}`)
  await sleep(GRACE_MS)
  await docker('POST', `/containers/${encodeURIComponent(OLD)}/stop?t=15`)
  log(`old container ${OLD} stopped`)
  // Let the old docker-proxy release the host ports before the new container claims them.
  await sleep(1500)
  try {
    await docker('POST', `/containers/${encodeURIComponent(NEW)}/start`)
  } catch (error) {
    await rollback(`start new failed: ${error.message}`)
    return
  }
  log(`new container ${NEW} started`)
  let published = false
  try {
    published = await ensurePublished()
  } catch (error) {
    await rollback(`port publish error: ${error.message}`)
    return
  }
  if (!published) {
    await rollback(`host port ${PORT} never published`)
    return
  }
  let healthy = false
  try {
    healthy = await probeHealthy()
  } catch (error) {
    await rollback(`probe error: ${error.message}`)
    return
  }
  if (!healthy) {
    await rollback('new container did not answer /health within the window')
    return
  }
  await docker('DELETE', `/containers/${encodeURIComponent(OLD)}?force=true&v=true`)
  log(`SWAP_OK: ${NEW} is healthy; removed ${OLD}`)
}

main().catch((error) => {
  log(`FATAL: ${error && error.message ? error.message : error}`)
  process.exitCode = 2
})