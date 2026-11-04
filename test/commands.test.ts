import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync, execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const CLI = join(__dirname, '..', 'dist', 'cli.js')
const TMP = join(tmpdir(), `mx-env-commands-${randomUUID()}`)
const HOME = join(TMP, 'home')

function value(label: string): string {
  return `mxenv_test_${label}_${randomUUID().replace(/-/g, '')}`
}

function write(name: string, content: string): string {
  const path = join(TMP, name)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
  return path
}

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync('node', [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env, HOME },
    cwd: TMP,
  })
}

function ok(args: string[], env: Record<string, string> = {}) {
  const result = run(args, env)
  if (result.status !== 0) {
    throw new Error(`mx-env ${args.join(' ')} exited ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`)
  }
  return result
}

function fileMode(path: string): number {
  return statSync(path).mode & 0o777
}

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(HOME, { recursive: true })
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

// ─── mx-env export ────────────────────────────────────────

describe('mx-env export', () => {
  it('emits only eval-able export lines with POSIX-quoted values', () => {
    const expected = `val'ue with spaces`
    write('.env.local', `MXTEST_EXPORT=${expected}\n`)

    const result = ok(['export', '--no-infisical'])
    const lines = result.stdout.trim().split('\n')
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.every((line) => line.startsWith('export MXTEST_'))).toBe(true)
    expect(result.stdout).toContain(`export MXTEST_EXPORT='val'\\''ue with spaces'`)
    expect(result.stdout).not.toContain('profile:')
  })

  it('round-trips through eval in a real shell (script file, value compared not displayed)', () => {
    const expected = value('eval')
    write('.env.local', `MXTEST_EVAL=${expected}\n`)
    const script = write('eval-check.sh', [
      '#!/bin/bash',
      'eval "$(node "$1" export --no-infisical)"',
      'if [ "$MXTEST_EVAL" = "$2" ]; then printf EVAL_OK; else printf EVAL_FAIL; fi',
      '',
    ].join('\n'))

    const out = execFileSync('bash', [script, CLI, expected], {
      encoding: 'utf8',
      env: { ...process.env, HOME },
      cwd: TMP,
    })
    expect(out).toBe('EVAL_OK')
  })

  it('--dry-run reports key names only', () => {
    const expected = value('dry')
    write('.env.local', `MXTEST_EXPORT_DRY=${expected}\n`)

    const result = ok(['export', '--dry-run', '--no-infisical'])
    expect(result.stdout).toContain('MXTEST_EXPORT_DRY')
    expect(result.stdout).not.toContain(expected)
    expect(result.stdout).not.toContain('export ')
  })

  it('writes a value-free audit event', () => {
    const expected = value('audit')
    write('.env.local', `MXTEST_EXPORT_AUDIT=${expected}\n`)
    ok(['export', '--no-infisical'])

    const day = new Date().toISOString().slice(0, 10)
    const audit = readFileSync(join(HOME, '.mx-env', 'audit', `${day}.jsonl`), 'utf8')
    expect(audit).toContain('MXTEST_EXPORT_AUDIT')
    expect(audit).not.toContain(expected)
  })
})

// ─── mx-env render ────────────────────────────────────────

