/**
 * Serves the built renderer to a browser - the headless host's UI.
 *
 * The Electron shell loads the same files with `loadFile`, so this route exists only
 * when the host reports a web root (`getWebRoot`). Two rules keep it honest:
 *
 * - `/` stays the JSON index it has always been. The UI lives under `/ui`, and the
 *   absolute asset URLs in `index.html` are rewritten to that prefix, so the build does
 *   not need a web-specific `base` (which would also change the desktop bundle).
 * - The renderer uses `HashRouter`, so every path under `/ui` is the same document and
 *   there is no history fallback to invent.
 *
 * No authentication here: the page itself is public-looking only - every call it makes
 * needs the management secret, so a stranger gets an empty shell, not data. The asset
 * paths are resolved inside the web root and traversal is refused rather than normalized
 * away.
 */

import Router from '@koa/router'
import type { Context } from 'koa'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { getHost } from '../../runtime/host'

// `strict` keeps `/ui` and `/ui/` distinct: the build emits relative asset URLs
// (`./assets/…`), so the document must be served from the trailing-slash form or the
// browser resolves them against the root. Without strictness koa-router matches both and
// the redirect loops onto itself.
const router = new Router({ strict: true })

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
}

function webRoot(): string | undefined {
  const root = getHost().getWebRoot?.()
  return root && existsSync(join(root, 'index.html')) ? root : undefined
}

/** Inside-root only. `..`, absolute paths and symlink escapes all come back as null. */
function resolveAsset(root: string, relative: string): string | null {
  if (relative === '' || relative.includes('\0') || relative.includes(':')) return null
  const candidate = resolve(root, relative)
  const normalizedRoot = resolve(root)
  if (candidate !== normalizedRoot && !candidate.startsWith(normalizedRoot + sep)) return null
  return existsSync(candidate) && statSync(candidate).isFile() ? candidate : null
}

function indexHtml(root: string): string {
  return readFileSync(join(root, 'index.html'), 'utf-8')
}

function notFound(ctx: Context): void {
  ctx.status = 404
  ctx.body = {
    success: false,
    error: { code: 'ui_not_built', message: 'No built renderer is available on this host (npm run build)' },
  }
}

// The build emits relative asset URLs (`./assets/…`), so the document has to be served
// at `/ui/` - from `/ui` the browser resolves them against the root and misses. `/ui`
// redirects instead of rewriting the HTML, so no build flag has to change for the web.
router.get('/ui', (ctx: Context) => {
  ctx.status = 302
  ctx.redirect('/ui/')
})

router.get('/ui/{*assetPath}', (ctx: Context) => {
  const root = webRoot()
  if (!root) return notFound(ctx)
  const relative = (ctx.params.assetPath as string) ?? ''

  if (relative === '') {
    ctx.type = 'text/html; charset=utf-8'
    ctx.set('Cache-Control', 'no-store')
    ctx.body = indexHtml(root)
    return
  }
  const file = resolveAsset(root, relative)
  if (!file) {
    ctx.status = 404
    ctx.body = { success: false, error: { code: 'not_found', message: 'No such UI asset' } }
    return
  }
  const extension = file.slice(file.lastIndexOf('.'))
  ctx.type = CONTENT_TYPES[extension] ?? 'application/octet-stream'
  // Vite names emitted assets with a content hash, so they are safe to cache hard;
  // the document itself is always re-read (no-store above).
  ctx.set('Cache-Control', extension === '.html' ? 'no-store' : 'public, max-age=31536000, immutable')
  ctx.body = readFileSync(file)
})

export default router
