import { panelBundleHash, panelJsIntegrity } from './panel-ui/generated/clientAssets'

// HTML contains no token, key names, values, or serialized API state. The React
// bundle derives the session token from the current path and talks to the same
// loopback host. Hashed subresources allow a strict script/style CSP.
export function panelPage(): string {
  return `<!doctype html>
<html lang="en" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<meta name="referrer" content="no-referrer">
<meta name="mxenv-bundle" content="${panelBundleHash}">
<title>mxenv panel</title>
<link rel="stylesheet" href="./panel-${panelBundleHash}.css">
<script defer src="./panel-${panelBundleHash}.js" integrity="${panelJsIntegrity}" crossorigin="anonymous"></script>
</head>
<body>
<div id="root"><noscript>JavaScript is required to use the local mxenv panel.</noscript></div>
</body>
</html>`
}

// 无 token 直接访问（GET /）的引导页：纯静态、零会话信息（不回显是否存在会话/键名）。
export function panelLandingPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<meta name="referrer" content="no-referrer">
<title>mxenv panel</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0 0 64px; background: #111827; color: #F9FAFB; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 1.6; }
  .wrap { max-width: 640px; margin: 0 auto; padding: 0 24px; }
  header { display: flex; align-items: baseline; gap: 12px; padding: 56px 0 6px; }
  .brand { font-size: 30px; font-weight: 700; letter-spacing: -0.02em; }
  .brand i { font-style: normal; color: #79E2C3; }
  .sub { color: #9CA3AF; font-size: 15px; }
  h1 { font-size: 19px; font-weight: 600; margin: 28px 0 8px; }
  p { color: #D1D5DB; margin: 8px 0; }
  code { font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 13px; background: #0D1420; color: #79E2C3; padding: 2px 7px; border-radius: 6px; }
  .entry { display: flex; gap: 10px; margin: 18px 0 6px; }
  input { flex: 1; font: 13.5px ui-monospace, 'SF Mono', Menlo, monospace; background: #0D1420; color: #F9FAFB; border: 1px solid #1F2937; border-radius: 8px; padding: 9px 12px; outline: none; }
  input:focus { border-color: #79E2C3; }
  button { font: inherit; border: 0; border-radius: 8px; padding: 9px 20px; cursor: pointer; background: #79E2C3; color: #064E3B; font-weight: 600; }
  button:hover { background: #8EEAD0; }
  .msg { color: #F87171; font-size: 13px; min-height: 20px; margin: 4px 0 0; }
  footer { margin-top: 40px; color: #6B7280; font-size: 12.5px; line-height: 1.7; }
</style>
</head>
<body>
<div class="wrap">
  <header><span class="brand">mxenv<i>.</i></span><span class="sub">panel host</span></header>
  <h1>This host serves the mxenv panel at a per-session token URL.</h1>
  <p>The easiest way in is to let mxenv open it for you:</p>
  <p><code>mxenv gui</code> &nbsp;—&nbsp; attach to the running session and open the panel in your browser</p>
  <p><code>mxenv gui status</code> &nbsp;—&nbsp; show the session (port, lock state)</p>
  <p>Or paste the panel URL (or just its token) and go:</p>
  <div class="entry"><input id="token" type="text" spellcheck="false" autocomplete="off" placeholder="http://127.0.0.1:…/… or the token itself" autofocus><button id="go" type="button">Go</button></div>
  <p class="msg" id="msg"></p>
  <footer>The token is random per host session and never leaves this machine — the host binds to loopback only. Values are shown one key at a time, inside an explicit unlock window, and every reveal is audited.</footer>
</div>
<script>
'use strict'
function go() {
  var raw = document.getElementById('token').value.trim()
  var m = raw.match(/([A-Za-z0-9_-]{16,})\/?$/)
  if (!m) { document.getElementById('msg').textContent = 'that does not look like a panel URL or token'; return }
  location.href = '/' + m[1]
}
document.getElementById('go').onclick = go
document.getElementById('token').addEventListener('keydown', function (e) { if (e.key === 'Enter') go() })
</script>
</body>
</html>`
}
