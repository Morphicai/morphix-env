import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { composeEnvironment, loadConfigLayers, loadKeytar } from '@morphixai/mxenv-core'
import { discoverPlaintextUnits, executeUnit, legacyPlaintextHints } from '../src/migrate'

const CLI = join(__dirname, '..', 'dist', 'cli.js')
// Shared test tooling (dotenvx CLI) lives at the workspace root — product
// packages must not declare decryption tooling (see test/product-boundary).
// Walk up from this file to find root node_modules/.bin/dotenvx.
function findDotenvxBin(): string {
  let dir = join(__dirname, '..')
  for (;;) {
    const candidate = join(dir, 'node_modules', '.bin', 'dotenvx')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) throw new Error('dotenvx test tooling not found under any node_modules/.bin — run pnpm install')
    dir = parent
  }
}
const REPO_DOTENVX = findDotenvxBin()
const TMP = join(tmpdir(), `mxenv-migrate-${randomUUID()}`)
const HOME = join(TMP, 'home')
const secretValue = (label: string) => `mxenv_migrate_${label}_${randomUUID().replace(/-/g, '')}`
// 失败注入用 macOS 独有的 chflags uchg——非 darwin 跳过而非假红（Linux/CI 可移植性）。
const itDarwin = process.platform === 'darwin' ? it : it.skip

function layers(cwd = TMP) {
  return loadConfigLayers({ cwd, homeDir: HOME })
}

function writeProjectConfig(config: unknown) {
  writeFileSync(join(TMP, 'mxenv.config.json'), JSON.stringify(config, null, 2))
}

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(HOME, { recursive: true })
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('discoverPlaintextUnits / legacyPlaintextHints', () => {
  it('discovers the global implicit file plus declared local sources from both layers', () => {
    mkdirSync(join(HOME, '.mxenv'), { recursive: true })
    writeFileSync(join(HOME, '.mxenv', '.env'), `GLOBALKEY=${secretValue('g')}\n`)
    writeFileSync(join(HOME, '.mxenv', 'config.json'), JSON.stringify({
      sources: { g: { provider: 'local', files: ['./g.env'] } },
    }))
    writeFileSync(join(HOME, '.mxenv', 'g.env'), `GKEY=${secretValue('gd')}\n`)
    writeProjectConfig({
      sources: {
        plain: { provider: 'local', files: ['.env.local'] },
        enc: { provider: 'dotenvx', files: ['.env.enc'], optional: true },
        missing: { provider: 'local', files: ['.env.absent'] },
      },
    })
    writeFileSync(join(TMP, '.env.local'), `PKEY=${secretValue('p')}\n`)

    const units = discoverPlaintextUnits(layers(), HOME)
    const byName = Object.fromEntries(units.map((unit) => [unit.name, unit]))
    expect(Object.keys(byName).sort()).toEqual(['__mx_global_dotenv', 'g', 'plain'])
    expect(byName.__mx_global_dotenv.kind).toBe('global-implicit')
    expect(byName.__mx_global_dotenv.configPath).toBeNull()
    expect(byName.g.scope).toBe('global')
    expect(byName.plain.scope).toBe('project')
    expect(byName.plain.keyNames).toEqual(['PKEY'])
  })

  it('excludes an already-encrypted implicit file (idempotency)', () => {
    mkdirSync(join(HOME, '.mxenv'), { recursive: true })
    writeFileSync(join(HOME, '.mxenv', '.env'), 'DOTENV_PUBLIC_KEY="03abc"\nKEY="encrypted:deadbeef"\n')
    expect(discoverPlaintextUnits(layers(), HOME)).toEqual([])
  })

  it('hints legacy plaintext files but never auto-migrates them', () => {
    writeFileSync(join(TMP, '.env.local'), `LEG=${secretValue('l')}\n`)
    const units = discoverPlaintextUnits(layers(), HOME)
    expect(legacyPlaintextHints(layers(), units, HOME)).toEqual([join(TMP, '.env.local')])
    // A declared source covering the same file suppresses the hint.
    writeProjectConfig({ sources: { plain: { provider: 'local', files: ['.env.local'] } } })
    const units2 = discoverPlaintextUnits(layers(), HOME)
    expect(legacyPlaintextHints(layers(), units2, HOME)).toEqual([])
  })
})

