import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { isAppDocumentUrl } from '../window/manager'

/**
 * 具名 API 只限制了「渲染层能叫哪些通道」，它管不了通道另一头：主进程原本对调用方是谁
 * 毫无判断。一旦渲染进程被注入、或窗口被导航到外部文档，被注入的那段脚本面对的是
 * 124 个没有任何来源校验的 handler —— 包括把解密后凭据端出来的那一条。
 *
 * 所以这里统一包一次 `ipcMain.handle`：调用方文档必须是自己登记的（`window/manager` 里
 * 那份应用位置白名单）。之所以在一处包而不逐个改：漏写一处的代价就是那条通道永远裸奔。
 */
type HandleListener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
type HandleRegistrar = (channel: string, listener: HandleListener) => void

export function installTrustedSenderGuard(): void {
  const original = ipcMain.handle.bind(ipcMain) as HandleRegistrar

  const guarded: HandleRegistrar = (channel, listener) => {
    original(channel, (event, ...args) => {
      if (!isTrustedSender(event)) {
        throw new Error(`Rejected IPC call from an untrusted frame on channel "${channel}"`)
      }
      return listener(event, ...args)
    })
  }

  // `ipcMain.handle` 是重载签名，这里只替换实现、不改语义。
  ;(ipcMain as unknown as { handle: HandleRegistrar }).handle = guarded
}

/**
 * `senderFrame` 为空意味着帧已被销毁（或调用来自已分离的上下文）；那种情况下宁可拒绝。
 * 主窗口与托盘窗口加载的是同一份文档，所以两边都会通过。
 */
export function isTrustedSender(event: { senderFrame?: IpcMainInvokeEvent['senderFrame'] | null }): boolean {
  const frame = event.senderFrame
  if (!frame) return false
  return isAppDocumentUrl(frame.url)
}
