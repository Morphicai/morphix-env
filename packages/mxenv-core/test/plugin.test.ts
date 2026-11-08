import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { delimiter, join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { loadSource, SourceError, type SourceEntry } from '../src/sources'
import { validateConfig, type PluginSource } from '../src/config'

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

function entry(source: PluginSource): SourceEntry {
  return { name: 'fake', source, baseDir: ROOT }
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

describe('plugin source adapter', () => {
  it('invokes mxenv-provider-<name> per key and strips one trailing line ending', async () => {
    // First execution of a freshly created executable costs ~2s in this
    // environment (OS scan); combined with full-suite load the default 5s
    // is not enough for three real spawns.
    const loaded = await loadSource(
      entry({ provider: 'plugin', plugin: 'fake', keys: ['MXTEST_PLUGIN_A', 'MXTEST_PLUGIN_B', 'MXTEST_PLUGIN_CRLF'] }),
      { homeDir: ROOT, environment: pluginPathEnv() },
    )
    expect(loaded.provider).toBe('plugin')
    expect(loaded.availability).toBe('loaded')
    expect(loaded.values).toEqual({
      MXTEST_PLUGIN_A: 'alpha-value',
      MXTEST_PLUGIN_B: 'beta-value',
      MXTEST_PLUGIN_CRLF: 'crlf-value',
    })
  }, 20_000)

  it('fails value-free when the plugin exits non-zero (stderr never surfaces)', async () => {
    await expect(loadSource(
      entry({ provider: 'plugin', plugin: 'fake', keys: ['MXTEST_PLUGIN_FAIL'] }),
      { homeDir: ROOT, environment: pluginPathEnv() },
    )).rejects.toThrow(SourceError)

    try {
      await loadSource(
        entry({ provider: 'plugin', plugin: 'fake', keys: ['MXTEST_PLUGIN_FAIL'] }),
        { homeDir: ROOT, environment: pluginPathEnv() },
      )
      expect.unreachable()
    } catch (error: any) {
      expect(error.message).toContain('MXTEST_PLUGIN_FAIL')
      expect(error.message).toContain('exit 7')
      expect(error.message).not.toContain('plugin-stderr-must-not-leak')
    }
  }, 20_000)

  it('reports a missing executable, or skips it when optional', async () => {
    try {
      await loadSource(
        entry({ provider: 'plugin', plugin: 'absent', keys: ['MXTEST_PLUGIN_A'] }),
        { homeDir: ROOT, environment: pluginPathEnv() },
      )
      expect.unreachable()
    } catch (error: any) {
      expect(error).toBeInstanceOf(SourceError)
      expect(error.message).toContain('mxenv-provider-absent on PATH')
      expect(error.message).not.toContain('mx-env-provider')  // 垫片移除：不再提示旧名回退
    }

    const optional = await loadSource(
      entry({ provider: 'plugin', plugin: 'absent', keys: ['MXTEST_PLUGIN_A'], optional: true }),
      { homeDir: ROOT, environment: pluginPathEnv() },
    )
    expect(optional.availability).toBe('missing-optional')
    expect(optional.values).toEqual({})
  })

  it('仅旧名 mx-env-provider-* 存在时不回退（垫片移除）', async () => {
    write('bin/mx-env-provider-fallback', '#!/bin/sh\necho legacy-ok\n', 0o755)
    await expect(loadSource(
      entry({ provider: 'plugin', plugin: 'fallback', keys: ['MXTEST_PLUGIN_A'] }),
      { homeDir: ROOT, environment: pluginPathEnv() },
    )).rejects.toMatchObject({ message: expect.stringContaining('mxenv-provider-fallback on PATH') })
  }, 20_000)

  it('新名唯一生效：旧名文件存在与否不影响新名解析', async () => {
    write('bin/mxenv-provider-both', '#!/bin/sh\necho new-name-wins\n', 0o755)
    write('bin/mx-env-provider-both', '#!/bin/sh\necho legacy-loses\n', 0o755)
    const loaded = await loadSource(
      entry({ provider: 'plugin', plugin: 'both', keys: ['MXTEST_PLUGIN_A'] }),
      { homeDir: ROOT, environment: pluginPathEnv() },
    )
    expect(loaded.values).toEqual({ MXTEST_PLUGIN_A: 'new-name-wins' })
  }, 20_000)
})

describe('plugin config validation', () => {
  it('accepts a wired plugin source', () => {
    expect(validateConfig({
      sources: { vault: { provider: 'plugin', plugin: 'bitwarden', keys: ['OPENAI_API_KEY'] } },
    })).toEqual([])
  })

  it('rejects missing plugin names, unsafe names, and empty key lists', () => {
    const problems = validateConfig({
      sources: {
        a: { provider: 'plugin', plugin: '', keys: ['K'] },
        b: { provider: 'plugin', plugin: '../evil', keys: ['K'] },
        c: { provider: 'plugin', plugin: 'ok', keys: [] },
      },
    })
    expect(problems).toHaveLength(3)
    expect(problems[0]).toContain('needs a plugin name')
    expect(problems[1]).toContain('needs a plugin name')
    expect(problems[2]).toContain('needs at least one key')
  })
})