describe('executeUnit -> dotenvx', () => {
  it('backup/restore survives source file names containing the backup mark', async () => {
    // lastIndexOf regression: restore must target the full original name, not
    // the prefix before the first `.mx-env-backup-` occurrence. Force a
    // mid-migration failure by making the config read-only after discovery
    // (discover reads it fine; the config rewrite throws EACCES).
    const value = secretValue('mark')
    const marked = 'a.mx-env-backup-old.env'
    writeProjectConfig({
      sources: { plain: { provider: 'local', files: [marked] } },
      profiles: { dev: { sources: ['plain'] } },
      defaultProfile: 'dev',
    })
    writeFileSync(join(TMP, marked), `MARK_A=${value}\n`)
    chmodSync(join(TMP, 'mxenv.config.json'), 0o444)

    try {
      const [unit] = discoverPlaintextUnits(layers(), HOME)
      const outcome = await executeUnit(unit, 'dotenvx', {}, HOME)
      // Config rewrite fails (read-only) → rollback must restore the PLAINTEXT
      // file at its full original path. With an indexOf bug the restore lands
      // on `a` and the original stays encrypted.
      expect(outcome.status).toBe('failed')
      expect(readFileSync(join(TMP, marked), 'utf8')).toContain(value)
    } finally {
      chmodSync(join(TMP, 'mxenv.config.json'), 0o644)
    }
  }, 30_000)

  it('multi-file units keep later-file-wins semantics through migration', async () => {
    const value = secretValue('order')
    writeProjectConfig({
      sources: { plain: { provider: 'local', files: ['base.env', 'over.env'] } },
      profiles: { dev: { sources: ['plain'] } },
      defaultProfile: 'dev',
    })
    writeFileSync(join(TMP, 'base.env'), `ORD_A=from_base\nORD_B=${secretValue('b')}\n`)
    writeFileSync(join(TMP, 'over.env'), `ORD_A=${value}\n`)

    const [unit] = discoverPlaintextUnits(layers(), HOME)
    const outcome = await executeUnit(unit, 'dotenvx', {}, HOME)
    expect(outcome.status).toBe('migrated')
    // Snapshot merge and decrypt merge must agree on the override order.
    const composition = await composeEnvironment(layers(), { homeDir: HOME, noInfisical: true })
    expect(composition.environment.ORD_A).toBe(value)
    expect(composition.environment.ORD_B).toBeTruthy()
  }, 30_000)

  it('migrates a declared source: encrypts in place, rewrites config, values stay equivalent', async () => {
    const value = secretValue('declared')
    writeProjectConfig({
      sources: { plain: { provider: 'local', files: ['.env.local'], override: true } },
      profiles: { dev: { sources: ['plain'] } },
      defaultProfile: 'dev',
    })
    writeFileSync(join(TMP, '.env.local'), `MIG_A=${value}\nMIG_B=two\n`)

    const [unit] = discoverPlaintextUnits(layers(), HOME)
    const outcome = await executeUnit(unit, 'dotenvx', {}, HOME)
    expect(outcome.status).toBe('migrated')

    const encrypted = readFileSync(join(TMP, '.env.local'), 'utf8')
    expect(encrypted).toContain('DOTENV_PUBLIC_KEY')
    expect(encrypted).not.toContain(value)
    expect((statSync(join(TMP, '.env.keys')).mode & 0o777).toString(8)).toBe('600')
    for (const backup of outcome.backups) {
      expect((statSync(backup).mode & 0o777).toString(8)).toBe('600')
    }

    const rewritten = JSON.parse(readFileSync(join(TMP, 'mxenv.config.json'), 'utf8'))
    expect(rewritten.sources.plain.provider).toBe('dotenvx')
    expect(rewritten.sources.plain.override).toBe(true)

    // Composition through the rewritten config yields the same values.
    const composition = await composeEnvironment(layers(), { homeDir: HOME, noInfisical: true })
    expect(composition.environment.MIG_A).toBe(value)

    // Idempotent: nothing left to discover.
    expect(discoverPlaintextUnits(layers(), HOME)).toEqual([])
  }, 30_000)

  it('migrates the global implicit file with zero config changes; composition sniffs encryption', async () => {
    const value = secretValue('implicit')
    mkdirSync(join(HOME, '.mxenv'), { recursive: true })
    writeFileSync(join(HOME, '.mxenv', '.env'), `GLOB_A=${value}\n`)

    const [unit] = discoverPlaintextUnits(layers(), HOME)
    expect(unit.kind).toBe('global-implicit')
    const outcome = await executeUnit(unit, 'dotenvx', {}, HOME)
    expect(outcome.status).toBe('migrated')
    expect(existsSync(join(HOME, '.mxenv', 'config.json'))).toBe(false)
    expect(readFileSync(join(HOME, '.mxenv', '.env'), 'utf8')).not.toContain(value)

    const composition = await composeEnvironment(layers(), { homeDir: HOME, noInfisical: true })
    expect(composition.environment.GLOB_A).toBe(value)
  }, 30_000)

  it('verification is immune to same-named process env vars shadowing the file', async () => {
    const value = secretValue('shadow')
    mkdirSync(join(HOME, '.mxenv'), { recursive: true })
    writeFileSync(join(HOME, '.mxenv', '.env'), `GLOB_SHADOW=${value}\n`)

    // dotenvx `decrypt --stdout` merges same-named parent-env variables over
    // file values (no --overload), so a stale export with a different value
    // used to fail verification and roll the migration back. Verification must
    // prove the file on disk — and encryption must not bake in the env value.
    process.env.GLOB_SHADOW = secretValue('env-shadow')
    // A dotenvx key-material variable in the parent env must neither break the
    // decrypt call nor substitute for the .env.keys the check proves.
    process.env.DOTENV_PRIVATE_KEY = 'garbage-not-a-key'
    try {
      const [unit] = discoverPlaintextUnits(layers(), HOME)
      const outcome = await executeUnit(unit, 'dotenvx', {}, HOME)
      expect(outcome.status).toBe('migrated')

      const composition = await composeEnvironment(layers(), { homeDir: HOME, noInfisical: true })
      expect(composition.environment.GLOB_SHADOW).toBe(value)
    } finally {
      delete process.env.GLOB_SHADOW
      delete process.env.DOTENV_PRIVATE_KEY
    }
  }, 30_000)

  it('a file declaring toolchain keys like PATH still migrates (verification child keeps a runnable PATH)', async () => {
    const value = secretValue('pathkey')
    mkdirSync(join(HOME, '.mxenv'), { recursive: true })
    writeFileSync(join(HOME, '.mxenv', '.env'), `PATH=/opt/tooling/bin\nGLOB_PATH=${value}\n`)

    const [unit] = discoverPlaintextUnits(layers(), HOME)
    const outcome = await executeUnit(unit, 'dotenvx', {}, HOME)
    expect(outcome.status).toBe('migrated')

    const composition = await composeEnvironment(layers(), { homeDir: HOME, noInfisical: true })
    expect(composition.environment.GLOB_PATH).toBe(value)
  }, 30_000)

  it('refuses migration for values with $ expansion sequences, naming the affected key', async () => {
    mkdirSync(join(HOME, '.mxenv'), { recursive: true })
    writeFileSync(join(HOME, '.mxenv', '.env'), 'GLOB_DOLLAR=ab$cd\n')

    const [unit] = discoverPlaintextUnits(layers(), HOME)
    const outcome = await executeUnit(unit, 'dotenvx', {}, HOME)
    expect(outcome.status).toBe('failed')
    expect(outcome.detail).toMatch(/GLOB_DOLLAR/)
    // Refusal rolls the plaintext back untouched.
    expect(readFileSync(join(HOME, '.mxenv', '.env'), 'utf8')).toBe('GLOB_DOLLAR=ab$cd\n')
    expect(existsSync(join(HOME, '.mxenv', '.env.keys'))).toBe(false)
  }, 30_000)

  it('refuses a reserved DOTENV_PUBLIC_KEY* key up front with the key named', async () => {
    mkdirSync(join(HOME, '.mxenv'), { recursive: true })
    writeFileSync(join(HOME, '.mxenv', '.env'), 'DOTENV_PUBLIC_KEY_NOTE=userkey\n')

    const [unit] = discoverPlaintextUnits(layers(), HOME)
    const outcome = await executeUnit(unit, 'dotenvx', {}, HOME)
    expect(outcome.status).toBe('failed')
    expect(outcome.detail).toMatch(/rename key "DOTENV_PUBLIC_KEY_NOTE"/)
    expect(readFileSync(join(HOME, '.mxenv', '.env'), 'utf8')).toContain('userkey')
    expect(existsSync(join(HOME, '.mxenv', '.env.keys'))).toBe(false)
  }, 30_000)

  it('rejects a permissive global .env.keys at composition time', async () => {
    mkdirSync(join(HOME, '.mxenv'), { recursive: true })
    writeFileSync(join(HOME, '.mxenv', '.env'), `GLOB_B=${secretValue('gate')}\n`)
    const [unit] = discoverPlaintextUnits(layers(), HOME)
    await executeUnit(unit, 'dotenvx', {}, HOME)

    chmodSync(join(HOME, '.mxenv', '.env.keys'), 0o644)
    await expect(composeEnvironment(layers(), { homeDir: HOME, noInfisical: true })).rejects.toThrow('0600')
    // --allow-insecure-global waives it.
    const composition = await composeEnvironment(layers(), { homeDir: HOME, noInfisical: true, allowInsecureGlobal: true })
    expect(composition.environment.GLOB_B).toBeTruthy()
  }, 30_000)

  it('fails with install guidance when the dotenvx CLI cannot be found, leaving plaintext intact', async () => {
    writeProjectConfig({ sources: { plain: { provider: 'local', files: ['.env.local'] } } })
    const original = `NOCMD=${secretValue('nocmd')}\n`
    writeFileSync(join(TMP, '.env.local'), original)

    // ensureCommand probes <cwd>/node_modules/.bin first, then PATH — scrub both.
    const previousCwd = process.cwd()
    const previousPath = process.env.PATH
    process.chdir(TMP)
    process.env.PATH = '/usr/bin:/bin'
    try {
      const [unit] = discoverPlaintextUnits(layers(), HOME)
      const outcome = await executeUnit(unit, 'dotenvx', {}, HOME)
      expect(outcome.status).toBe('failed')
      expect(outcome.detail).toContain('dotenvx CLI')
      expect(readFileSync(join(TMP, '.env.local'), 'utf8')).toBe(original)
    } finally {
      process.chdir(previousCwd)
      process.env.PATH = previousPath
    }
  })

  it('warns when .env.keys lands unignored inside a git work tree', async () => {
    const repoDir = join(TMP, 'repo')
    mkdirSync(repoDir, { recursive: true })
    writeFileSync(join(repoDir, 'mxenv.config.json'), JSON.stringify({ sources: { plain: { provider: 'local', files: ['.env.local'] } } }))
    writeFileSync(join(repoDir, '.env.local'), `GITK=${secretValue('git')}\n`)
    spawnSync('git', ['init', '-q'], { cwd: repoDir })

    const [unit] = discoverPlaintextUnits(layers(repoDir), HOME)
    const outcome = await executeUnit(unit, 'dotenvx', {}, HOME)
    expect(outcome.status).toBe('migrated')
    expect(outcome.warnings.join('\n')).toContain('NOT git-ignored')

    writeFileSync(join(repoDir, '.gitignore'), '.env.keys\n')
    const warnings = (await import('../src/migrate')).gitIgnoreWarnings([join(repoDir, '.env.keys')])
    expect(warnings).toEqual([])
  }, 30_000)
})

