import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { delimiter, join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const CLI = join(__dirname, '..', 'dist', 'cli.js')
const ROOT = join(tmpdir(), `mxenv-plugin-${randomUUID()}`)
const PLUGIN_DIR = join(ROOT, 'bin')
const HOME = join(ROOT, 'home')

const PLUGIN_SCRIPT = `#!/bin/sh
case "$1" in
  MXTEST_PLUGIN_A) printf 'alpha-value' ;;
  MXTEST_PLUGIN_B) printf 'beta-value\\n' ;;
  MXTEST_PLUGIN_CRLF) printf 'crlf-value\\r\\n' ;;
  MXTEST_PLUGIN_FAIL) printf 'plugin-stderr-must-not-leak' >&2; exit 7 ;;
  *) printf 'unexpected-key' >&2; exit 9 ;;
esac
`

function write(name: string, content: string, mode?: number): string {
  const path = join(ROOT, name)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
  if (mode !== undefined) chmodSync(path, mode)
  return path
}

function pluginPathEnv(): Record<string, string> {
  return { ...process.env, PATH: `${PLUGIN_DIR}${delimiter}${process.env.PATH || ''}` }
}

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true })
  mkdirSync(PLUGIN_DIR, { recursive: true })
  mkdirSync(HOME, { recursive: true })
  write('bin/mxenv-provider-fake', PLUGIN_SCRIPT, 0o755)
})

afterEach(() => {
  rmSync(ROOT, { recursive: true, force: true })
})

describe('plugin source through the CLI', () => {
  it('composes plugin values into a run and reports provenance as plugin', () => {
    write('mxenv.config.json', JSON.stringify({
      sources: { vault: { provider: 'plugin', plugin: 'fake', keys: ['MXTEST_PLUGIN_A'] } },
      profiles: { dev: { sources: ['vault'] } },
      defaultProfile: 'dev',
    }))
    const env = pluginPathEnv()
    env.HOME = HOME

    const inspect = spawnSync('node', [CLI, 'inspect', '--no-infisical'], { encoding: 'utf8', env, cwd: ROOT })
    expect(inspect.status).toBe(0)
    expect(inspect.stdout).toContain('MXTEST_PLUGIN_A — vault (plugin)')

    const child = write('check.js', `
      console.log(process.env.MXTEST_PLUGIN_A === 'alpha-value' ? 'PLUGIN_MATCH' : 'PLUGIN_MISMATCH')
    `)
    const runResult = spawnSync('node', [CLI, 'run', '--no-infisical', '--', 'node', child], { encoding: 'utf8', env, cwd: ROOT })
    expect(runResult.status).toBe(0)
    expect(runResult.stdout).toContain('PLUGIN_MATCH')
    expect(runResult.stdout).not.toContain('PLUGIN_MISMATCH')
  }, 20_000)
})
