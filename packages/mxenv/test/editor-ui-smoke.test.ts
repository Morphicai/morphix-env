// @vitest-environment happy-dom
// N-1/N-4: client-mount smoke on the real CSR pipeline. Each test renders the
// page through `renderEditorHtml`, executes BOTH inlined script bodies (state
// JSON first, then the actual EDITOR_CLIENT_JS bundle) inside a happy-dom
// window, and asserts the resulting DOM — so a stale bundle, a broken mount
// target, or a bad state→prop handoff turns these red. N-4 (Saved page return
// href carries fileIndex) rides on the saved variant.

import { describe, expect, it } from 'vitest'
import { renderEditorHtml } from '../src/editor-ui/render'
import type { EditorUiState } from '../src/editor-ui/types'
import { extractInlineScripts } from './support/editorPage'

const BASE = {
  token: 'tok-smoke',
  profileName: 'smoke-profile',
  sources: [{ name: 'enc', provider: 'dotenvx' }],
}

const PROFILE_STATE: EditorUiState = {
  ...BASE,
  page: 'profile',
  sourceStatuses: [{ name: 'enc', provider: 'dotenvx', availability: 'ok', keyCount: 2, editable: true }],
  provenance: [],
}

const DOTENVX_REVEALED_STATE: EditorUiState = {
  ...BASE,
  page: 'dotenvx',
  sourceName: 'enc',
  files: ['enc.env'],
  fileIndex: 0,
  keyNames: ['MXTEST_SMOKE'],
  formKey: 'MXTEST_PREFILL',
  revealed: { key: 'MXTEST_SMOKE', value: 'sentinel-smoke-reveal' },
}

const SAVED_STATE: EditorUiState = {
  ...BASE,
  page: 'saved',
  sourceName: 'enc',
  action: 'set',
  key: 'MXTEST_SMOKE',
  fileIndex: 0,
}

/**
 * Load a rendered page into the live happy-dom document and run its inline
 * scripts in document order. happy-dom parses `<script>` bodies on write but
 * never evaluates them, so evaluation is explicit — which is exactly what
 * makes this a bundle-freshness test: the executed code is the same
 * EDITOR_CLIENT_JS the product inlines.
 */
function mountRenderedPage(html: string): void {
  document.open()
  document.write(html)
  document.close()
  const { state, bundle } = extractInlineScripts(html)
  // The extracted state body is the bare JSON literal plus ';'; reattach the
  // assignment exactly as the page spells it before evaluating.
  window.eval(`window.__MX_EDITOR_STATE__=${state}`)
  window.eval(bundle)
}

/** React commits its first render asynchronously; poll rather than assume. */
async function waitFor<T>(probe: () => T | null | undefined | false, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const hit = probe()
    if (hit) return hit
    if (Date.now() >= deadline) throw new Error('timed out waiting for the client to render')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function renderedElement(selector: string): Promise<Element> {
  return waitFor(() => document.querySelector(selector))
}

describe('editor client bundle mounts and renders real state (N-1)', () => {
  it('profile page renders profile identity and source navigation', async () => {
    mountRenderedPage(renderEditorHtml('mx-env editor', PROFILE_STATE))

    const profileName = await renderedElement('.profile-name')
    expect(profileName.textContent).toBe('smoke-profile')
    expect(document.querySelector('.src-name')?.textContent).toBe('enc')
    expect(document.querySelectorAll('.source-chip').length).toBeGreaterThan(0)
  })

  it('dotenvx page pre-fills the key form and shows the revealed value verbatim', async () => {
    mountRenderedPage(renderEditorHtml('mx-env editor', DOTENVX_REVEALED_STATE))

    const keyInput = await renderedElement('input.input[name="key"]')
    expect((keyInput as HTMLInputElement).value).toBe('MXTEST_PREFILL')

    const revealed = await renderedElement('code.revealed-value')
    expect(revealed.textContent).toBe('sentinel-smoke-reveal')
  })

  it('saved page returns to the saved file via fileIndex (N-4)', async () => {
    mountRenderedPage(renderEditorHtml('mx-env editor', SAVED_STATE))

    const backLink = await renderedElement('a.btn.btn-primary')
    expect(backLink.getAttribute('href')).toContain('?fileIndex=0')
    expect(backLink.textContent).toContain('Continue editing')
  })
})
