/**
 * One SSE frame in, one event out - pure, so the wire and the fence share it.
 *
 * The rules the daemon's `/v1/management/events` depends on: a `: comment` line is a
 * heartbeat and must never surface as an event (a fake "empty update" is exactly the
 * ambiguity this repository keeps having to remove), `data:` may span several lines, and
 * a frame without a payload is not an event either.
 */

export interface SseEvent {
  channel: string
  payload: unknown
}

export function parseEventFrame(frame: string): SseEvent | null {
  let channel: string | null = null
  const dataLines: string[] = []

  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) channel = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }

  if (channel === null || channel === '' || dataLines.length === 0) return null

  try {
    return { channel, payload: JSON.parse(dataLines.join('\n')) }
  } catch {
    return null
  }
}
