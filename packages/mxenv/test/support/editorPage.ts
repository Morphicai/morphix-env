// Test-side helpers for asserting against the CSR editor page (N-2/N-3):
// extract the inlined state script and the client bundle from the rendered
// HTML without depending on raw-substring spellings of JSON-escaped payloads.
// Test-only — the product surface stays `renderEditorHtml` alone.

import type { EditorUiState } from '../../src/editor-ui/types'

const STATE_MARKER = '<script>window.__MX_EDITOR_STATE__='
const SCRIPT_OPEN = '<script>'
const SCRIPT_CLOSE = '</script>'

/**
 * Split the rendered page into its two inline script bodies (state JSON and
 * client bundle). Anchored extraction rather than a global `<script>` regex,
 * because the minified bundle may contain a literal `<script>` string, and a
 * `</script>` injected into the state would truncate a lazy match early —
 * exactly the shape N-2 exists to catch.
 */
export function extractInlineScripts(html: string): { state: string; bundle: string } {
  const stateStart = html.indexOf(STATE_MARKER)
  if (stateStart < 0) throw new Error('rendered page has no inline editor state script')
  const stateBodyStart = stateStart + STATE_MARKER.length
  const stateClose = html.indexOf(';' + SCRIPT_CLOSE, stateBodyStart)
  if (stateClose < 0) throw new Error('editor state script is not terminated')
  const state = html.slice(stateBodyStart, stateClose + 1) // includes trailing ';'

  const bundleOpen = html.indexOf(SCRIPT_OPEN, stateClose + (';' + SCRIPT_CLOSE).length)
  if (bundleOpen < 0) throw new Error('rendered page has no inline client bundle')
  const bundleClose = html.indexOf(SCRIPT_CLOSE, bundleOpen + SCRIPT_OPEN.length)
  if (bundleClose < 0) throw new Error('inline client bundle is not terminated')
  const bundle = html.slice(bundleOpen + SCRIPT_OPEN.length, bundleClose)

  return { state, bundle }
}

/** Parse the inlined `window.__MX_EDITOR_STATE__` payload back to its object. */
export function extractEditorState(html: string): EditorUiState {
  const { state } = extractInlineScripts(html)
  const json = state.endsWith(';') ? state.slice(0, -1) : state
  return JSON.parse(json) as EditorUiState
}

/**
 * Parse the state and narrow it to one page variant. Throws when the page
 * is a different variant so field assertions can't pass vacuously against
 * the wrong page's shape.
 */
export function stateOnPage<P extends EditorUiState['page']>(
  html: string,
  page: P,
): Extract<EditorUiState, { page: P }> {
  const state = extractEditorState(html)
  if (state.page !== page) throw new Error(`expected "${page}" page state, got "${state.page}"`)
  return state as Extract<EditorUiState, { page: P }>
}

/**
 * The single revealed value carried by a reveal response (dotenvx/keychain
 * pages). Throws instead of returning undefined so negative assertions can't
 * pass vacuously when the reveal silently dropped.
 */
export function revealedValue(html: string): string {
  const state = extractEditorState(html)
  if (state.page === 'dotenvx' || state.page === 'keychain') {
    if (!state.revealed) throw new Error(`state page "${state.page}" carries no revealed value`)
    return state.revealed.value
  }
  throw new Error(`expected a reveal-capable page, got "${state.page}"`)
}
