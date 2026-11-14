/**
 * Release feed for the Docker gateway's in-UI update - the daemon-side twin of
 * `src/shell/wslExec.ts::fetchLatestRelease`, with the same atom-first rule and the
 * same TTL/backoff. Global fetch instead of electron `net`: this module runs in the
 * headless daemon, which has no Electron.
 */
import {
  RELEASES_ATOM,
  parseLatestTagFromAtom,
  parseRelease,
  releaseFeedUrl,
  releaseFromTag,
  type ReleaseInfo,
} from '../../shell/updatePlan'

const RELEASE_FEED_TTL_MS = 10 * 60 * 1000
const RELEASE_FEED_FAILURE_BACKOFF_MS = 60 * 1000
const RELEASE_FEED_RETRY_CAP_MS = 60 * 60 * 1000

let releaseFeedSuccess: { key: string; release: ReleaseInfo; expiresAt: number } | null = null
let releaseFeedFailure: { key: string; message: string; retryAtMs: number } | null = null

async function fetchText(url: string, accept: string): Promise<string> {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { accept, 'user-agent': 'ModelPort' },
  })
  if (!response.ok) {
    const body = (await response.text().catch(() => '')).trim().slice(0, 400)
    throw new Error(`HTTP ${response.status} for ${url}${body === '' ? '' : `：${body}`}`)
  }
  return response.text()
}

export async function fetchLatestDockerRelease(): Promise<ReleaseInfo> {
  const override = releaseFeedUrl()
  const key = override ?? RELEASES_ATOM
  const now = Date.now()
  if (releaseFeedSuccess && releaseFeedSuccess.key === key && releaseFeedSuccess.expiresAt > now) {
    return releaseFeedSuccess.release
  }
  if (releaseFeedFailure && releaseFeedFailure.key === key && releaseFeedFailure.retryAtMs > now) {
    const waitSeconds = Math.ceil((releaseFeedFailure.retryAtMs - now) / 1000)
    throw new Error(`${releaseFeedFailure.message}（已退避，${waitSeconds}s 后才会再次请求）`)
  }
  try {
    let release: ReleaseInfo
    if (override !== null) {
      release = parseRelease(JSON.parse(await fetchText(override, 'application/json')))
    } else {
      const tag = parseLatestTagFromAtom(
        await fetchText(RELEASES_ATOM, 'application/atom+xml, application/xml;q=0.9, text/xml;q=0.8'),
      )
      if (tag === null) throw new Error(`${RELEASES_ATOM} 里没有可解析的 release tag`)
      release = releaseFromTag(tag)
    }
    releaseFeedSuccess = { key, release, expiresAt: now + RELEASE_FEED_TTL_MS }
    releaseFeedFailure = null
    return release
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    releaseFeedFailure = {
      key,
      message,
      retryAtMs: now + Math.min(RELEASE_FEED_FAILURE_BACKOFF_MS, RELEASE_FEED_RETRY_CAP_MS),
    }
    throw error
  }
}