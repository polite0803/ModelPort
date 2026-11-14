/**
 * Minimal Docker Engine API client over the unix socket - node:http only.
 *
 * The daemon ships with no node_modules, so a docker SDK is not an option; the
 * handful of endpoints the update needs (load/inspect/rename/create/start/stop/
 * remove) are plain HTTP. The socket is mounted opt-in at deploy time; without
 * it the update surface reports its absence instead of pretending.
 */
import { request as httpRequest } from 'node:http'
import { createReadStream } from 'node:fs'

export const DOCKER_SOCKET = '/var/run/docker.sock'

export function dockerApi<T>(
  method: string,
  path: string,
  body?: unknown,
  socketPath: string = DOCKER_SOCKET,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body)
    const req = httpRequest(
      {
        socketPath,
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
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          const status = res.statusCode ?? 0
          if (status >= 400) {
            reject(new Error(`docker ${method} ${path} -> ${status}: ${text.slice(0, 300)}`))
            return
          }
          try {
            resolve((text === '' ? null : JSON.parse(text)) as T)
          } catch {
            resolve(null as T)
          }
        })
      },
    )
    req.on('error', reject)
    if (payload !== null) req.write(payload)
    req.end()
  })
}

/** POST /images/load with the tarball streamed from disk; resolves with the daemon's progress log. */
export function dockerLoadImage(tarPath: string, socketPath: string = DOCKER_SOCKET): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        socketPath,
        method: 'POST',
        path: '/images/load?quiet=1',
        headers: { Host: 'docker', 'Content-Type': 'application/x-tar' },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          const status = res.statusCode ?? 0
          if (status >= 400) {
            reject(new Error(`docker images/load -> ${status}: ${text.slice(0, 300)}`))
            return
          }
          resolve(text)
        })
      },
    )
    req.on('error', reject)
    const file = createReadStream(tarPath)
    file.on('error', (error) => {
      req.destroy()
      reject(error)
    })
    file.pipe(req)
  })
}