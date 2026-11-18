import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  keyringStore: new Map<string, string>(),
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

// keyring 替身：Entry 形状的内存 Map（服务名\0账号 → 值）。经
// __setKeyringLoaderForTests 注入——vi.mock 够不到 dist 打包后的动态 import。
function keyringDouble(store: Map<string, string>) {
  return {
    Entry: class {
      constructor(
        public service: string,
        public account: string,
      ) {}
      private key() { return `${this.service}\u0000${this.account}` }
      getPassword() { return store.get(this.key()) ?? null }
      setPassword(password: string) { store.set(this.key(), password) }
      deletePassword() { return store.delete(this.key()) }
    },
  }
}

vi.mock('../src/infisical', () => ({
  resolveInfisicalSecrets: mocks.resolveInfisicalSecrets,
  fetchSecretsViaCLI: mocks.fetchSecretsViaCLI,
  hasInfisicalCLI: mocks.hasInfisicalCLI,
  isInfisicalLoggedIn: mocks.isInfisicalLoggedIn,
  readInfisicalJson: mocks.readInfisicalJson,
}))

import { loadSource, type SourceEntry } from '../src/sources'
import { __setKeyringLoaderForTests } from '../src/keyring'

const ROOT = join('/tmp', `mxenv-sources-${randomUUID()}`)
const context = () => ({ homeDir: ROOT, environment: { ...process.env } })
const value = (label: string) => `mxenv_test_${label}_${randomUUID().replace(/-/g, '')}`

function entry(name: string, source: SourceEntry['source']): SourceEntry {
  return { name, source, baseDir: ROOT }
}

beforeEach(() => {
  mkdirSync(ROOT, { recursive: true })
  mocks.execFileSync.mockReset()
  mocks.keyringStore.clear()
  mocks.resolveInfisicalSecrets.mockReset()
  mocks.fetchSecretsViaCLI.mockReset()
  mocks.hasInfisicalCLI.mockReset()
  mocks.isInfisicalLoggedIn.mockReset()
  mocks.readInfisicalJson.mockReset()
})

