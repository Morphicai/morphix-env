import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { loadSource } from '../src/sources'

const ROOT = join(tmpdir(), `mx-env-dotenvx-${randomUUID()}`)
const dotenvx = join(process.cwd(), 'node_modules', '.bin', 'dotenvx')

afterEach(() => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true })
})

describe('dotenvx source integration', () => {
  it('decrypts a temporary encrypted fixture in memory without creating plaintext output', async () => {
    mkdirSync(ROOT, { recursive: true })
    const sentinel = `mxenv_test_dotenvx_${randomUUID().replace(/-/g, '')}`
    const file = join(ROOT, 'encrypted.env')
    // Pin the file model: without DOTENVX_NO_NATIVE, dotenvx 2.x on macOS
    // custodies the private key in the OS keychain and every test run leaks an
    // orphaned entry there.
    execFileSync(dotenvx, ['set', 'MXTEST_DOTENVX_REAL', sentinel, '-f', file], {
      cwd: ROOT,
      stdio: 'ignore',
      env: { ...process.env, DOTENVX_NO_NATIVE: 'true' },
    })

    const loaded = await loadSource({
      name: 'encrypted',
      source: { provider: 'dotenvx', files: ['encrypted.env'] },
      baseDir: ROOT,
    }, { homeDir: ROOT, environment: { ...process.env } })

    expect(loaded.values.MXTEST_DOTENVX_REAL).toBe(sentinel)
    expect(readFileSync(file, 'utf8')).not.toContain(sentinel)
    expect(existsSync(join(ROOT, 'plaintext.env'))).toBe(false)
  }, 15_000)
})
