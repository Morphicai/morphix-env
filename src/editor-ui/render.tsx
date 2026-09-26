// Server-side renderer: produces the complete editor page as one HTML string.
// Everything (CSS, client JS, state, favicon) is inlined — the editor makes
// zero external requests even though it looks like a modern React app.

import { renderToString } from 'react-dom/server'
import { App } from './App'
import { EDITOR_CLIENT_CSS, EDITOR_CLIENT_JS } from './generated/clientAssets'
import type { EditorUiState } from './types'

const FAVICON_HREF =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23005EFF'/%3E%3Ctext x='16' y='22' font-family='-apple-system,Segoe UI,sans-serif' font-size='13' font-weight='700' fill='%23FFFFFF' text-anchor='middle'%3Emx%3C/text%3E%3C/svg%3E"

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// U+2028/U+2029 are valid JS line terminators but not escaped by JSON.stringify,
// so they must never appear literally inside an inlined <script>.
const LINE_SEPARATOR = String.fromCharCode(0x2028)
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)

/** JSON that is safe to inline into a <script> tag (no `</script>`, no LS/PS). */
function safeStateJson(state: EditorUiState): string {
  return JSON.stringify(state)
    .replace(/</g, '\\u003c')
    .split(LINE_SEPARATOR)
    .join('\\u2028')
    .split(PARAGRAPH_SEPARATOR)
    .join('\\u2029')
}

/** A minified bundle cannot contain `</script` after this; `\/` is a no-op escape in JS strings. */
function safeScriptBody(js: string): string {
  return js.replace(/<\/script/gi, '<\\/script')
}

export function renderEditorHtml(title: string, state: EditorUiState): string {
  const appHtml = renderToString(<App state={state} />)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(title)}</title>
<link rel="icon" href="${FAVICON_HREF}" />
<style>${EDITOR_CLIENT_CSS}</style>
</head>
<body>
<div id="root">${appHtml}</div>
<script>window.__MX_EDITOR_STATE__=${safeStateJson(state)};</script>
<script>${safeScriptBody(EDITOR_CLIENT_JS)}</script>
</body>
</html>`
}
