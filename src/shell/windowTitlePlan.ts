/**
 * The shell window's title: which gateway this console is currently pointed at.
 *
 * The window used to say only "ModelPort" while it could be showing any of several
 * gateways - with two entries named alike there was no way to tell which one answers
 * the next click. The title now carries the active entry's name and host, on every
 * page including the failure documents, and the page's own <title> may not overwrite
 * it (main.ts prevents the native update and re-applies this string).
 */

export interface WindowTitleEntry {
  name: string
  url: string
}

export function gatewayWindowTitle(entry: WindowTitleEntry | null): string {
  if (entry === null) return 'ModelPort'
  let host = entry.url
  try {
    host = new URL(entry.url).host
  } catch {
    // An unparseable URL still names the entry; the raw string beats an empty title.
  }
  const name = entry.name.trim() === '' ? host : entry.name.trim()
  return `ModelPort — ${name} (${host})`
}