describe('mx-env render', () => {
  it('substitutes ${VAR} and writes the output with mode 0600', () => {
    const expected = value('render')
    write('.env.local', `MXTEST_RENDER=${expected}\n`)
    write('tpl.json', `{"token":"${'${MXTEST_RENDER}'}"}`)

    const result = ok(['render', 'tpl.json', 'out.json', '--no-infisical'])
    expect(readFileSync(join(TMP, 'out.json'), 'utf8')).toBe(`{"token":"${expected}"}`)
    expect(fileMode(join(TMP, 'out.json'))).toBe(0o600)
    expect(result.stdout).toContain('Rendered tpl.json -> out.json')
  })

  it('warns about missing variables before writing and leaves them literal', () => {
    write('.env.local', 'MXTEST_RENDER=here\n')

    const template = `a=${'${MXTEST_RENDER}'} b=${'${MXTEST_ABSENT}'}`
    write('missing.json', template)
    const result = ok(['render', 'missing.json', 'missing-out.json', '--no-infisical'])
    expect(result.stderr).toContain('Missing variables: MXTEST_ABSENT')
    expect(readFileSync(join(TMP, 'missing-out.json'), 'utf8')).toBe('a=here b=${MXTEST_ABSENT}')
  })

  it('--dry-run reports variable status without values and writes nothing', () => {
    const expected = value('renderdry')
    write('.env.local', `MXTEST_RENDER_DRY=${expected}\n`)
    write('dry.json', `{"t":"${'${MXTEST_RENDER_DRY}'}","x":"${'${MXTEST_ABSENT}'}"}`)

    const result = ok(['render', 'dry.json', 'dry-out.json', '--dry-run', '--no-infisical'])
    expect(result.stdout).toContain('MXTEST_RENDER_DRY: resolved')
    expect(result.stdout).toContain('MXTEST_ABSENT: missing')
    expect(result.stdout).not.toContain(expected)
    expect(existsSync(join(TMP, 'dry-out.json'))).toBe(false)
  })

  it('requires both positional arguments', () => {
    const result = run(['render', 'only-template.json', '--no-infisical'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Usage: mx-env render')
  })
})

// ─── mx-env inject ────────────────────────────────────────

describe('mx-env inject', () => {
  function writeConfig(): void {
    write('inject-base.env', `MXTEST_INJECT=${value('inject')}\n`)
    write('mx-env.config.json', JSON.stringify({
      sources: { base: { provider: 'local', files: ['inject-base.env'] } },
      profiles: { dev: { sources: ['base'] } },
      defaultProfile: 'dev',
    }))
  }

  it('resolves mx-env:// references into the output file with mode 0600', () => {
    writeConfig()
    const expected = readFileSync(join(TMP, 'inject-base.env'), 'utf8').trim().split('=')[1]
    write('mcp.tpl.json', JSON.stringify({
      mcpServers: { x: { env: { API: 'mx-env://dev/MXTEST_INJECT', MISSING: 'mx-env://dev/NOPE' } } },
    }))

    const result = ok(['inject', 'mcp.tpl.json', 'mcp.json', '--no-infisical'])
    const output = readFileSync(join(TMP, 'mcp.json'), 'utf8')
    expect(output).toContain(expected)
    expect(output).toContain('mx-env://dev/NOPE')
    expect(output).not.toContain('mx-env://dev/MXTEST_INJECT')
    expect(fileMode(join(TMP, 'mcp.json'))).toBe(0o600)
    expect(result.stderr).toContain('Unresolved mx-env://dev/NOPE reference')
    expect(result.stdout).toContain('Injected mcp.tpl.json -> mcp.json (2 references, 1 unresolved)')
  })

  it('--dry-run lists reference status without values or output', () => {
    writeConfig()
    write('mcp.tpl.json', '{"api":"mx-env://dev/MXTEST_INJECT","missing":"mx-env://dev/NOPE"}')

    const result = ok(['inject', 'mcp.tpl.json', 'dry.json', '--dry-run', '--no-infisical'])
    expect(result.stdout).toContain('dev/MXTEST_INJECT: resolved')
    expect(result.stdout).toContain('dev/NOPE: missing')
    expect(result.stdout).not.toMatch(/mxenv_test_/)
    expect(existsSync(join(TMP, 'dry.json'))).toBe(false)
  })

  it('requires both positional arguments', () => {
    const result = run(['inject', '--no-infisical'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Usage: mx-env inject')
  })
})

// ─── mx-env run with references and --dry-run ─────────────

describe('mx-env run references and dry-run', () => {
  it('resolves mx-env:// values before spawn (verified by comparison, never echoed)', () => {
    const expected = value('runref')
    write('base.env', `MXTEST_DIRECT=${expected}\n`)
    write('ref.env', 'MXTEST_INDIRECT=mx-env://dev/MXTEST_DIRECT\n')
    write('mx-env.config.json', JSON.stringify({
      sources: {
        base: { provider: 'local', files: ['base.env'] },
        refs: { provider: 'local', files: ['ref.env'] },
      },
      profiles: { dev: { sources: ['base', 'refs'] } },
      defaultProfile: 'dev',
    }))

    const result = ok([
      'run', '--no-infisical', '--', 'node', '-e',
      'console.log(process.env.MXTEST_INDIRECT === process.env.MXTEST_DIRECT ? "REF_MATCH" : "REF_MISMATCH")',
    ])
    expect(result.stdout).toContain('REF_MATCH')
    expect(result.stdout).not.toContain('REF_MISMATCH')
    expect(result.stdout).not.toContain(expected)
  })

  it('--dry-run reports key names and never executes the command', () => {
    const expected = value('rundry')
    write('.env.local', `MXTEST_RUN_DRY=${expected}\n`)

    const result = ok(['run', '--dry-run', '--no-infisical', '--', 'node', '-e', 'console.log("DRY_SHOULD_NOT_RUN")'])
    expect(result.stdout).toContain('MXTEST_RUN_DRY')
    expect(result.stdout).not.toContain(expected)
    expect(result.stdout).not.toContain('DRY_SHOULD_NOT_RUN')
  })
})

// ─── help ─────────────────────────────────────────────────

describe('help', () => {
  it('lists the new commands and --dry-run', () => {
    const result = ok(['--help'])
    expect(result.stdout).toContain('mx-env export')
    expect(result.stdout).toContain('mx-env render <template> <output>')
    expect(result.stdout).toContain('mx-env inject <template> <output>')
    expect(result.stdout).toContain('--dry-run')
  })
})
