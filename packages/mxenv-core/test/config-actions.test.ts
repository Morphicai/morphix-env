import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  applyConfigAction,
  prepareConfigAction,
  rollbackConfigWrite,
  ConfigActionError,
  type ConfigAction,
} from '../src/config-actions'

let root: string
let home: string
let project: string

function modernConfig() {
  return {
    sources: {
      infisical: { provider: 'infisical', paths: ['/ai'], override: true },
      local: { provider: 'local', files: ['.env.local'], optional: true, override: true },
    },
    profiles: { default: ['infisical', 'local'] },
    defaultProfile: 'default',
  }
}

function writeConfig(config: unknown): string {
  const raw = typeof config === 'string' ? config : `${JSON.stringify(config, null, 2)}\n`
  writeFileSync(join(project, 'mxenv.config.json'), raw, { mode: 0o600 })
  return raw
}

function apply(action: ConfigAction, expectedFingerprint: string) {
  return applyConfigAction({ cwd: project, action, expectedFingerprint, homeDir: home, subject: 'host', profileName: 'default' })
}

function auditEvents() {
  const day = new Date().toISOString().slice(0, 10)
  return readFileSync(join(home, '.mxenv', 'audit', `${day}.jsonl`), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mxenv-config-actions-'))
  home = join(root, 'home')
  project = join(root, 'project')
  mkdirSync(project, { recursive: true })
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('project wiring preview and commit', () => {
  it('previews without writing, then atomically adds one source with a backup and audit', () => {
    const original = writeConfig(modernConfig())
    const action: ConfigAction = {
      type: 'add-source', name: 'dotenvx',
      source: { provider: 'dotenvx', files: ['.env'], optional: true, override: true },
    }
    const preview = prepareConfigAction({ cwd: project, action })
    expect(preview.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(preview.after.map((source) => source.name)).toEqual(['infisical', 'local', 'dotenvx'])
    expect(preview.after[2]).toMatchObject({ files: ['.env'], profiles: ['default'] })
    expect(readFileSync(join(project, 'mxenv.config.json'), 'utf8')).toBe(original)

    const result = apply(action, preview.fingerprint)
    expect(result.fingerprint).toBe(preview.fingerprint)
    expect(readFileSync(result.backupPath, 'utf8')).toBe(original)
    expect(statSync(result.backupPath).mode & 0o777).toBe(0o600)
    const written = JSON.parse(readFileSync(join(project, 'mxenv.config.json'), 'utf8'))
    expect(written.sources.dotenvx.provider).toBe('dotenvx')
    expect(written.profiles.default).toContain('dotenvx')
    expect(statSync(join(project, 'mxenv.config.json')).mode & 0o777).toBe(0o600)
    const event = auditEvents().find((item) => item.action === 'wiring-write' && item.outcome === 'success')
    expect(event).toMatchObject({ sources: ['dotenvx'], keys: [], reason: 'add-source', via: 'host' })
    expect(event.wiring.after.map((source: { name: string }) => source.name)).toEqual(['infisical', 'local', 'dotenvx'])
    expect(JSON.stringify(event)).not.toContain('encrypted:')
  })

  it('updates Infisical env pinning and file order through the same single-source action', () => {
    writeConfig(modernConfig())
    const pin: ConfigAction = {
      type: 'update-source', name: 'infisical',
      source: { provider: 'infisical', paths: ['/ai'], env: 'dev', override: true },
    }
    const pinPreview = prepareConfigAction({ cwd: project, action: pin })
    expect(pinPreview.after[0].env).toBe('dev')
    apply(pin, pinPreview.fingerprint)

    const reorder: ConfigAction = {
      type: 'update-source', name: 'local',
      source: { provider: 'local', files: ['.env.mcp.local', '.env.local'], optional: true, override: true },
    }
    const preview = prepareConfigAction({ cwd: project, action: reorder })
    expect(preview.after.find((source) => source.name === 'local')?.files).toEqual(['.env.mcp.local', '.env.local'])
    apply(reorder, preview.fingerprint)
    const written = JSON.parse(readFileSync(join(project, 'mxenv.config.json'), 'utf8'))
    expect(written.sources.infisical.env).toBe('dev')
    expect(written.sources.local.files).toEqual(['.env.mcp.local', '.env.local'])
  })

  it('removes a source and its profile references', () => {
    writeConfig(modernConfig())
    const action: ConfigAction = { type: 'remove-source', name: 'local' }
    const preview = prepareConfigAction({ cwd: project, action })
    apply(action, preview.fingerprint)
    const written = JSON.parse(readFileSync(join(project, 'mxenv.config.json'), 'utf8'))
    expect(written.sources.local).toBeUndefined()
    expect(written.profiles.default).toEqual(['infisical'])
  })

  it('preserves object-form profiles while adding and removing source references', () => {
    writeConfig({
      sources: { local: { provider: 'local', files: ['.env.local'], optional: true } },
      profiles: { default: { sources: ['local'] } },
      defaultProfile: 'default',
    })
    const action: ConfigAction = {
      type: 'add-source', name: 'extra',
      source: { provider: 'local', files: ['.env.extra'], optional: true },
    }
    const preview = prepareConfigAction({ cwd: project, action })
    expect(preview.after.find((source) => source.name === 'extra')?.profiles).toEqual(['default'])
    apply(action, preview.fingerprint)
    let written = JSON.parse(readFileSync(join(project, 'mxenv.config.json'), 'utf8'))
    expect(written.profiles.default).toEqual({ sources: ['local', 'extra'] })

    const removal: ConfigAction = { type: 'remove-source', name: 'local' }
    const removalPreview = prepareConfigAction({ cwd: project, action: removal })
    apply(removal, removalPreview.fingerprint)
    written = JSON.parse(readFileSync(join(project, 'mxenv.config.json'), 'utf8'))
    expect(written.profiles.default).toEqual({ sources: ['extra'] })
  })

  it('fails closed on stale fingerprints and preserves concurrent edits', () => {
    writeConfig(modernConfig())
    const action: ConfigAction = { type: 'remove-source', name: 'local' }
    const preview = prepareConfigAction({ cwd: project, action })
    const concurrent = modernConfig()
    const concurrentRaw = writeConfig({
      ...concurrent,
      sources: { ...concurrent.sources, infisical: { ...concurrent.sources.infisical, env: 'prod' } },
    })
    expect(() => apply(action, preview.fingerprint)).toThrowError(/fresh diff/)
    expect(readFileSync(join(project, 'mxenv.config.json'), 'utf8')).toBe(concurrentRaw)
    expect(auditEvents().some((event) => event.reason === 'stale-fingerprint' && event.outcome === 'failure')).toBe(true)
  })

  it('rejects invalid sources, invalid JSON and unsupported edits without writing', () => {
    const original = writeConfig(modernConfig())
    const invalid = {
      type: 'add-source', name: '__mx_reserved',
      source: { provider: 'local', files: ['.env'] },
    } as ConfigAction
    expect(() => prepareConfigAction({ cwd: project, action: invalid })).toThrowError(ConfigActionError)
    expect(readFileSync(join(project, 'mxenv.config.json'), 'utf8')).toBe(original)
    writeConfig('{not-json')
    expect(() => prepareConfigAction({ cwd: project, action: { type: 'migrate-legacy' } })).toThrowError(/Cannot edit invalid project wiring/)
    expect(readFileSync(join(project, 'mxenv.config.json'), 'utf8')).toBe('{not-json')
  })
})

describe('legacy migration and rollback', () => {
  it('migrates actual flat infisical/envFiles wiring into modern sources and profiles', () => {
    const original = writeConfig({
      infisical: { paths: ['/ai'], env: 'dev', envPrefix: 'VITE_' },
      envFiles: ['.env.local', '.env.shared'],
    })
    const action: ConfigAction = { type: 'migrate-legacy' }
    const preview = prepareConfigAction({ cwd: project, action })
    expect(preview.before).toEqual([])
    expect(preview.after.map((source) => source.name)).toEqual(['infisical', 'local'])
    const result = apply(action, preview.fingerprint)
    const written = JSON.parse(readFileSync(join(project, 'mxenv.config.json'), 'utf8'))
    expect(written).toMatchObject({
      sources: {
        infisical: { provider: 'infisical', env: 'dev', envPrefix: 'VITE_', override: true },
        local: { provider: 'local', files: ['.env.local', '.env.shared'], optional: true, override: true },
      },
      profiles: { default: ['infisical', 'local'] }, defaultProfile: 'default',
    })
    expect(written.infisical).toBeUndefined()
    expect(written.envFiles).toBeUndefined()
    rollbackConfigWrite(result.configPath, result.backupPath)
    expect(readFileSync(result.configPath, 'utf8')).toBe(original)
  })

  it('keeps the original config when backup creation fails', () => {
    const original = writeConfig(modernConfig())
    const action: ConfigAction = { type: 'remove-source', name: 'local' }
    const preview = prepareConfigAction({ cwd: project, action })
    // 同名目录让备份原子写必败；无需依赖平台权限位语义。
    mkdirSync(join(project, 'mxenv.config.json.bak'))
    expect(() => apply(action, preview.fingerprint)).toThrowError(ConfigActionError)
    expect(readFileSync(join(project, 'mxenv.config.json'), 'utf8')).toBe(original)
    expect(auditEvents().some((event) => event.outcome === 'failure' && event.action === 'wiring-write')).toBe(true)
  })
})
