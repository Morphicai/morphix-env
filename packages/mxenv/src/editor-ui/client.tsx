// Client entry: mounts the editor into the empty shell render.tsx emitted,
// reading the state the server inlined. No SSR — React renders entirely in
// the browser; raw-fetch consumers (tests, curl) see the shell plus state
// JSON, interactive users get Radix behavior for free.

import { createRoot } from 'react-dom/client'
import { App } from './App'
import type { EditorUiState } from './types'

declare global {
  interface Window {
    __MX_EDITOR_STATE__?: EditorUiState
  }
}

const container = document.getElementById('root')
const state = window.__MX_EDITOR_STATE__
if (container && state) {
  createRoot(container).render(<App state={state} />)
}
