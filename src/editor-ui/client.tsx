// Client entry: hydrates the server-rendered editor markup with the same
// state the server used, so raw-fetch consumers (tests, curl) still see full
// HTML while interactive users get Radix behavior for free.

import { hydrateRoot } from 'react-dom/client'
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
  hydrateRoot(container, <App state={state} />)
}
