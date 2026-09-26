import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  findCredentials: vi.fn(),
  resolveInfisicalSecrets: vi.fn(),
  fetchSecretsViaCLI: vi.fn(),
  hasInfisicalCLI: vi.fn(),
  isInfisicalLoggedIn: vi.fn(),
  readInfisicalJson: vi.fn(),
}))

vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  execFileSync: mocks.execFileSync,
}))
vi.mock('keytar', () => ({ default: { findCredentials: mocks.findCredentials } }))
vi.mock('../src/infisical', () => ({
  resolveInfisicalSecrets: mocks.resolveInfisicalSecrets,
  fetchSecretsViaCLI: mocks.fetchSecretsViaCLI,
  hasInfisicalCLI: mocks.hasInfisicalCLI,
  isInfisicalLoggedIn: mocks.isInfisicalLoggedIn,
  readInfisicalJson: mocks.readInfisicalJson,
}))

import { loadSource, type SourceEntry } from '../src/sources'

const ROOT = join('/tmp', `mx-env-sources-${randomUUID()}`)
const context = () => ({ homeDir: ROOT, environment: { ...process.env } })
const value = (label: string) => `mxenv_test_${label}_${randomUUID().replace(/-/g, '')}`

function entry(name: string, source: SourceEntry['source']): SourceEntry {
  return { name, source, baseDir: ROOT }
}

beforeEach(() => {
  mkdirSync(ROOT, { recursive: true })
  mocks.execFileSync.mockReset()
  mocks.findCredentials.mockReset()
  mocks.resolveInfisicalSecrets.mockReset()
  mocks.fetchSecretsViaCLI.mockReset()
  mocks.hasInfisicalCLI.mockReset()
  mocks.isInfisicalLoggedIn.mockReset()
  mocks.readInfisicalJson.mockReset()
})

afterEach(() => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true })
})

describe('provider source adapters', () => {
  it('loads an optional local source without mutating the parent environment', async () => {
    const name = 'MXTEST_LOCAL'
    const sentinel = value('local')
    writeFileSync(join(ROOT, 'local.env'), `${name}=${sentinel}\n`)
    const before = process.env[name]

    const loaded = await loadSource(entry('local', { provider: 'local', files: ['local.env'], optional: true }), context())

    expect(loaded.values[name]).toBe(sentinel)
    expect(process.env[name]).toBe(before)
  })

  it('marks a missing optional local source without a value', async () => {
    const loaded = await loadSource(entry('missing', { provider: 'local', files: ['missing.env'], optional: true }), context())
    expect(loaded.availability).toBe('missing-optional')
    expect(loaded.values).toEqual({})
  })

  it('uses the Infisical resolver without exposing its values through errors', async () => {
    const sentinel = value('infisical')
    mocks.resolveInfisicalSecrets.mockResolvedValue({ values: { MXTEST_INFISICAL: sentinel }, count: 1 })
    const priorId = process.env.INFISICAL_CLIENT_ID
    const priorSecret = process.env.INFISICAL_CLIENT_SECRET
    const priorProject = process.env.INFISICAL_PROJECT_ID
    process.env.INFISICAL_CLIENT_ID = value('client-id')
    process.env.INFISICAL_CLIENT_SECRET = value('client-secret')
    process.env.INFISICAL_PROJECT_ID = value('project-id')

    const loaded = await loadSource(entry('team', { provider: 'infisical', paths: ['/team'] }), context())

    expect(loaded.values.MXTEST_INFISICAL).toBe(sentinel)
    expect(mocks.resolveInfisicalSecrets).toHaveBeenCalledOnce()
    for (const [key, original] of Object.entries({ INFISICAL_CLIENT_ID: priorId, INFISICAL_CLIENT_SECRET: priorSecret, INFISICAL_PROJECT_ID: priorProject })) {
      if (original === undefined) delete process.env[key]
      else process.env[key] = original
    }
  })

  it('formats a failed Infisical source without forwarding provider error content', async () => {
    const providerOnlyValue = value('provider-error-content')
    mocks.resolveInfisicalSecrets.mockRejectedValue(new Error(providerOnlyValue))
    const previous = {
      id: process.env.INFISICAL_CLIENT_ID,
      secret: process.env.INFISICAL_CLIENT_SECRET,
      project: process.env.INFISICAL_PROJECT_ID,
    }
    process.env.INFISICAL_CLIENT_ID = value('client-id')
    process.env.INFISICAL_CLIENT_SECRET = value('client-secret')
    process.env.INFISICAL_PROJECT_ID = value('project-id')
    try {
      await expect(loadSource(entry('team', { provider: 'infisical', paths: ['/team'] }), context())).rejects.toThrow('could not authenticate or load')
      await expect(loadSource(entry('team', { provider: 'infisical', paths: ['/team'] }), context())).rejects.not.toThrow(providerOnlyValue)
    } finally {
      if (previous.id === undefined) delete process.env.INFISICAL_CLIENT_ID
      else process.env.INFISICAL_CLIENT_ID = previous.id
      if (previous.secret === undefined) delete process.env.INFISICAL_CLIENT_SECRET
      else process.env.INFISICAL_CLIENT_SECRET = previous.secret
      if (previous.project === undefined) delete process.env.INFISICAL_PROJECT_ID
      else process.env.INFISICAL_PROJECT_ID = previous.project
    }
  })

  it('uses dotenvx in-memory output without creating a plaintext file', async () => {
    const sentinel = value('dotenvx')
    const file = join(ROOT, 'encrypted.env')
    writeFileSync(file, 'DOTENV_PUBLIC_KEY=public\nMXTEST_DOTENVX=encrypted:opaque\n')
    mocks.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (command.endsWith('dotenvx') && args[0] === '--version') return 'dotenvx test'
      if (command.endsWith('dotenvx') && args[0] === 'run') return JSON.stringify({ MXTEST_DOTENVX: sentinel })
      throw new Error('unexpected command')
    })

    const loaded = await loadSource(entry('encrypted', { provider: 'dotenvx', files: ['encrypted.env'] }), context())

    expect(loaded.values.MXTEST_DOTENVX).toBe(sentinel)
    expect(existsSync(join(ROOT, 'plaintext.env'))).toBe(false)
  })

  it('reads a macOS Keychain service collection through the keytar adapter', async () => {
    const sentinel = value('keychain')
    mocks.findCredentials.mockResolvedValue([{ account: 'MXTEST_KEYCHAIN', password: sentinel }])

    const loaded = await loadSource(entry('machine', { provider: 'os-keychain', service: 'com.example.mx-env', platform: 'macos' }), context())

    expect(loaded.values.MXTEST_KEYCHAIN).toBe(sentinel)
    expect(mocks.findCredentials).toHaveBeenCalledWith('com.example.mx-env')
  })

  it('loads a Doppler project/config source without accepting a token in config', async () => {
    const sentinel = value('doppler')
    mocks.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === 'doppler' && args[0] === '--version') return 'doppler test'
      if (command === 'doppler' && args[0] === 'secrets') return `MXTEST_DOPPLER=${sentinel}\n`
      throw new Error('unexpected command')
    })

    const loaded = await loadSource(entry('remote', { provider: 'doppler', project: 'test-project', config: 'dev' }), context())

    expect(loaded.values.MXTEST_DOPPLER).toBe(sentinel)
    expect(mocks.execFileSync).toHaveBeenCalledWith('doppler', expect.arrayContaining(['--project', 'test-project', '--config', 'dev']), expect.any(Object))
  })
})
