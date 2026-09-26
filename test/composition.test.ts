import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { composeEnvironment, CompositionError } from '../src/composition'
import { loadConfigLayers, validateConfig } from '../src/config'

const ROOT = join(tmpdir(), `mx-env-composition-${randomUUID()}`)

function value(label: string): string {
  return `mxenv_test_${label}_${randomUUID().replace(/-/g, '')}`
}

function write(path: string, content: string, mode?: number): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
  if (mode !== undefined) chmodSync(path, mode)
}

function paths(name: string): { home: string; project: string } {
  const base = join(ROOT, name)
  const home = join(base, 'home')
  const project = join(base, 'project')
  mkdirSync(home, { recursive: true })
  mkdirSync(project, { recursive: true })
  return { home, project }
}

async function compose(name: string, setup: (p: { home: string; project: string }) => void, options: Record<string, unknown> = {}) {
  const p = paths(name)
  setup(p)
  return composeEnvironment(loadConfigLayers({ homeDir: p.home, cwd: p.project }), {
    homeDir: p.home,
    noInfisical: true,
    baseEnvironment: { MXTEST_PARENT: value('parent') },
    ...options,
  })
}

afterEach(() => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true })
})

describe('environment composition', () => {
  it('loads ~/.mx-env/.env without project configuration', async () => {
    const global = value('global')
    const result = await compose('global-env', ({ home }) => {
      write(join(home, '.mx-env', '.env'), `MXTEST_GLOBAL=${global}\n`, 0o600)
    })

    expect(result.environment.MXTEST_GLOBAL).toBe(global)
    expect(result.profileName).toBe('legacy')
    expect(result.provenance.MXTEST_GLOBAL.source).toBe('__mx_global_dotenv')
  })

  it('--no-global excludes the conventional global dotenv source', async () => {
    const global = value('excluded')
    const result = await compose('no-global', ({ home }) => {
      write(join(home, '.mx-env', '.env'), `MXTEST_GLOBAL=${global}\n`, 0o600)
    }, { noGlobal: true })

    expect(result.environment.MXTEST_GLOBAL).toBeUndefined()
    expect(result.sourceStatuses.some((source) => source.name === '__mx_global_dotenv')).toBe(false)
  })

  it('rejects an insecure conventional global dotenv file', async () => {
    await expect(compose('unsafe-global', ({ home }) => {
      write(join(home, '.mx-env', '.env'), `MXTEST_GLOBAL=${value('unsafe')}\n`, 0o644)
    })).rejects.toMatchObject({ name: 'SourceError' })
  })

  it('allows an explicit project profile to extend global sources and override a key', async () => {
    const global = value('global-profile')
    const local = value('project-profile')
    const result = await compose('profile-extends', ({ home, project }) => {
      write(join(home, '.mx-env', 'global.env'), `MXTEST_SHARED=${global}\n`, 0o600)
      write(join(home, '.mx-env', 'config.json'), JSON.stringify({
        sources: { shared: { provider: 'local', files: ['global.env'] } },
        profiles: { developer: { sources: ['shared'] } },
        defaultProfile: 'developer',
      }))
      write(join(project, 'project.env'), `MXTEST_SHARED=${local}\n`)
      write(join(project, 'mx-env.config.json'), JSON.stringify({
        sources: { project: { provider: 'local', files: ['project.env'], override: true } },
        profiles: { app: { extends: 'developer', sources: ['project'] } },
        defaultProfile: 'app',
      }))
    })

    expect(result.environment.MXTEST_SHARED).toBe(local)
    expect(result.provenance.MXTEST_SHARED.source).toBe('project')
    expect(result.provenance.MXTEST_SHARED.overriddenSources).toEqual(['shared'])
  })

  it('keeps legacy project local overrides above the global dotenv baseline', async () => {
    const global = value('global-legacy')
    const local = value('local-legacy')
    const result = await compose('legacy-overrides-global', ({ home, project }) => {
      write(join(home, '.mx-env', '.env'), `MXTEST_LEGACY=${global}\n`, 0o600)
      write(join(project, '.env.local'), `MXTEST_LEGACY=${local}\n`)
    })

    expect(result.environment.MXTEST_LEGACY).toBe(local)
    expect(result.provenance.MXTEST_LEGACY.source).toBe('__mx_legacy_local')
  })

  it('fails a duplicate source key unless the later source declares override', async () => {
    await expect(compose('collision', ({ project }) => {
      write(join(project, 'first.env'), `MXTEST_DUPLICATE=${value('first')}\n`)
      write(join(project, 'second.env'), `MXTEST_DUPLICATE=${value('second')}\n`)
      write(join(project, 'mx-env.config.json'), JSON.stringify({
        sources: {
          first: { provider: 'local', files: ['first.env'] },
          second: { provider: 'local', files: ['second.env'] },
        },
        profiles: { app: { sources: ['first', 'second'] } },
        defaultProfile: 'app',
      }))
    })).rejects.toBeInstanceOf(CompositionError)
  })

  it('retains parent values that no source supplies', async () => {
    const parent = value('parent-retained')
    const result = await compose('parent', () => {}, { baseEnvironment: { MXTEST_PARENT: parent } })
    expect(result.environment.MXTEST_PARENT).toBe(parent)
  })

  it('keeps values out of serializable provenance and source status', async () => {
    const sentinel = value('not-serialized')
    const result = await compose('no-value-provenance', ({ project }) => {
      write(join(project, '.env.local'), `MXTEST_HYGIENE=${sentinel}\n`)
    })

    expect(JSON.stringify({ provenance: result.provenance, sources: result.sourceStatuses })).not.toContain(sentinel)
    expect(result.redactionValues).toContain(sentinel)
  })
})

describe('configuration validation', () => {
  it('rejects optional remote sources without inspecting credentials', () => {
    const errors = validateConfig({
      sources: { remote: { provider: 'doppler', project: 'project', config: 'dev', optional: true } },
    }, 'fixture')
    expect(errors).toContain('fixture: remote source "remote" cannot be optional')
  })
})
