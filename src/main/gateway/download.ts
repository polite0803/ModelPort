/**
 * Download a release asset to disk with a stall guard.
 *
 * GitHub from some hosts (the Docker gateway behind a tunnel, a NAT'd NAS) is
 * intermittently slow or silently stalls mid-transfer. A plain fetch+pipeline has
 * no timeout, so a stalled transfer hangs forever and wedges the caller's `running`
 * flag. The guard aborts only when NO bytes arrive for `stallMs` - a slow-but-moving
 * download is never punished ("slow" is not the predicate, "never progresses" is).
 *
 * Self-contained (node builtins + global fetch only) so it imports in node:test
 * without the host binding or the bundler resolve hooks, like dockerUpdatePlan.ts.
 */
import { createWriteStream } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export const DOWNLOAD_STALL_MS = 30_000

export async function downloadTo(url: string, path: string, stallMs: number = DOWNLOAD_STALL_MS): Promise<void> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let stalled = false
  const arm = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      stalled = true
      controller.abort()
    }, stallMs)
  }
  arm() // also covers the connect / response-headers phase
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'ModelPort' },
      signal: controller.signal,
    })
    if (!response.ok || response.body === null) {
      throw new Error(`下载失败 HTTP ${response.status}: ${url}`)
    }
    // Reset the stall timer on every chunk so a steady trickle never trips it.
    const reset = new Transform({
      transform(chunk, _encoding, callback) {
        arm()
        callback(null, chunk)
      },
    })
    await pipeline(
      Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream),
      reset,
      createWriteStream(path),
    )
  } catch (error) {
    if (stalled) {
      throw new Error(`下载停滞 ${Math.round(stallMs / 1000)}s 无进展，已中止（网络不可达或上游限速）: ${url}`)
    }
    throw error
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}