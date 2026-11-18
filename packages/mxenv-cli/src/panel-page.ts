// P2 第一片：宿主自带的最小面板页（token-in-path 一次换 HTML，无外部资产/无构建链）。
// 正式 React 面板（panel-ui/）落地后替换本文件内容；宿主路由与认证纪律不变。
// 页面纪律：值仅在解锁窗口内逐键揭示、页面驻留值带自动隐藏、所有 reveal 走边界头（human-only）。

const SOURCE_LABELS: Record<string, string> = {
  __mx_global_dotenv: 'global baseline',
  __mx_default_local: 'local files',
  __mx_default_dotenvx: 'dotenvx files',
  __mx_legacy_infisical: 'Infisical (legacy)',
  __mx_cli_local_override: 'env-file override',
}

export function sourceLabelClient(name: string): string {
  return SOURCE_LABELS[name] || name
}

export function panelPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>mxenv panel</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0 0 48px;
    background: #111827; color: #F9FAFB;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 15px; line-height: 1.5;
  }
  .wrap { max-width: 880px; margin: 0 auto; padding: 0 24px; }
  header { display: flex; align-items: baseline; gap: 12px; padding: 28px 0 4px; }
  .brand { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
  .brand i { font-style: normal; color: #79E2C3; }
  .sub { color: #9CA3AF; font-size: 14px; }
  .badge {
    margin-left: auto; padding: 3px 10px; border-radius: 999px;
    font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
  }
  .badge.locked { background: #374151; color: #D1D5DB; }
  .badge.unlocked { background: rgba(121, 226, 195, 0.16); color: #79E2C3; }
  .meta { color: #6B7280; font-size: 12.5px; margin-bottom: 18px; }
  .toolbar { display: flex; gap: 10px; margin: 6px 0 20px; }
  button {
    font: inherit; border: 0; border-radius: 8px; padding: 7px 16px; cursor: pointer;
    background: #1F2937; color: #E5E7EB;
  }
  button:hover { background: #273449; }
  button.primary { background: #79E2C3; color: #064E3B; font-weight: 600; }
  button.primary:hover { background: #8EEAD0; }
  button.ghost { background: transparent; color: #9CA3AF; }
  button.ghost:hover { color: #E5E7EB; background: #1F2937; }
  button:disabled { opacity: 0.45; cursor: default; }
  .hint { color: #9CA3AF; font-size: 13px; margin-left: auto; align-self: center; }
  .keys { width: 100%; border-collapse: collapse; }
  .keys th {
    text-align: left; font-size: 11.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
    color: #6B7280; padding: 8px 12px; border-bottom: 1px solid #1F2937;
  }
  .keys td { padding: 9px 12px; border-bottom: 1px solid #1B2433; vertical-align: top; }
  .keys td.k { font-family: ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace; font-size: 13.5px; white-space: nowrap; }
  .keys td.s { color: #9CA3AF; font-size: 13px; white-space: nowrap; }
  .keys td.a { text-align: right; white-space: nowrap; }
  .row-value td { border-bottom: 1px solid #1B2433; background: #0D1420; }
  .value-box { display: flex; gap: 10px; align-items: center; }
  .value-text {
    font-family: ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace; font-size: 13px;
    color: #79E2C3; word-break: break-all;
  }
  .value-note { color: #6B7280; font-size: 12px; }
  .msg { color: #F87171; font-size: 13px; min-height: 20px; margin: 0 0 10px; }
  footer { margin-top: 28px; color: #6B7280; font-size: 12.5px; line-height: 1.7; }
  .empty { color: #9CA3AF; padding: 24px 0; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <span class="brand">mxenv<i>.</i></span>
    <span class="sub">panel</span>
    <span class="badge locked" id="badge">…</span>
  </header>
  <div class="meta" id="meta"></div>
  <div class="toolbar">
    <button class="primary" id="unlock">Unlock</button>
    <button id="lock" disabled>Lock</button>
    <button class="ghost" id="refresh">Refresh</button>
    <span class="hint" id="hint"></span>
  </div>
  <p class="msg" id="msg"></p>
  <table class="keys">
    <thead><tr><th>Key</th><th>Source</th><th></th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
  <div class="empty" id="empty" hidden>No keys resolved. Check ~/.mxenv or project config.</div>
  <footer>
    Values live only in this window: each reveal is one key at a time, audited (<span style="font-family:ui-monospace,monospace">via: host</span>), and never leaves this machine.
    The host is bound to loopback; closing this tab or locking hides everything again.
  </footer>
</div>
<script>
'use strict'
var TOKEN = location.pathname.replace(/^\\/+/, '').replace(/\\/+$/, '')
var LABELS = ${JSON.stringify(SOURCE_LABELS)}
var locked = true
var hideTimers = {}

function label(s) { return LABELS[s] || s }
function api(path, init) {
  init = init || {}
  return fetch(path, {
    method: init.method || 'GET',
    headers: Object.assign({ authorization: 'Bearer ' + TOKEN, 'x-mxenv-panel': '1' },
      init.body ? { 'content-type': 'application/json' } : {}),
    body: init.body ? JSON.stringify(init.body) : undefined,
  }).then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j } }) })
}
function say(t, err) { var m = document.getElementById('msg'); m.textContent = t || ''; m.style.color = err ? '#F87171' : '#9CA3AF' }

function renderStatus() {
  var b = document.getElementById('badge')
  b.textContent = locked ? 'Locked' : 'Unlocked'
  b.className = 'badge ' + (locked ? 'locked' : 'unlocked')
  document.getElementById('unlock').disabled = !locked
  document.getElementById('lock').disabled = locked
  var hint = document.getElementById('hint')
  if (!locked) {
    var left = Math.max(0, unlockUntil - Date.now())
    hint.textContent = 'unlocked \\u2014 auto-locks in ' + Math.ceil(left / 60000) + ' min'
  } else { hint.textContent = '' }
  if (locked) document.querySelectorAll('.row-value').forEach(function (r) { r.remove() })
}
var unlockUntil = 0
function pollStatus() {
  return api('/status').then(function (r) {
    if (r.status !== 200) { say('session unavailable (' + r.status + ')', true); return }
    locked = !!r.body.locked
    if (!locked && !unlockUntil) unlockUntil = Date.now() + 15 * 60 * 1000
    if (locked) unlockUntil = 0
    renderStatus()
    if (locked) { for (var k in hideTimers) { clearTimeout(hideTimers[k]); delete hideTimers[k] } }
  })
}

function hideValue(key) {
  var row = document.getElementById('v:' + key)
  if (row) row.remove()
  delete hideTimers[key]
}
function showValue(key, value) {
  hideValue(key)
  var anchor = document.getElementById('k:' + key)
  if (!anchor) return
  var row = document.createElement('tr')
  row.className = 'row-value'; row.id = 'v:' + key
  row.innerHTML = '<td colspan="3"><div class="value-box">' +
    '<span class="value-text"></span>' +
    '<button class="ghost" type="button">copy</button>' +
    '<span class="value-note">hides in 90s or on lock</span></div></td>'
  row.querySelector('.value-text').textContent = value
  row.querySelector('button').onclick = function () {
    navigator.clipboard.writeText(value).then(function () { say('copied ' + key) })
  }
  anchor.after(row)
  hideTimers[key] = setTimeout(function () { hideValue(key) }, 90 * 1000)
}
function reveal(key, source, fileIndex) {
  if (locked) { say('unlock first', true); return }
  api('/reveal', { method: 'POST', body: { key: key, source: source, fileIndex: fileIndex } }).then(function (r) {
    if (r.status === 200) { showValue(r.body.key, r.body.value); say('') }
    else { say(r.body.error || ('reveal failed (' + r.status + ')'), true) }
  })
}
function renderKeys(list) {
  var rows = document.getElementById('rows')
  rows.innerHTML = ''
  document.getElementById('empty').hidden = list.length > 0
  list.forEach(function (k) {
    var tr = document.createElement('tr')
    tr.id = 'k:' + k.key
    tr.innerHTML = '<td class="k"></td><td class="s"></td>' +
      '<td class="a"><button class="ghost" type="button">reveal</button></td>'
    tr.querySelector('td.k').textContent = k.key
    tr.querySelector('td.s').textContent = label(k.source)
    tr.querySelector('button').onclick = function () { reveal(k.key, k.source, k.fileIndex) }
    rows.appendChild(tr)
  })
}
function loadKeys() {
  return api('/keys').then(function (r) {
    if (r.status !== 200) { say('cannot list keys (' + r.status + ')', true); return }
    renderKeys(r.body.keys || [])
  })
}

document.getElementById('unlock').onclick = function () {
  api('/unlock', { method: 'POST' }).then(function (r) {
    if (r.status !== 200) { say(r.body.error || 'unlock failed', true); return }
    unlockUntil = Date.now() + (r.body.windowMs || 900000)
    locked = false; renderStatus(); say('')
  })
}
document.getElementById('lock').onclick = function () {
  api('/lock', { method: 'POST' }).then(function () {
    locked = true; unlockUntil = 0; renderStatus(); say('locked')
  })
}
document.getElementById('refresh').onclick = function () { pollStatus().then(loadKeys) }

document.getElementById('meta').textContent = 'loopback \\u00b7 127.0.0.1:' + location.port
pollStatus().then(loadKeys)
setInterval(function () {
  pollStatus()
  if (!locked && unlockUntil && Date.now() > unlockUntil) { locked = true; unlockUntil = 0 }
  renderStatus()
}, 5000)
</script>
</body>
</html>`
}
