// N-2: escaping unit tests on the renderEditorHtml public surface. The page
// inlines the state JSON and the client bundle into <script> bodies, so state
// values must never break out of script context — no bare `</script`, no `<!--`,
// no literal U+2028/U+2029 (JS line terminators JSON.stringify leaves raw) —
// while parsing the state back must return the exact same values (verbatim,
// including the hostile characters themselves).

import { describe, expect, it } from 'vitest'
import { renderEditorHtml } from '../src/editor-ui/render'
import type { EditorUiState } from '../src/editor-ui/types'
import { extractEditorState, extractInlineScripts } from './support/editorPage'

const LINE_SEPARATOR = String.fromCharCode(0x2028)
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)

function dotenvxStateWithRevealed(value: string): EditorUiState {
  return {
    token: 'tok-render',
    profileName: 'test',
    version: '0.0.0-test',
    sources: [{ name: 'enc', provider: 'dotenvx' }],
    page: 'dotenvx',
    sourceName: 'enc',
    files: ['enc.env'],
    fileIndex: 0,
    keyNames: ['MXTEST_EVIL'],
    revealed: { key: 'MXTEST_EVIL', value },
  }
}

const HOSTILE_VALUES: Array<{ label: string; value: string }> = [
  { label: 'script-close tag', value: '</script><script>alert(1)</script>' },
  { label: 'case-variant script close', value: '</ScRiPt>' },
  { label: 'html comment open', value: '<!--x-->' },
  { label: 'double quote', value: 'a"b' },
  { label: 'newline', value: 'line1\nline2' },
  { label: 'carriage return newline', value: 'line1\r\nline2' },
  { label: 'U+2028 line separator', value: `a${LINE_SEPARATOR}b` },
  { label: 'U+2029 paragraph separator', value: `a${PARAGRAPH_SEPARATOR}b` },
  {
    label: 'combined breakout shapes',
    value: `"</script><!--${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}\r\n<\\/script`,
  },
]

describe('renderEditorHtml state inlining is script-safe (N-2)', () => {
  for (const { label, value } of HOSTILE_VALUES) {
    it(`state value with ${label} cannot break out of the state script`, () => {
      const state = dotenvxStateWithRevealed(value)
      const html = renderEditorHtml('mxenv editor', state)
      const { state: stateBody } = extractInlineScripts(html)

      // No bare script closer or comment opener may appear inside the state
      // script body (a `</script` would close the tag early; `<!--` would put
      // the tokenizer into script-data-escaped state).
      expect(stateBody).not.toMatch(/<\/script/i)
      expect(stateBody).not.toContain('<!--')
      // U+2028/U+2029 must not appear literally — they terminate JS lines.
      expect(stateBody).not.toContain(LINE_SEPARATOR)
      expect(stateBody).not.toContain(PARAGRAPH_SEPARATOR)
    })

    it(`state value with ${label} round-trips verbatim through the inlined state`, () => {
      const state = dotenvxStateWithRevealed(value)
      const html = renderEditorHtml('mxenv editor', state)
      // 解析回等值：读出的 state 与写入的 state 完全一致（敌意字符以本体
      // 形式驻留值中，只是不能驻留在脚本字面里）。
      expect(extractEditorState(html)).toEqual(state)
    })
  }

  it('the page carries exactly the two structural </script> closers', () => {
    const html = renderEditorHtml('mxenv editor', dotenvxStateWithRevealed('</script>'))
    const closers = html.match(/<\/script/gi) ?? []
    expect(closers).toHaveLength(2)
  })

  it('the client bundle body contains no bare </script (safeScriptBody contract)', () => {
    const html = renderEditorHtml('mxenv editor', dotenvxStateWithRevealed('x'))
    const { bundle } = extractInlineScripts(html)
    expect(bundle).not.toMatch(/<\/script/i)
  })

  it('escapes markup characters in the title', () => {
    const html = renderEditorHtml('<b>&"x"', dotenvxStateWithRevealed('x'))
    expect(html).toContain('<title>&lt;b&gt;&amp;&quot;x&quot;</title>')
    expect(html).not.toContain('<title><b>')
  })
})