describe('executeUnit -> keychain', () => {
  it('skips the global implicit unit with a dotenvx hint', async () => {
    mkdirSync(join(HOME, '.mxenv'), { recursive: true })
    writeFileSync(join(HOME, '.mxenv', '.env'), `GLOB_C=${secretValue('skip')}\n`)
    const [unit] = discoverPlaintextUnits(layers(), HOME)
    const outcome = await executeUnit(unit, 'keychain', {}, HOME)
    expect(outcome.status).toBe('skipped')
    expect(outcome.detail).toContain('dotenvx')
  })

  itDarwin('tolerates foreign accounts in the target service and warns', async () => {
    const keytar = await loadKeytar()
    if (!keytar) {
      console.warn('[mxenv test] keytar native module unavailable; keychain migration NOT exercised on this machine.')
      return
    }
    const service = `mxenv-test-${randomUUID()}`
    const value = secretValue('foreign')
    writeProjectConfig({
      sources: { plain: { provider: 'local', files: ['.env.local'] } },
      profiles: { dev: { sources: ['plain'] } },
      defaultProfile: 'dev',
    })
    writeFileSync(join(TMP, '.env.local'), `FK_A=${value}\n`)

    try {
      await keytar.setPassword(service, 'FOREIGN_ONE', 'not-mine')
      const [unit] = discoverPlaintextUnits(layers(), HOME)
      const outcome = await executeUnit(unit, 'keychain', { service }, HOME)
      // Subset verification: foreign account must NOT fail the migration.
      expect(outcome.status).toBe('migrated')
      expect(outcome.warnings.join('\n')).toContain('unrelated account')
      const composition = await composeEnvironment(layers(), { homeDir: HOME, noInfisical: true })
      expect(composition.environment.FK_A).toBe(value)
    } finally {
      for (const credential of await keytar.findCredentials(service)) {
        await keytar.deletePassword(service, credential.account)
      }
    }
  }, 30_000)

  itDarwin('rollback restores overwritten same-named accounts (no silent data loss)', async () => {
    const keytar = await loadKeytar()
    if (!keytar) {
      console.warn('[mxenv test] keytar native module unavailable; keychain migration NOT exercised on this machine.')
      return
    }
    const service = `mxenv-test-${randomUUID()}`
    const oldValue = secretValue('old')
    const newValue = secretValue('new')
    writeProjectConfig({
      sources: { plain: { provider: 'local', files: ['.env.local'] } },
      profiles: { dev: { sources: ['plain'] } },
      defaultProfile: 'dev',
    })
    writeFileSync(join(TMP, '.env.local'), `KC_A=${newValue}\n`)
    // Force failure AFTER setPassword: the config rewrite throws on a
    // read-only config file.
    chmodSync(join(TMP, 'mxenv.config.json'), 0o444)

    try {
      await keytar.setPassword(service, 'KC_A', oldValue)
      const [unit] = discoverPlaintextUnits(layers(), HOME)
      const outcome = await executeUnit(unit, 'keychain', { service }, HOME)
      expect(outcome.status).toBe('failed')
      // The pre-existing value must be written back — not deleted, not left
      // as the new value.
      expect(await keytar.getPassword(service, 'KC_A')).toBe(oldValue)
      // Plaintext restored.
      expect(readFileSync(join(TMP, '.env.local'), 'utf8')).toContain(newValue)
    } finally {
      chmodSync(join(TMP, 'mxenv.config.json'), 0o644)
      for (const credential of await keytar.findCredentials(service)) {
        await keytar.deletePassword(service, credential.account)
      }
    }
  }, 30_000)

  it('skips zero-key units instead of reporting a false migration', async () => {
    writeProjectConfig({
      sources: { plain: { provider: 'local', files: ['.env.local'] } },
      profiles: { dev: { sources: ['plain'] } },
      defaultProfile: 'dev',
    })
    writeFileSync(join(TMP, '.env.local'), '# no keys here\n')

    const [unit] = discoverPlaintextUnits(layers(), HOME)
    const outcome = await executeUnit(unit, 'dotenvx', {}, HOME)
    expect(outcome.status).toBe('skipped')
    expect(outcome.detail).toContain('no keys')
    // File untouched — dotenvx encrypt would report "no change" and leave
    // plaintext behind while claiming success.
    expect(readFileSync(join(TMP, '.env.local'), 'utf8')).toBe('# no keys here\n')
  })

  itDarwin('migrates a declared source into a keychain service and deletes plaintext', async () => {
    const keytar = await loadKeytar()
    if (!keytar) {
      // Explicit, loud skip — never a silent green: the keychain path went untested here.
      console.warn('[mxenv test] keytar native module unavailable; keychain migration NOT exercised on this machine.')
      return
    }
    const service = `mxenv-test-${randomUUID()}`
    const value = secretValue('kc')
    writeProjectConfig({
      sources: { plain: { provider: 'local', files: ['.env.local'] } },
      profiles: { dev: { sources: ['plain'] } },
      defaultProfile: 'dev',
    })
    writeFileSync(join(TMP, '.env.local'), `KC_A=${value}\n`)

    try {
      const [unit] = discoverPlaintextUnits(layers(), HOME)
      const outcome = await executeUnit(unit, 'keychain', { service }, HOME)
      expect(outcome.status).toBe('migrated')
      expect(existsSync(join(TMP, '.env.local'))).toBe(false)

      const rewritten = JSON.parse(readFileSync(join(TMP, 'mxenv.config.json'), 'utf8'))
      expect(rewritten.sources.plain).toEqual({ provider: 'os-keychain', service })

      const composition = await composeEnvironment(layers(), { homeDir: HOME, noInfisical: true })
      expect(composition.environment.KC_A).toBe(value)
    } finally {
      for (const credential of await keytar.findCredentials(service)) {
        await keytar.deletePassword(service, credential.account)
      }
    }
  }, 30_000)

  itDarwin('默认 keychain service 为 mxenv:<source名>；旧名 service 配置携带照读', async () => {
    const keytar = await loadKeytar()
    if (!keytar) {
      console.warn('[mxenv test] keytar native module unavailable; default keychain service NOT exercised on this machine.')
      return
    }
    const value = secretValue('kcdef')
    writeProjectConfig({
      sources: { plain: { provider: 'local', files: ['.env.local'] } },
      profiles: { dev: { sources: ['plain'] } },
      defaultProfile: 'dev',
    })
    writeFileSync(join(TMP, '.env.local'), `KC_DEF=${value}\n`)
    const defaultService = 'mxenv:plain'
    const legacyService = 'mx-env:legacy-src'
    try {
      const [unit] = discoverPlaintextUnits(layers(), HOME)
      const outcome = await executeUnit(unit, 'keychain', {}, HOME)
      expect(outcome.status).toBe('migrated')
      const rewritten = JSON.parse(readFileSync(join(TMP, 'mxenv.config.json'), 'utf8'))
      expect(rewritten.sources.plain).toEqual({ provider: 'os-keychain', service: defaultService })

      // 命名切换前的迁移产物：配置已记录旧名 service，读取照常、不重迁移。
      const legacyValue = secretValue('kclegacy')
      await keytar.setPassword(legacyService, 'KC_LEG', legacyValue)
      writeProjectConfig({
        sources: { legacy: { provider: 'os-keychain', service: legacyService } },
        profiles: { dev: { sources: ['legacy'] } },
        defaultProfile: 'dev',
      })
      const composition = await composeEnvironment(layers(), { homeDir: HOME, noInfisical: true })
      expect(composition.environment.KC_LEG).toBe(legacyValue)
    } finally {
      for (const service of [defaultService, legacyService]) {
        for (const credential of await keytar.findCredentials(service)) {
          await keytar.deletePassword(service, credential.account)
        }
      }
    }
  }, 30_000)
})

