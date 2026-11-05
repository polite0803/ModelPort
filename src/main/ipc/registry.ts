/**
 * Main-process handler registry - one table, two transports.
 *
 * Every management action the UI can take is already a plain async function keyed by
 * a channel name. This module keeps that table host-free: the Electron shell wires an
 * `ipcMain` transport into it, and the headless daemon reads the very same table from
 * `/v1/management/rpc`. Registering the handlers twice - or writing a second set of
 * HTTP route bodies - is how the two surfaces drift apart, which is exactly the class
 * of bug where a switch exists in one and silently does nothing in the other.
 *
 * Handlers keep their Electron-style `(event, ...args)` signature. Over HTTP the event
 * is a neutral object, so no handler body has to care which transport called it.
 */

export type MainHandler = (event: unknown, ...args: any[]) => unknown | Promise<unknown>

export type IpcTransport = (channel: string, handler: MainHandler) => void

const handlers = new Map<string, MainHandler>()

/** A stand-in for `IpcMainInvokeEvent` when the caller is HTTP rather than the shell. */
const HEADLESS_EVENT = Object.freeze({ sender: null, senderFrame: null })

let transport: IpcTransport | null = null

/** Called by a host before it registers anything, so registration can reach its wire. */
export function setIpcTransport(next: IpcTransport | null): void {
  transport = next
}

export function registerMainHandler(channel: string, handler: MainHandler): void {
  handlers.set(channel, handler)
  if (transport) transport(channel, handler)
}

export function listRegisteredChannels(): string[] {
  return [...handlers.keys()]
}

export function hasHandler(channel: string): boolean {
  return handlers.has(channel)
}

/**
 * Invokes a registered handler.
 *
 * Unknown channels throw rather than returning `undefined`: an HTTP client that typed a
 * wrong method name must see `unknown_channel`, not a successful-looking empty result.
 */
export async function invokeMainHandler(channel: string, args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) {
    throw new UnknownHandlerError(channel)
  }
  return handler(HEADLESS_EVENT, ...args)
}

export class UnknownHandlerError extends Error {
  readonly channel: string

  constructor(channel: string) {
    super(`No handler registered for channel: ${channel}`)
    this.name = 'UnknownHandlerError'
    this.channel = channel
  }
}