afterEach(() => {
  __setKeyringLoaderForTests(null)
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

    const loaded = await loadSource(entry('team', { provider: 'infisical', paths: ['/team'] }), { ...context(), envName: 'dev' })

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
      const withEnv = { ...context(), envName: 'dev' } as const
      await expect(loadSource(entry('team', { provider: 'infisical', paths: ['/team'] }), withEnv)).rejects.toThrow('could not authenticate or load')
      await expect(loadSource(entry('team', { provider: 'infisical', paths: ['/team'] }), withEnv)).rejects.not.toThrow(providerOnlyValue)
    } finally {
      if (previous.id === undefined) delete process.env.INFISICAL_CLIENT_ID
      else process.env.INFISICAL_CLIENT_ID = previous.id
      if (previous.secret === undefined) delete process.env.INFISICAL_CLIENT_SECRET
      else process.env.INFISICAL_CLIENT_SECRET = previous.secret
      if (previous.project === undefined) delete process.env.INFISICAL_PROJECT_ID
      else process.env.INFISICAL_PROJECT_ID = previous.project
    }
  })

  it('refuses to compose an Infisical source with no environment (no implicit prod default)', async () => {
    const previousDeploy = process.env.DEPLOY_ENV
    const previousInfisicalEnv = process.env.INFISICAL_ENV
    delete process.env.DEPLOY_ENV
    delete process.env.INFISICAL_ENV
    try {
      await expect(
        loadSource(entry('team', { provider: 'infisical', paths: ['/team'] }), context()),
      ).rejects.toThrow('refusing to default to "prod"')
    } finally {
      if (previousDeploy === undefined) delete process.env.DEPLOY_ENV
      else process.env.DEPLOY_ENV = previousDeploy
      if (previousInfisicalEnv === undefined) delete process.env.INFISICAL_ENV
      else process.env.INFISICAL_ENV = previousInfisicalEnv
    }
  })

  it('accepts an environment pinned on the source itself', async () => {
    const sentinel = value('infisical-pinned')
    mocks.resolveInfisicalSecrets.mockResolvedValue({ values: { MXTEST_INFISICAL: sentinel }, count: 1 })
    const previousId = process.env.INFISICAL_CLIENT_ID
    const previousSecret = process.env.INFISICAL_CLIENT_SECRET
    const previousProject = process.env.INFISICAL_PROJECT_ID
    process.env.INFISICAL_CLIENT_ID = value('client-id')
    process.env.INFISICAL_CLIENT_SECRET = value('client-secret')
    process.env.INFISICAL_PROJECT_ID = value('project-id')
    try {
      const loaded = await loadSource(
        entry('team', { provider: 'infisical', paths: ['/team'], env: 'prod' }),
        context(),
      )
      expect(loaded.values.MXTEST_INFISICAL).toBe(sentinel)
      expect(mocks.resolveInfisicalSecrets).toHaveBeenCalledOnce()
    } finally {
      if (previousId === undefined) delete process.env.INFISICAL_CLIENT_ID
      else process.env.INFISICAL_CLIENT_ID = previousId
      if (previousSecret === undefined) delete process.env.INFISICAL_CLIENT_SECRET
      else process.env.INFISICAL_CLIENT_SECRET = previousSecret
      if (previousProject === undefined) delete process.env.INFISICAL_PROJECT_ID
      else process.env.INFISICAL_PROJECT_ID = previousProject
    }
  })

  it('runs Infisical project discovery and export in the source baseDir', async () => {
    const previous = {
      id: process.env.INFISICAL_CLIENT_ID,
      secret: process.env.INFISICAL_CLIENT_SECRET,
      project: process.env.INFISICAL_PROJECT_ID,
    }
    delete process.env.INFISICAL_CLIENT_ID
    delete process.env.INFISICAL_CLIENT_SECRET
    delete process.env.INFISICAL_PROJECT_ID
    try {
      mocks.readInfisicalJson.mockReturnValue({})
      mocks.hasInfisicalCLI.mockReturnValue(true)
      mocks.isInfisicalLoggedIn.mockReturnValue(true)
      mocks.fetchSecretsViaCLI.mockReturnValue({ values: { MXTEST_INFISICAL: value('cwd') }, count: 1, errors: [] })
      const loaded = await loadSource(entry('team', { provider: 'infisical', paths: ['/ai'], env: 'dev' }), context())
      expect(loaded.availability).toBe('loaded')
      expect(mocks.readInfisicalJson).toHaveBeenCalledWith(ROOT)
      expect(mocks.fetchSecretsViaCLI).toHaveBeenCalledWith('dev', ['/ai'], undefined, ROOT)
    } finally {
      for (const [key, original] of Object.entries({ INFISICAL_CLIENT_ID: previous.id, INFISICAL_CLIENT_SECRET: previous.secret, INFISICAL_PROJECT_ID: previous.project })) {
        if (original === undefined) delete process.env[key]
        else process.env[key] = original
      }
    }
  })

  it('legacy skip paths carry a value-free reason in detail', async () => {
    const legacyEntry = (name = '__mx_legacy_infisical'): SourceEntry => ({
      name,
      source: { provider: 'infisical', paths: ['/ai'] },
      baseDir: ROOT,
      legacy: true,
    })

    const ctx = { ...context(), envName: 'dev' }
    mocks.readInfisicalJson.mockReturnValue({})

    mocks.hasInfisicalCLI.mockReturnValue(false)
    let loaded = await loadSource(legacyEntry(), ctx)
    expect(loaded.availability).toBe('skipped')
    expect(loaded.detail).toBe('infisical CLI not installed')

    mocks.hasInfisicalCLI.mockReturnValue(true)
    mocks.isInfisicalLoggedIn.mockReturnValue(false)
    loaded = await loadSource(legacyEntry(), ctx)
    expect(loaded.availability).toBe('skipped')
    expect(loaded.detail).toBe('infisical CLI not logged in (run: infisical login)')

    mocks.isInfisicalLoggedIn.mockReturnValue(true)
    mocks.fetchSecretsViaCLI.mockReturnValue({ values: {}, count: 0, errors: [{ kind: 'no-project', path: '/ai', stderr: 'x' }] })
    loaded = await loadSource(legacyEntry(), ctx)
    expect(loaded.availability).toBe('skipped')
    expect(loaded.detail).toBe('infisical export failed (no-project)')
  })

  it('--no-infisical marks the skip as an explicit choice', async () => {
    const loaded = await loadSource(
      entry('team', { provider: 'infisical', paths: ['/team'] }),
      { ...context(), noInfisical: true },
    )
    expect(loaded.availability).toBe('skipped')
    expect(loaded.detail).toBe('disabled by --no-infisical')
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

  it('reads declared accounts through the keyring adapter (platform-agnostic)', async () => {
    const sentinel = value('keychain')
    mocks.keyringStore.set('com.example.mxenv\u0000MXTEST_KEYCHAIN', sentinel)
    mocks.keyringStore.set('com.example.mxenv\u0000FOREIGN', 'not-declared')
    __setKeyringLoaderForTests(async () => keyringDouble(mocks.keyringStore) as never)

    const loaded = await loadSource(
      entry('machine', { provider: 'os-keychain', service: 'com.example.mxenv', keys: ['MXTEST_KEYCHAIN'] }),
      context(),
    )

    // 只见声明键：外来账号天然不可见（无服务级发现）。
    expect(loaded.values.MXTEST_KEYCHAIN).toBe(sentinel)
    expect(Object.keys(loaded.values)).toEqual(['MXTEST_KEYCHAIN'])
  })

  it('fails closed when an os-keychain source declares no keys', async () => {
    __setKeyringLoaderForTests(async () => keyringDouble(mocks.keyringStore) as never)
    await expect(
      loadSource(entry('machine', { provider: 'os-keychain', service: 'com.example.mxenv' }), context()),
    ).rejects.toThrow('declares no keys')
  })

  it('fails closed when a platform pin does not match this machine', async () => {
    __setKeyringLoaderForTests(async () => keyringDouble(mocks.keyringStore) as never)
    // pin=windows 在任何测试机上都构成不匹配（linux CI 与 macOS 本机皆非 windows）。
    await expect(
      loadSource(entry('machine', { provider: 'os-keychain', service: 'com.example.mxenv', keys: ['A'], platform: 'windows' }), context()),
    ).rejects.toThrow('pinned to windows')
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


describe('issue #9 F6: plugin failure attribution', () => {
  it('a plugin killed by a signal attributes the signal, never "exit unknown"', async () => {
    const error: any = new Error('Command failed')
    error.signal = 'SIGTERM'
    error.killed = true
    mocks.execFileSync.mockImplementation(() => { throw error })
    await expect(
      loadSource(entry('killer', { provider: 'plugin', plugin: 'killer', keys: ['MXTEST_K'] } as any), context()),
    ).rejects.toThrow(/killed by signal SIGTERM/)
  })

  it('a plugin exiting with a status still reports exit N', async () => {
    const error: any = new Error('Command failed')
    error.status = 3
    mocks.execFileSync.mockImplementation(() => { throw error })
    await expect(
      loadSource(entry('bad', { provider: 'plugin', plugin: 'bad', keys: ['MXTEST_K'] } as any), context()),
    ).rejects.toThrow(/exit 3/)
  })
})
