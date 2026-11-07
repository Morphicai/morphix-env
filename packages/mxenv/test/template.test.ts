import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import {
  findTemplateAnomalies,
  findTemplateVariables,
  gitOutputStatus,
  isShellIdentifier,
  renderTemplate,
  shellQuote,
  warnOutputGitRisk,
  writePrivateFile,
} from '../src/template'

const ROOT = join(tmpdir(), `mxenv-template-${randomUUID()}`)

function file(name: string): string {
  return join(ROOT, name)
}

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

afterEach(() => {
  vi.restoreAllMocks()
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true })
})

describe('shellQuote', () => {
  it('single-quotes every value and escapes embedded quotes', () => {
    expect(shellQuote('simple')).toBe("'simple'")
    expect(shellQuote('')).toBe("''")
    expect(shellQuote('a b$c`d')).toBe("'a b$c`d'")
    expect(shellQuote("it's")).toBe("'it'\\''s'")
    expect(shellQuote("two 'quotes'")).toBe("'two '\\''quotes'\\'''")
    expect(shellQuote('line1\nline2')).toBe("'line1\nline2'")
  })
})

describe('isShellIdentifier', () => {
  it('accepts POSIX identifiers and rejects dotenv-legal but shell-illegal keys', () => {
    expect(isShellIdentifier('MX_OK')).toBe(true)
    expect(isShellIdentifier('_x1')).toBe(true)
    expect(isShellIdentifier('FOO-BAR')).toBe(false)
    expect(isShellIdentifier('1LEAD')).toBe(false)
    expect(isShellIdentifier('A B')).toBe(false)
    expect(isShellIdentifier('')).toBe(false)
  })
})

describe('findTemplateAnomalies', () => {
  it('stays silent on clean templates', () => {
    expect(findTemplateAnomalies('plain ${VAR} and ${OTHER} here')).toEqual([])
  })

  it('flags modifiers/defaults, escaped dollars, and unclosed constructs', () => {
    const modifiers = findTemplateAnomalies('a=${VAR:-fallback}')
    expect(modifiers).toHaveLength(1)
    expect(modifiers[0]).toContain('modifier or default')

    const dollars = findTemplateAnomalies('pid=$$')
    expect(dollars).toHaveLength(1)
    expect(dollars[0]).toContain('Escaped dollar $$')

    const unclosed = findTemplateAnomalies('open=${ never closed')
    expect(unclosed).toHaveLength(1)
    expect(unclosed[0]).toContain('Unclosed or invalid ${')
  })

  it('does not double-flag a modifier as unclosed', () => {
    expect(findTemplateAnomalies('${V:-x} ${W=1} ${U+}')).toHaveLength(3)
  })
})

describe('renderTemplate', () => {
  it('finds unique variable names in declaration order', () => {
    expect(findTemplateVariables('${B} and ${A} again ${B}')).toEqual(['B', 'A'])
    expect(findTemplateVariables('no vars $B ${1bad}')).toEqual([])
  })

  it('substitutes values and reports unresolved names left literal', () => {
    const { output, missing } = renderTemplate(
      'a=${KNOWN} b=${UNKNOWN} c=${KNOWN}',
      { KNOWN: 'value', OTHER: 'x' },
    )
    expect(output).toBe('a=value b=${UNKNOWN} c=value')
    expect(missing).toEqual(['UNKNOWN'])
  })

  it('does not re-substitute inside an inserted value', () => {
    const { output, missing } = renderTemplate('x=${OUTER}', { OUTER: '${INNER}', INNER: 'nope' })
    expect(output).toBe('x=${INNER}')
    expect(missing).toEqual([])
  })
})

describe('writePrivateFile', () => {
  it('writes mode 0600 and forces 0600 when overwriting an existing file', () => {
    const target = file('out/private.json')
    writePrivateFile(target, 'content')
    expect(statSync(target).mode & 0o777).toBe(0o600)

    chmodSync(target, 0o644)
    writePrivateFile(target, 'content2')
    expect(statSync(target).mode & 0o777).toBe(0o600)
    expect(readFileSync(target, 'utf8')).toBe('content2')
  })
})

describe('git output status', () => {
  function repo(): string {
    const dir = file('repo')
    mkdirSync(dir, { recursive: true })
    git(['init', '-q'], dir)
    git(['config', 'user.name', 'test'], dir)
    git(['config', 'user.email', 'test@example.invalid'], dir)
    return dir
  }

  it('classifies tracked, ignored, untracked, and outside-repo outputs', () => {
    const dir = repo()

    writeFileSync(join(dir, 'tracked.json'), '{}')
    git(['add', 'tracked.json'], dir)
    git(['commit', '-q', '-m', 'seed'], dir)
    expect(gitOutputStatus(join(dir, 'tracked.json'))).toBe('tracked')

    writeFileSync(join(dir, '.gitignore'), 'ignored.json\n')
    expect(gitOutputStatus(join(dir, 'ignored.json'))).toBe('ignored')

    writeFileSync(join(dir, 'plain.json'), '{}')
    expect(gitOutputStatus(join(dir, 'plain.json'))).toBe('untracked')

    expect(gitOutputStatus(file('outside.json'))).toBe('outside-repo')
  })

  it('warns only for tracked or not-ignored outputs, with no content', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const dir = repo()

    writeFileSync(join(dir, 'tracked.json'), '{}')
    git(['add', 'tracked.json'], dir)
    git(['commit', '-q', '-m', 'seed'], dir)
    writeFileSync(join(dir, '.gitignore'), 'ignored.json\n')

    warnOutputGitRisk(join(dir, 'tracked.json'))
    warnOutputGitRisk(join(dir, 'ignored.json'))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('tracked by git')
    expect(warn.mock.calls[0][0]).not.toContain('{}')
  })
})
