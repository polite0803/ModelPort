/**
 * The add/edit gateway dialog, as a self-contained `data:` document.
 *
 * Kept out of `main.ts` so it can be asserted without Electron: this page had a real bug
 * that only a source test would have caught - `cancel.onclick = send('cancel')` calls the
 * bridge at load time, so the dialog closed itself the instant it opened and both
 * "添加网关" and "编辑当前网关" looked like they did nothing.
 *
 * Wiring rules the page must keep:
 * - a click handler is assigned a **function** (`onclick = cancel`), never the result of
 *   calling the bridge;
 * - every prefill goes through `escapeHtml` exactly once - the document itself is
 *   percent-encoded afterwards, and a second encode breaks the origin validator.
 */
import type { GatewayKind } from '../shared/shellList.ts'
import { escapeHtml } from './htmlEscape.ts'

export interface GatewayPromptDraft {
  name: string
  url: string
  kind: GatewayKind
  wslDistro?: string
}

export function gatewayPromptPageUrl(input: {
  existing?: GatewayPromptDraft
  /** WSL is a Windows-only mode; elsewhere the option must not appear at all. */
  canUseWsl: boolean
}): string {
  const existing = input.existing
  const nameValue = existing ? ` value="${escapeHtml(existing.name)}"` : ''
  const urlValue = existing ? ` value="${escapeHtml(existing.url)}"` : ''
  const distroValue = existing?.wslDistro ? ` value="${escapeHtml(existing.wslDistro)}"` : ''
  const kind: GatewayKind = existing?.kind === 'wsl' && !input.canUseWsl
    ? 'remote'
    : (existing?.kind ?? 'local')
  const selected = (value: GatewayKind): string =>
    ` value="${value}"${kind === value ? ' selected' : ''}`

  const html = `<!doctype html><meta charset="utf-8"><title>gateway</title>
<body style="font:14px/1.5 system-ui;padding:18px;background:#1a1a1a;color:#eee">
<label style="display:block;margin-bottom:10px">名称<input id="name"${nameValue}
  style="display:block;width:100%;margin-top:4px;padding:6px;box-sizing:border-box"></label>
<label style="display:block;margin-bottom:10px">形态<select id="kind"
  style="display:block;width:100%;margin-top:4px;padding:6px;box-sizing:border-box">
  <option${selected('local')}>本地（由本控制台安装与启动）</option>
  ${input.canUseWsl ? `<option${selected('wsl')}>WSL（网关装在 WSL 里，本控制台负责安装与升级）</option>` : ''}
  <option${selected('remote')}>远程（网关在另一台机器上，本控制台只连接）</option>
</select></label>
<label id="urlRow" style="display:block;margin-bottom:10px">地址<input id="url"${urlValue} placeholder="http://127.0.0.1:8080"
  style="display:block;width:100%;margin-top:4px;padding:6px;box-sizing:border-box"></label>
<label id="wslRow" style="display:block;margin-bottom:10px">WSL 发行版（留空使用默认）<input id="wslDistro"${distroValue} placeholder="Ubuntu-24.04"
  style="display:block;width:100%;margin-top:4px;padding:6px;box-sizing:border-box"></label>
<p id="err" style="color:#f87171;min-height:1.2em;margin:0"></p>
<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
<button id="cancel" style="padding:6px 14px">取消</button>
<button id="ok" style="padding:6px 14px">保存</button></div>
<script>
const mode = document.getElementById('kind')
const sync = function () {
  document.getElementById('urlRow').style.display = mode.value === 'local' ? 'none' : 'block'
  document.getElementById('wslRow').style.display = mode.value === 'wsl' ? 'block' : 'none'
}
mode.onchange = sync
sync()
const send = function (name, values) { window.promptHost[name](values) }
const cancel = function () { send('cancel') }
document.getElementById('ok').onclick = function () {
  send('submit', {
    name: document.getElementById('name').value,
    url: document.getElementById('url').value,
    kind: mode.value,
    wslDistro: document.getElementById('wslDistro').value,
  })
}
document.getElementById('cancel').onclick = cancel
addEventListener('keydown', function (event) {
  if (event.key === 'Enter') document.getElementById('ok').click()
  if (event.key === 'Escape') cancel()
})
</script></body>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}
