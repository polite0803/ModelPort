/**
 * The "gateways" window: the list of address-book entries, with what each can do.
 *
 * The page is a self-contained `data:` document, like the failure pages: it holds no
 * credentials and no gateway data beyond the snapshot, and it renders every user-supplied
 * string through `textContent` (never by interpolating HTML). The bridge it talks to is
 * the named surface in `listPreload.ts`; there is no generic invoke.
 *
 * The main process owns the truth: this file only decides what a row looks like and which
 * buttons it carries, and asks again after every action.
 */

export function gatewayListPageUrl(): string {
  const html = `<!doctype html><meta charset="utf-8"><title>网关管理</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font:13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
         background:#1a1a1a; color:#eee; }
  header { display:flex; align-items:center; justify-content:space-between;
           padding:16px 18px 10px; }
  h1 { font-size:15px; margin:0; font-weight:600; }
  header .hint { color:#a1a1aa; font-size:12px; }
  #list { padding:0 18px 8px; display:flex; flex-direction:column; gap:8px; }
  .row { border:1px solid #2a2a2a; border-radius:8px; padding:10px 12px;
         display:flex; align-items:center; gap:12px; background:#202020; }
  .row.active { border-color:#3b82f6; }
  .main { flex:1; min-width:0; cursor:pointer; }
  .name { font-weight:600; }
  .name .badge { font-weight:500; font-size:11px; color:#a1a1aa;
                 border:1px solid #3a3a3a; border-radius:4px; padding:0 5px; margin-right:6px; }
  .detail { color:#a1a1aa; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .dot { width:8px; height:8px; border-radius:50%; flex:none; }
  .dot.running { background:#22c55e; } .dot.offline, .dot.unreachable { background:#ef4444; }
  .dot.stopped, .dot.not-installed { background:#a1a1aa; } .dot.unknown { background:#f59e0b; }
  .actions { display:flex; gap:6px; flex:none; }
  button { font:inherit; color:#eee; background:#2a2a2a; border:1px solid #3a3a3a;
           border-radius:6px; padding:4px 10px; cursor:pointer; }
  button:hover { background:#333; }
  button.primary { background:#2563eb; border-color:#2563eb; }
  button.danger { color:#fca5a5; }
  footer { display:flex; justify-content:space-between; padding:10px 18px 16px; }
  .empty { color:#a1a1aa; padding:28px 4px; text-align:center; }
  .error { color:#f87171; padding:0 18px 10px; }
</style>
<header>
  <h1>网关管理</h1>
  <span class="hint">点一行即可切换；Ctrl+Shift+G 随时打开</span>
</header>
<div id="error" class="error" hidden></div>
<div id="list"></div>
<footer>
  <button id="add" class="primary">新增网关…</button>
  <button id="close">关闭</button>
</footer>
<script>
const api = window.shellList
const list = document.getElementById('list')
const errorBox = document.getElementById('error')

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function renderRow(row, labels) {
  const wrap = el('div', 'row' + (row.active ? ' active' : ''))
  const dot = el('span', 'dot ' + row.phase)
  wrap.appendChild(dot)

  const main = el('div', 'main')
  const name = el('div', 'name')
  name.appendChild(el('span', 'badge', row.active ? '当前' : ''))
  name.appendChild(document.createTextNode(row.name))
  main.appendChild(name)
  main.appendChild(el('div', 'detail', row.detail))
  main.onclick = function () {
    if (row.actions.indexOf('connect') !== -1) void api.connect(row.id)
  }
  wrap.appendChild(main)

  const actions = el('div', 'actions')
  for (const action of row.actions) {
    if (action === 'connect') continue
    const button = el('button', action === 'remove' ? 'danger' : '', labels[action])
    button.onclick = function () {
      if (action === 'edit') void api.edit(row.id)
      else if (action === 'remove') void api.remove(row.id)
      else if (action === 'install') void api.installWsl(row.id)
      else void api.localAction(row.id, action)
    }
    actions.appendChild(button)
  }
  wrap.appendChild(actions)
  return wrap
}

async function refresh() {
  const snapshot = await api.snapshot()
  list.replaceChildren()
  if (snapshot.error) {
    errorBox.hidden = false
    errorBox.textContent = snapshot.error
  } else {
    errorBox.hidden = true
  }
  if (snapshot.rows.length === 0) {
    const empty = el('div', 'empty', '还没有配置网关。点下面的「新增网关」。')
    list.appendChild(empty)
    return
  }
  for (const row of snapshot.rows) list.appendChild(renderRow(row, snapshot.labels))
}

document.getElementById('add').onclick = function () { void api.add() }
document.getElementById('close').onclick = function () { void api.close() }
api.onChanged(function () { void refresh() })
void refresh()
</script>
`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}
