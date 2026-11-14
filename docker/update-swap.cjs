#!/usr/bin/env node
/**
 * One-shot swap helper for the Docker gateway's in-UI update.
 *
 * Runs as a short-lived container from the RUNNING daemon's own image (entrypoint
 * overridden to this file), with /var/run/docker.sock mounted. The daemon cannot stop
 * itself - it is PID 1 - so this external actor does: stop old -> remove old -> wait for
 * the host port to free -> start new -> probe /health. The old container is removed (not
 * just stopped) to release its docker-proxy outright and leave no leftover; on failure it
 * is re-created from the inspect captured before removal. Every recreate preserves
 * ExposedPorts as well as PortBindings - the API drops a published port that is not also
 * exposed, which is what silently killed the host binding before this was understood.
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
const net = require('node:net')

const SOCK = '/var/run/docker.sock'
const OLD = process.env.MP_OLD || ''
const NEW = process.env.MP_NEW || ''
const PORT = Number(process.env.MP_PORT || 8080)
const SCHEME = process.env.MP_SCHEME === 'https' ? 'https' : 'http'
const PROBE_HOST = process.env.MP_PROBE_HOST || ''
const TIMEOUT_MS = Number(process.env.MP_TIMEOUT_MS || 60000)
const GRACE_MS = Number(process.env.MP_GRACE_MS || 3000)

// Captured before the old container is removed, so rollback can re-create it.
let oldInspect = null

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

// The old container's docker-proxy keeps the host port bound for several seconds
// after `docker stop`/`rm` returns (observed ~10s on a NAS). Starting the new container
// inside that window fails with "port is already allocated". So before starting the new
// container, wait until the host port actually refuses connections. From a bridge
// container the host is reachable at the network gateway; under host networking it is
// 127.0.0.1 (PROBE_HOST). A refused connect means docker-proxy has let the port go.
async function hostProbeHost() {
  if (PROBE_HOST !== '') return PROBE_HOST
  const inspect = await docker('GET', `/containers/${encodeURIComponent(NEW)}/json`)
  const networks = (inspect && inspect.NetworkSettings && inspect.NetworkSettings.Networks) || {}
  for (const key of Object.keys(networks)) {
    if (networks[key] && networks[key].Gateway) return networks[key].Gateway
  }
  return '172.17.0.1'
}

function tcpOpen(host, port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port, timeout: 2000 })
    sock.on('connect', () => {
      sock.destroy()
      resolve(true)
    })
    sock.on('timeout', () => {
      sock.destroy()
      resolve(false)
    })
    sock.on('error', () => resolve(false))
  })
}

async function waitForPortFree() {
  const host = await hostProbeHost()
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (!(await tcpOpen(host, PORT))) {
      log(`host port ${PORT} free (via ${host}); starting new container`)
      return
    }
    await sleep(500)
  }
  log(`host port ${PORT} still held after 30s; starting new container anyway`)
}

// Confirm the host port actually bound. NetworkSettings.Ports is the authoritative
// record of what got bound - HostConfig.PortBindings is only the request, and a port
// missing from ExposedPorts (or still held by the old proxy) never appears here even
// though the container runs and its bridge IP answers.
async function portPublished() {
  const inspect = await docker('GET', `/containers/${encodeURIComponent(NEW)}/json`)
  const ports = (inspect && inspect.NetworkSettings && inspect.NetworkSettings.Ports) || {}
  const binding = ports[`${PORT}/tcp`]
  return Array.isArray(binding) && binding.some((b) => b && b.HostPort)
}

// Re-create a container from an inspect. ExposedPorts is load-bearing: the Docker API
// only publishes a port that is ALSO in Config.ExposedPorts, and PortBindings alone is
// silently ignored for any port the image does not EXPOSE (the image exposes 8080/8443,
// the deployment publishes 18080). `docker run -p` fills ExposedPorts in for you; a raw
// API create does not, so dropping it here lost the 18080 binding on every recreate.
// Union the source ExposedPorts with the PortBindings keys so every bound port is exposed.
function bodyFromInspect(inspect, image) {
  const host = (inspect && inspect.HostConfig) || {}
  const cfg = (inspect && inspect.Config) || {}
  const portBindings = host.PortBindings || {}
  const exposed = { ...(cfg.ExposedPorts || {}) }
  for (const key of Object.keys(portBindings)) exposed[key] = exposed[key] || {}
  return {
    Image: image,
    Env: cfg.Env || [],
    ExposedPorts: exposed,
    HostConfig: {
      Binds: host.Binds || [],
      PortBindings: portBindings,
      RestartPolicy: host.RestartPolicy || { Name: 'no' },
      NetworkMode: host.NetworkMode || 'bridge',
      GroupAdd: host.GroupAdd || [],
    },
  }
}

async function recreateNew() {
  const inspect = await docker('GET', `/containers/${encodeURIComponent(NEW)}/json`)
  const body = bodyFromInspect(inspect, inspect.Config.Image)
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
    // The old container was removed before the new one started. Roll back by re-creating
    // it from the inspect captured up front, under the original name, from its stable
    // image id (guaranteed still present). bodyFromInspect preserves ExposedPorts so the
    // restored container re-publishes the host port.
    if (!oldInspect) throw new Error('no saved old-container inspect to roll back to')
    await docker('POST', `/containers/create?name=${encodeURIComponent(NEW)}`, bodyFromInspect(oldInspect, oldInspect.Image))
    await docker('POST', `/containers/${encodeURIComponent(NEW)}/start`)
    log(`ROLLED_BACK: re-created ${OLD} as ${NEW} from ${oldInspect.Image}`)
  } catch (error) {
    log(`ROLLBACK FAILED: ${error.message}`)
    log(`manual recovery: docker run the previous image as ${NEW}`)
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
  oldInspect = await docker('GET', `/containers/${encodeURIComponent(OLD)}/json`)
  await docker('POST', `/containers/${encodeURIComponent(OLD)}/stop?t=15`)
  log(`old container ${OLD} stopped`)
  // Remove the old container, not just stop it, so its docker-proxy and host-port
  // allocation are released outright and no leftover -prev container accumulates.
  // Rollback re-creates it from oldInspect (which preserves ExposedPorts).
  await docker('DELETE', `/containers/${encodeURIComponent(OLD)}?force=true&v=true`)
  log(`old container ${OLD} removed`)
  // Wait for any lingering docker-proxy to actually release the host port before the
  // new container claims it; a fixed sleep raced the proxy's slow release.
  await waitForPortFree()
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
  log(`SWAP_OK: ${NEW} is healthy; ${OLD} was removed`)
}

main().catch((error) => {
  log(`FATAL: ${error && error.message ? error.message : error}`)
  process.exitCode = 2
})