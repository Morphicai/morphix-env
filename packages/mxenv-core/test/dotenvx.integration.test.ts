import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { loadSource } from '../src/sources'
import { composeEnvironment } from '../src/composition'
import { loadConfigLayers } from '../src/config'

const ROOT = join(tmpdir(), `mxenv-dotenvx-${randomUUID()}`)
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

describe('dotenv-parity default discovery', () => {
  it('routes an encrypted .env through the dotenvx provider and keeps plaintext .env.local above it', async () => {
    const home = join(ROOT, 'home')
    const project = join(ROOT, 'project')
    mkdirSync(home, { recursive: true })
    mkdirSync(project, { recursive: true })
    const sentinel = `mxenv_test_dotenvx_${randomUUID().replace(/-/g, '')}`
    const local = `mxenv_test_local_${randomUUID().replace(/-/g, '')}`
    // .env committed in dotenvx-encrypted form: plaintext-parsing it would
    // inject `KEY="encrypted:…"` ciphertext as the value.
    execFileSync(dotenvx, ['set', 'MXTEST_DOTENVX_REAL', sentinel, '-f', '.env'], {
      cwd: project,
      stdio: 'ignore',
      env: { ...process.env, DOTENVX_NO_NATIVE: 'true' },
    })
    writeFileSync(join(project, '.env.local'), `MXTEST_LOCAL=${local}\n`)

    const result = await composeEnvironment(loadConfigLayers({ homeDir: home, cwd: project }), {
      homeDir: home,
      noInfisical: true,
    })

    expect(result.environment.MXTEST_DOTENVX_REAL).toBe(sentinel)
    expect(result.environment.MXTEST_LOCAL).toBe(local)
    expect(result.provenance.MXTEST_DOTENVX_REAL.source).toBe('__mx_default_dotenvx')
    expect(result.provenance.MXTEST_LOCAL.source).toBe('__mx_default_local')
    expect(readFileSync(join(project, '.env'), 'utf8')).not.toContain(sentinel)
  }, 30_000)
})
