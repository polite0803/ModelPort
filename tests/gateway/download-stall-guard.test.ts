import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { downloadTo } from '../../src/main/gateway/download.ts'

// A local origin so the guard is exercised over a real socket, not a mock. Each
// helper returns the base URL and a closer that drops lingering sockets (a stalled
// response keeps its connection open, which would otherwise hang server.close()).
async function withServer(handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    }),
  }
}

test('a complete download writes the exact bytes (positive control)', async () => {
  const body = Buffer.from('modelport release asset bytes '.repeat(64))
  const srv = await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    res.end(body)
  })
  const dir = await mkdtemp(join(tmpdir(), 'mp-dl-ok-'))
  const path = join(dir, 'asset.tar.gz')
  try {
    await downloadTo(`${srv.url}/asset`, path)
    assert.deepEqual(await readFile(path), body)
  } finally {
    await srv.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('an HTTP error status rejects with the status, not a stall', async () => {
  const srv = await withServer((_req, res) => {
    res.writeHead(404)
    res.end('missing')
  })
  const dir = await mkdtemp(join(tmpdir(), 'mp-dl-404-'))
  try {
    await assert.rejects(
      () => downloadTo(`${srv.url}/asset`, join(dir, 'asset.tar.gz')),
      /下载失败 HTTP 404/,
    )
  } finally {
    await srv.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('a stalled transfer aborts within the stall window instead of hanging (bad sample)', async () => {
  // Headers + a few bytes, then silence forever: the exact 1.8.17 wedge shape.
  const srv = await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    res.write(Buffer.alloc(1024))
    // never end, never write again
  })
  const dir = await mkdtemp(join(tmpdir(), 'mp-dl-stall-'))
  const started = Date.now()
  try {
    await assert.rejects(
      () => downloadTo(`${srv.url}/asset`, join(dir, 'asset.tar.gz'), 300),
      /停滞/,
    )
    const elapsed = Date.now() - started
    assert.ok(elapsed < 3000, `should abort promptly, took ${elapsed}ms`)
  } finally {
    await srv.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('a slow-but-moving transfer is never aborted (per-chunk reset invariant)', async () => {
  // Five chunks 150ms apart: total ~750ms exceeds the 400ms stall window, but no
  // single gap does. A guard that timed the whole transfer would wrongly abort here.
  const chunks = Array.from({ length: 5 }, (_, i) => Buffer.from(`chunk-${i};`.repeat(32)))
  const srv = await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    void (async () => {
      for (const chunk of chunks) {
        res.write(chunk)
        await delay(150)
      }
      res.end()
    })()
  })
  const dir = await mkdtemp(join(tmpdir(), 'mp-dl-slow-'))
  const path = join(dir, 'asset.tar.gz')
  const started = Date.now()
  try {
    await downloadTo(`${srv.url}/asset`, path, 400)
    const elapsed = Date.now() - started
    assert.ok(elapsed >= 400, `should run past one stall window, took ${elapsed}ms`)
    assert.deepEqual(await readFile(path), Buffer.concat(chunks))
  } finally {
    await srv.close()
    await rm(dir, { recursive: true, force: true })
  }
})