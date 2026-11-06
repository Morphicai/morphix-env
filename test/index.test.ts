import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { createRequire } from 'module'

const requireFromTests = createRequire(join(__dirname, 'index.test.ts'))
const ROOT = join(tmpdir(), `mx-env-index-${randomUUID()}`)
const HOME = join(ROOT, 'home')
const PROJECT = join(ROOT, 'project')
const DIST_INDEX = join(__dirname, '..', 'dist', 'index.js')

function value(label: string): string {
  return `mxenv_test_${label}_${randomUUID().replace(/-/g, '')}`
}

afterEach(() => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true })
})

function writeProject(): string {
  mkdirSync(HOME, { recursive: true })
  mkdirSync(PROJECT, { recursive: true })
  const sentinel = value('sdk')
  writeFileSync(join(PROJECT, '.env.local'), `MXTEST_SDK=${sentinel}\n`, { mode: 0o600 })
  return sentinel
}

describe('package exports', () => {
  it('maps "." to the SDK facade and "./cli" to the CLI entry', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
      main: string
      types: string
      exports: Record<string, { types: string; default: string }>
    }
    expect(manifest.main).toBe('./dist/index.js')
    expect(manifest.types).toBe('./dist/index.d.ts')
    expect(manifest.exports['.']).toEqual({ types: './dist/index.d.ts', default: './dist/index.js' })
    expect(manifest.exports['./cli']).toEqual({ types: './dist/cli.d.ts', default: './dist/cli.js' })
  })

  it('dist facade .d.ts 钉住公开类型面（防 tsup dts 丢 type re-export）', () => {
    const dts = readFileSync(join(__dirname, '..', 'dist', 'index.d.ts'), 'utf8')
    // 公开类型面=12 个（与 HEAD SDK facade 逐一一致，缺一即 .d.ts 面回归）。
    for (const name of [
      'ComposeOptions',
      'EnvironmentComposition',
      'KeyProvenance',
      'SourceStatus',
      'ConfigLayers',
      'LoadedConfig',
      'LoadConfigOptions',
      'MxEnvConfig',
      'ProfileDefinition',
      'ProfileInput',
      'SecretSource',
      'SourceEntry',
    ]) {
      expect(dts, `类型导出 ${name} 丢失`).toContain(name)
    }
  })
})

describe('SDK facade from dist', () => {
  it('exports the pure engine, keeps legacy process-mutators private, and runs a composition via require', async () => {
    const sentinel = writeProject()

    const sdk = requireFromTests(DIST_INDEX) as Record<string, unknown>
    expect(typeof sdk.composeEnvironment).toBe('function')
    expect(typeof sdk.loadConfigLayers).toBe('function')
    expect(typeof sdk.validateConfig).toBe('function')
    expect(typeof sdk.StreamingRedactor).toBe('function')
    expect(typeof sdk.CompositionError).toBe('function')
    // Legacy helpers mutate process.env and must not ride the facade.
    expect(sdk.loadEnvFiles).toBeUndefined()
    expect(sdk.fetchInfisicalSecrets).toBeUndefined()

    const layers = (sdk.loadConfigLayers as (options: unknown) => unknown)({ homeDir: HOME, cwd: PROJECT })
    const composition = await (sdk.composeEnvironment as (l: unknown, o: unknown) => Promise<any>)(layers, {
      homeDir: HOME,
      noInfisical: true,
      baseEnvironment: {},
    })
    expect(composition.environment.MXTEST_SDK).toBe(sentinel)
    expect(composition.provenance.MXTEST_SDK.source).toBe('__mx_legacy_local')
    expect(Array.isArray(composition.redactionValues)).toBe(true)
    expect(composition.redactionValues).toContain(sentinel)
  })

  it('acceptance path: node -e requires dist and composes', () => {
    const sentinel = writeProject()
    const script = `
      const sdk = require(${JSON.stringify(DIST_INDEX)})
      const layers = sdk.loadConfigLayers({ homeDir: process.argv[1], cwd: process.argv[2] })
      sdk.composeEnvironment(layers, { homeDir: process.argv[1], noInfisical: true, baseEnvironment: {} })
        .then((r) => console.log(JSON.stringify({
          keys: Object.keys(r.provenance).sort(),
          value: r.environment.MXTEST_SDK,
          source: r.provenance.MXTEST_SDK.source,
        })))
    `
    const out = execFileSync('node', ['-e', script, HOME, PROJECT], { encoding: 'utf8' })
    const parsed = JSON.parse(out.trim()) as { keys: string[]; value: string; source: string }
    expect(parsed.keys).toContain('MXTEST_SDK')
    expect(parsed.value).toBe(sentinel)
    expect(parsed.source).toBe('__mx_legacy_local')
  })

  it('loadConfigLayers() with no options uses the real home directory (config.ts homedir import)', () => {
    const sdk = requireFromTests(DIST_INDEX) as { loadConfigLayers: (options?: unknown) => unknown }
    expect(() => sdk.loadConfigLayers()).not.toThrow()
  })
})