describe('migrate CLI e2e', () => {
  function cliEnv(extra: Record<string, string> = {}) {
    // Hermetic: strip shim/serve markers and provider env that could leak in
    // from the developer's shell and perturb composition behavior.
    const { MXENV_SHIM, MXENV_ENDPOINT, MXENV_TOKEN, MXENV_WARN_PLAINTEXT, DOTENV_KEY, INFISICAL_CLIENT_ID, INFISICAL_CLIENT_SECRET, ...base } = process.env
    return { ...base, HOME, SHELL: '/bin/zsh', ...extra }
  }

  function runCli(args: string[], extraEnv: Record<string, string> = {}) {
    return spawnSync('node', [CLI, ...args], { encoding: 'utf8', env: cliEnv(extraEnv), cwd: TMP })
  }

  /** The spawned CLI resolves the dotenvx CLI via <cwd>/node_modules/.bin. Symlinking
   *  pnpm's wrapper breaks it ($0-relative module resolution), so exec it by real path. */
  function linkDotenvx() {
    mkdirSync(join(TMP, 'node_modules', '.bin'), { recursive: true })
    const wrapper = join(TMP, 'node_modules', '.bin', 'dotenvx')
    writeFileSync(wrapper, `#!/bin/sh\nexec "${REPO_DOTENVX}" "$@"\n`)
    chmodSync(wrapper, 0o755)
  }

  it('plan mode is read-only and value-free', () => {
    const value = secretValue('plan')
    writeProjectConfig({ sources: { plain: { provider: 'local', files: ['.env.local'] } } })
    writeFileSync(join(TMP, '.env.local'), `PLAN_A=${value}\n`)

    const result = runCli(['migrate'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('unit: plain')
    expect(result.stdout).toContain('PLAN_A')
    expect(result.stdout).not.toContain(value)
    expect(readFileSync(join(TMP, '.env.local'), 'utf8')).toContain(value)
    expect(readdirSync(TMP).filter((file) => file.includes('backup'))).toEqual([])
  })

  it('full cycle: --to dotenvx migrates, later runs inject identical values, audit is value-free', () => {
    const value = secretValue('cycle')
    linkDotenvx()
    writeProjectConfig({
      sources: { plain: { provider: 'local', files: ['.env.local'] } },
      profiles: { dev: { sources: ['plain'] } },
      defaultProfile: 'dev',
    })
    writeFileSync(join(TMP, '.env.local'), `CYCLE_A=${value}\n`)

    const migrate = runCli(['migrate', '--to', 'dotenvx'])
    expect(migrate.status).toBe(0)
    expect(migrate.stdout).toContain('Migrated plain -> dotenvx')
    expect(migrate.stdout).not.toContain(value)

    // The child must receive EXACTLY the migrated value (not just any
    // redacted string) — compare in-process and print a boolean.
    const child = runCli(['run', '--no-infisical', '--', 'node', '-e', `console.log('match:' + (process.env.CYCLE_A === ${JSON.stringify(value)}))`])
    expect(child.status).toBe(0)
    expect(child.stdout).toContain('match:true')

    const day = new Date().toISOString().slice(0, 10)
    const audit = readFileSync(join(HOME, '.mxenv', 'audit', `${day}.jsonl`), 'utf8')
    expect(audit).toContain('"profile":"migrate"')
    expect(audit).toContain('CYCLE_A')
    expect(audit).not.toContain(value)

    const again = runCli(['migrate', '--to', 'dotenvx'])
    expect(again.status).toBe(0)
    expect(again.stdout).toContain('nothing to migrate')
  }, 40_000)

  it('--dry-run with --to prints the plan and writes nothing', () => {
    writeProjectConfig({ sources: { plain: { provider: 'local', files: ['.env.local'] } } })
    const original = `DRY=${secretValue('dry')}\n`
    writeFileSync(join(TMP, '.env.local'), original)

    const result = runCli(['migrate', '--to', 'dotenvx', '--dry-run'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('unit: plain')
    expect(readFileSync(join(TMP, '.env.local'), 'utf8')).toBe(original)
    expect(existsSync(join(TMP, '.env.keys'))).toBe(false)
  })

  it('rejects invalid flag combinations with actionable errors', () => {
    writeProjectConfig({ sources: { plain: { provider: 'local', files: ['.env.local'] } } })
    writeFileSync(join(TMP, '.env.local'), 'FLAG=x\n')

    expect(runCli(['migrate', '--to', 'bogus']).status).toBe(1)
    expect(runCli(['migrate', '--to', 'bogus']).stderr).toContain('dotenvx')
    const noSource = runCli(['migrate', '--to', 'keychain', '--service', 'svc'])
    expect(noSource.status).toBe(1)
    expect(noSource.stderr).toContain('--source')
    expect(runCli(['migrate', '--wirte']).status).toBe(1)
    const unknownSource = runCli(['migrate', '--source', 'nope'])
    expect(unknownSource.status).toBe(1)
    expect(unknownSource.stderr).toContain('nope')
  })

  it('refuses two units sharing one plaintext file before any write', () => {
    writeProjectConfig({
      sources: {
        a: { provider: 'local', files: ['shared.env'] },
        b: { provider: 'local', files: ['shared.env'] },
      },
      profiles: { dev: { sources: ['a', 'b'] } },
      defaultProfile: 'dev',
    })
    writeFileSync(join(TMP, 'shared.env'), `SHARED=${secretValue('shared')}\n`)

    const result = runCli(['migrate', '--to', 'keychain'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('shared.env')
    expect(result.stderr).toContain('"a"')
    expect(result.stderr).toContain('"b"')
    // Guard runs before any write: plaintext untouched, no backup files.
    expect(readFileSync(join(TMP, 'shared.env'), 'utf8')).toContain('SHARED=')
    expect(readdirSync(TMP).filter((file) => file.includes('backup'))).toEqual([])
  })

  it('sniff is not fooled by a plaintext file that merely mentions the markers', () => {
    // DOTENV_PUBLIC_KEY defined as a real key + "encrypted:" in a comment must
    // NOT route the global file through the dotenvx provider.
    mkdirSync(join(HOME, '.mxenv'), { recursive: true })
    const value = secretValue('sniff')
    const globalEnv = join(HOME, '.mxenv', '.env')
    writeFileSync(globalEnv, `# later we may use encrypted: values\nDOTENV_PUBLIC_KEY="not-a-marker"\nSNIFF_A=${value}\n`)
    chmodSync(globalEnv, 0o600) // the global implicit file carries the 0600 gate
    const result = runCli(['run', '--no-infisical', '--', 'node', '-e', 'console.log(process.env.SNIFF_A ? "got" : "missing")'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('got')
  }, 30_000)
})
