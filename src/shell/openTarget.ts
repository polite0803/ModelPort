/**
 * Where a `window.open` / `target=_blank` request from the console's page belongs.
 *
 * The window hosts a *remote* document served by the active gateway, so it must not grow a
 * second surface of its own. The old rule was "http(s) → the OS browser", which read as
 * "everything opens a browser": the page is a HashRouter SPA and its own links are ordinary
 * `window.open`/`_blank` anchors, so a click meant to change page left the app instead.
 *
 * Three outcomes are enough:
 *
 *   navigate - same origin, a route of the SPA: the window routes there in place
 *   load     - the window is showing a `data:` failure page, so there is no SPA to route;
 *              a target on the gateway's own UI path is loaded in the window (retry)
 *   external - a different origin: the real browser, as before
 *   ignore   - not http(s) at all: `file://`, `smb://`, `ms-msdt:` hand credentials or
 *              local programs to a protocol handler, so they never reach the shell
 */
export type WindowOpenDecision =
  | { kind: 'navigate'; path: string }
  | { kind: 'load'; url: string }
  | { kind: 'external'; url: string }
  | { kind: 'ignore' }

/** The gateway serves its UI here; `/ui` alone only bounces through a 302. */
const UI_ROOT = '/ui'

function parseHttp(raw: string): URL | null {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null
}

/**
 * The SPA route a gateway URL points at, or `null` when it is not a page of the UI.
 *
 * `/ui/#/logs?x=1` (what the router writes) and `/ui/logs` (what a hand-built link looks
 * like) both mean the same route. A path such as `/health` is not a page: loading it into
 * the window would replace the app with JSON.
 */
function uiRouteOf(target: URL): string | null {
  if (target.hash.startsWith('#/')) {
    const path = target.hash.slice(1)
    // `#//host/x` is a protocol-relative URL wearing a route's clothes.
    return path.startsWith('//') ? null : path
  }
  if (target.pathname === UI_ROOT || target.pathname === `${UI_ROOT}/`) return '/'
  if (target.pathname.startsWith(`${UI_ROOT}/`)) {
    return `${target.pathname.slice(UI_ROOT.length)}${target.search}`
  }
  return null
}

export function decideWindowOpen(currentUrl: string, target: string): WindowOpenDecision {
  const to = parseHttp(target)
  if (to === null) return { kind: 'ignore' }

  const from = parseHttp(currentUrl)
  const route = uiRouteOf(to)

  // A `data:` failure page (untrusted certificate, gateway down) has no origin to compare.
  // Its own links point at the UI path and mean "load it again"; anything else is external.
  if (from === null) {
    return route === null ? { kind: 'external', url: to.href } : { kind: 'load', url: to.href }
  }

  if (from.origin !== to.origin) return { kind: 'external', url: to.href }
  if (route === null) return { kind: 'external', url: to.href }
  return { kind: 'navigate', path: route }
}