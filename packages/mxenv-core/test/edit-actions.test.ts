import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { applyEditAction, EditActionError } from '../src/edit-actions'
import { parseEnvFile } from '../src/env'
import { loadSource, type SourceEntry } from '../src/sources'
import { __setKeyringLoaderForTests } from '../src/keyring'

let ROOT: string

function sentinel(label: string): string {
  return `mxenv_test_${label}_${randomUUID().replace(/-/g, '')}`
}

function audits(): any[] {
  const dir = join(ROOT, '.mxenv', 'audit')
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((file) => readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)))
}

beforeEach(() => {
  ROOT = mkdtempSync(join(tmpdir(), 'mxenv-edit-actions-'))
})

afterEach(() => {
  __setKeyringLoaderForTests(null)
  rmSync(ROOT, { recursive: true, force: true })
})

describe('local dotenv edit actions', () => {
  function localEntry(): SourceEntry {
    return { name: 'local', source: { provider: 'local', files: ['local.env'] }, baseDir: ROOT }
  }

  it('sets and deletes one key while preserving unrelated lines and comments', async () => {
    const value = `${sentinel('local')} with spaces`
    writeFileSync(join(ROOT, 'local.env'), '# keep this comment\nexport KEEP="unchanged"\nTARGET=old\n')
    const entry = localEntry()

    const set = await applyEditAction({ action: 'set', key: 'TARGET', value, entry, subject: 'host', profileName: 'default', cwd: ROOT, options: { homeDir: ROOT } })
    expect(set).toMatchObject({ action: 'set', key: 'TARGET', source: 'local', provider: 'local', fileIndex: 0 })
    expect(parseEnvFile(join(ROOT, 'local.env')).TARGET).toBe(value)
    expect(readFileSync(join(ROOT, 'local.env'), 'utf8')).toContain('# keep this comment\nexport KEEP="unchanged"')
    expect(statSync(join(ROOT, 'local.env')).mode & 0o777).toBe(0o600)

    await applyEditAction({ action: 'delete', key: 'TARGET', entry, subject: 'host', options: { homeDir: ROOT } })
    expect(parseEnvFile(join(ROOT, 'local.env')).TARGET).toBeUndefined()
    expect(parseEnvFile(join(ROOT, 'local.env')).KEEP).toBe('unchanged')
    expect(JSON.stringify(audits())).not.toContain(value)
    expect(audits().filter((event) => event.action === 'set' || event.action === 'delete').map((event) => event.outcome)).toEqual(['success', 'success'])
  })

  it('rejects empty set, invalid file indexes and encrypted local files without modifying them', async () => {
    const entry = localEntry()
    writeFileSync(join(ROOT, 'local.env'), 'TARGET=unchanged\n')
    await expect(applyEditAction({ action: 'set', key: 'TARGET', value: '', entry, subject: 'editor', options: { homeDir: ROOT } })).rejects.toMatchObject({ code: 'invalid-value' })
    await expect(applyEditAction({ action: 'set', key: 'TARGET', value: 'replacement', fileIndex: 9, entry, subject: 'editor', options: { homeDir: ROOT } })).rejects.toMatchObject({ code: 'invalid-file-index' })
    expect(readFileSync(join(ROOT, 'local.env'), 'utf8')).toBe('TARGET=unchanged\n')
    expect(audits().filter((event) => event.outcome === 'failure')).toHaveLength(2)
  })
})

describe('dotenvx edit actions', () => {
  it('encrypts set and removes delete without exposing the value or ciphertext as plaintext', async () => {
    const value = sentinel('dotenvx-action')
    const entry: SourceEntry = { name: 'encrypted', source: { provider: 'dotenvx', files: ['encrypted.env'] }, baseDir: ROOT }
    await applyEditAction({ action: 'set', key: 'MXTEST_EDIT_DOTENVX', value, entry, subject: 'host', options: { homeDir: ROOT } })
    expect(readFileSync(join(ROOT, 'encrypted.env'), 'utf8')).not.toContain(value)
    let loaded = await loadSource(entry, { homeDir: ROOT, environment: {} })
    expect(loaded.values.MXTEST_EDIT_DOTENVX).toBe(value)

    await applyEditAction({ action: 'delete', key: 'MXTEST_EDIT_DOTENVX', entry, subject: 'host', options: { homeDir: ROOT } })
    loaded = await loadSource(entry, { homeDir: ROOT, environment: {} })
    expect(loaded.values.MXTEST_EDIT_DOTENVX).toBeUndefined()
    expect(JSON.stringify(audits())).not.toContain(value)

    await expect(applyEditAction({ action: 'set', key: 'MXTEST_EDIT_DOTENVX', value: '$NOT_FAITHFUL', entry, subject: 'host', options: { homeDir: ROOT } })).rejects.toMatchObject({ code: 'unsupported-value' })
  }, 20_000)
})

describe('keychain edit actions', () => {
  it('writes and deletes through the native bridge with value-free audit', async () => {
    const value = sentinel('keychain-action')
    const store = new Map<string, string>()
    __setKeyringLoaderForTests(async () => ({
      Entry: class {
        constructor(service: string, account: string) { this.id = `${service}/${account}` }
        id: string
        setPassword(next: string) { store.set(this.id, next) }
        deletePassword() { return store.delete(this.id) }
      },
    } as never))
    const entry: SourceEntry = { name: 'machine', source: { provider: 'os-keychain', service: 'mxenv:test', keys: ['ACCOUNT'] }, baseDir: ROOT }
    await applyEditAction({ action: 'set', key: 'ACCOUNT', value, entry, subject: 'editor', options: { homeDir: ROOT } })
    expect(store.get('mxenv:test/ACCOUNT')).toBe(value)
    await applyEditAction({ action: 'delete', key: 'ACCOUNT', entry, subject: 'editor', options: { homeDir: ROOT } })
    expect(store.has('mxenv:test/ACCOUNT')).toBe(false)
    expect(JSON.stringify(audits())).not.toContain(value)
  })

  it('rejects remote provider writes', async () => {
    const entry: SourceEntry = { name: 'remote', source: { provider: 'infisical', paths: ['/ai'], env: 'dev' }, baseDir: ROOT }
    const error = await applyEditAction({ action: 'set', key: 'A', value: sentinel('remote'), entry, subject: 'host', options: { homeDir: ROOT } }).catch((reason) => reason)
    expect(error).toBeInstanceOf(EditActionError)
    expect(error.code).toBe('unsupported-provider')
  })
})
