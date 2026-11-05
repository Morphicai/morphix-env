import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import {
  detectHandmadeReservedShims,
  findShadowedCommands,
  removeAllShims,
  removeRcBlock,
  renderShimScript,
  RESERVED_SHIM_NAMES,
  resolveShimCommands,
  shimsDir,
  stripShimsFromPath,
  upsertRcBlock,
  validateShimList,
  writeShims,
  SHIM_MARKER,
} from '../src/shims'
import type { ConfigLayers } from '../src/config'

const CLI = join(__dirname, '..', 'dist', 'cli.js')
const TMP = join(tmpdir(), `mx-env-shims-${randomUUID()}`)
const HOME = join(TMP, 'home')

function layers(globalShims: unknown, projectShims: unknown): ConfigLayers {
  const mk = (shims: unknown) => ({ config: { shims } as never, path: '/x', baseDir: '/x', exists: true })
  return { global: mk(globalShims), project: mk(projectShims), globalEnvFile: '/x/.env' }
}

function writeBin(dir: string, name: string, body: string): string {
  const path = join(dir, name)
  writeFileSync(path, body)
  chmodSync(path, 0o755)
  return path
}

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(HOME, { recursive: true })
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('validateShimList', () => {
  it('accepts a clean list', () => {
    expect(validateShimList(['node', 'pnpm', 'my-tool.v2'], 'cfg')).toEqual([])
    expect(validateShimList(undefined, 'cfg')).toEqual([])
  })

  it('rejects non-arrays, empty entries, separators, whitespace', () => {
    expect(validateShimList('node', 'cfg')[0]).toContain('array')
    expect(validateShimList([''], 'cfg')[0]).toContain('non-empty')
    expect(validateShimList([42], 'cfg')[0]).toContain('non-empty')
    expect(validateShimList(['../evil'], 'cfg')[0]).toContain('../evil')
    expect(validateShimList(['a\\b'], 'cfg')[0]).toContain('a\\b')
    expect(validateShimList(['a b'], 'cfg')[0]).toContain('a b')
    expect(validateShimList(['-lead'], 'cfg')[0]).toContain('-lead')
  })

  it('rejects reserved names case-insensitively and case-insensitive duplicates', () => {
    expect(validateShimList(['run'], 'cfg')[0]).toContain('reserved')
    expect(validateShimList(['RUN'], 'cfg')[0]).toContain('reserved')
    expect(validateShimList(['mx-env'], 'cfg')[0]).toContain('reserved')
    expect(validateShimList(['Node', 'node'], 'cfg')[0]).toContain('duplicate')
  })
})

describe('resolveShimCommands', () => {
  it('unions global and project lists with case-insensitive dedupe', () => {
    expect(resolveShimCommands(layers(['pnpm'], ['python']))).toEqual(['pnpm', 'python'])
    expect(resolveShimCommands(layers(['Node'], ['node', 'npm']))).toEqual(['Node', 'npm'])
    expect(resolveShimCommands(layers(undefined, ['python']))).toEqual(['python'])
    expect(resolveShimCommands(layers(['a'], ['b']), false)).toEqual(['b'])
  })
})

describe('writeShims / removeAllShims', () => {
  it('writes executable marked shims, converges removals, never touches handmade files', () => {
    const first = writeShims(['pnpm', 'node'], HOME)
    expect(first.written.sort()).toEqual(['node', 'pnpm'])
    const shimPath = join(shimsDir(HOME), 'pnpm')
    const content = readFileSync(shimPath, 'utf8')
    expect(content).toContain(SHIM_MARKER)
    expect(content).toContain('command -v mx-env')
    expect(content).toContain('MXENV_SHIM=1 exec mx-env run -- pnpm "$@"')
    expect(() => chmodSync(shimPath, 0o755)).not.toThrow()

    // Idempotent: second run writes nothing.
    const second = writeShims(['pnpm', 'node'], HOME)
    expect(second.written).toEqual([])
    expect(second.removed).toEqual([])
    expect(readFileSync(shimPath, 'utf8')).toBe(content)

    // A handmade file is preserved even when undeclared.
    writeBin(shimsDir(HOME), 'mine', '#!/bin/sh\necho mine\n')
    const third = writeShims(['pnpm'], HOME)
    expect(third.removed).toEqual(['node'])
    expect(existsSync(join(shimsDir(HOME), 'mine'))).toBe(true)
    expect(existsSync(join(shimsDir(HOME), 'node'))).toBe(false)

    // A handmade file holding a DECLARED name is skipped and reported, never
    // overwritten.
    writeBin(shimsDir(HOME), 'pnpm', '#!/bin/sh\necho handmade-pnpm\n')
    const fourth = writeShims(['pnpm'], HOME)
    expect(fourth.skipped).toEqual(['pnpm'])
    expect(readFileSync(join(shimsDir(HOME), 'pnpm'), 'utf8')).toContain('handmade-pnpm')

    // A symlink is never followed: it is replaced with a regular shim file and
    // the link target is untouched.
    const victim = join(TMP, 'victim.txt')
    writeFileSync(victim, 'precious')
    rmSync(join(shimsDir(HOME), 'pnpm'))
    symlinkSync(victim, join(shimsDir(HOME), 'pnpm'))
    const fifth = writeShims(['pnpm'], HOME)
    expect(fifth.written).toEqual(['pnpm'])
    expect(readFileSync(victim, 'utf8')).toBe('precious')
    expect(lstatSync(join(shimsDir(HOME), 'pnpm')).isSymbolicLink()).toBe(false)

    // removeAllShims removes only marked files.
    const removed = removeAllShims(HOME)
    expect(removed).toEqual(['pnpm'])
    expect(existsSync(join(shimsDir(HOME), 'mine'))).toBe(true)
  })

  it('flags handmade files that shadow reserved names', () => {
    mkdirSync(shimsDir(HOME), { recursive: true })
    writeBin(shimsDir(HOME), 'mx-env', '#!/bin/sh\necho handmade\n')
    writeShims(['pnpm'], HOME)
    expect(detectHandmadeReservedShims(HOME)).toEqual(['mx-env'])
    // A tool-generated shim is never flagged (and reserved names cannot be generated).
    expect(detectHandmadeReservedShims(HOME)).not.toContain('pnpm')
  })
})

describe('rc block', () => {
  it('upserts and removes idempotently without touching other content', () => {
    const rc = join(TMP, '.zshrc')
    writeFileSync(rc, '# user content\nexport EDITOR=vim\n')

    expect(upsertRcBlock(rc, HOME)).toBe('added')
    const once = readFileSync(rc, 'utf8')
    expect(once).toContain('# user content')
    expect(upsertRcBlock(rc, HOME)).toBe('unchanged')
    expect(readFileSync(rc, 'utf8')).toBe(once)

    expect(removeRcBlock(rc)).toBe('removed')
    const after = readFileSync(rc, 'utf8')
    expect(after).not.toContain('mx-env shims')
    expect(after).toContain('export EDITOR=vim')
    expect(removeRcBlock(rc)).toBe('absent')
  })
})

describe('stripShimsFromPath', () => {
  it('removes every entry resolving to the shims dir and preserves the rest', () => {
    const dir = shimsDir(HOME)
    mkdirSync(dir, { recursive: true })
    const path = `/usr/bin:${dir}:/bin:${dir}/`
    const stripped = stripShimsFromPath(path, HOME)
    expect(stripped).toBe('/usr/bin:/bin')
  })

  it('keeps a clean PATH untouched, tolerates missing dirs, preserves empty entries', () => {
    expect(stripShimsFromPath('/usr/bin:/bin', HOME)).toBe('/usr/bin:/bin')
    expect(stripShimsFromPath(undefined, HOME)).toBeUndefined()
    // An empty PATH entry means "current directory" in POSIX exec semantics —
    // it must survive the filter.
    expect(stripShimsFromPath('/usr/bin::/bin', HOME)).toBe('/usr/bin::/bin')
  })
})

describe('findShadowedCommands', () => {
  it('reports commands that do not resolve to their shim', () => {
    const realbin = join(TMP, 'realbin')
    mkdirSync(realbin, { recursive: true })
    writeBin(realbin, 'faketool', '#!/bin/sh\nexit 0\n')
    writeShims(['faketool', 'othertool'], HOME)
    const shimDir = shimsDir(HOME)

    // Shim first: nothing shadowed, nothing absent.
    expect(findShadowedCommands(['faketool'], `${shimDir}:${realbin}`, HOME)).toEqual({ absent: [], shadowed: [] })
    // Real binary first: shadowed.
    expect(findShadowedCommands(['faketool'], `${realbin}:${shimDir}`, HOME)).toEqual({ absent: [], shadowed: ['faketool'] })
    // Command with a shim but no real binary anywhere on PATH: absent.
    expect(findShadowedCommands(['othertool'], realbin, HOME)).toEqual({ absent: ['othertool'], shadowed: [] })
  })
})

describe('reserved-name parity with the CLI dispatch table', () => {
  it('every case label in cli.ts main() dispatch is reserved', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'cli.ts'), 'utf8')
    const labels = [...source.matchAll(/case '([^']+)'/g)].map((match) => match[1])
    expect(labels.length).toBeGreaterThan(10)
    for (const label of labels) {
      if (label === '--help' || label === '-h' || label === '--version') continue
      expect(RESERVED_SHIM_NAMES).toContain(label)
    }
  })
})

describe('shell-init e2e', () => {
  let realbin: string
  let bindir: string
  let PATH_BASE: string

  function cliEnv(extra: Record<string, string> = {}) {
    // Hermetic: never let an outer shim/serve marker leak into the child CLI.
    const { MXENV_SHIM, MXENV_ENDPOINT, MXENV_TOKEN, ...base } = process.env
    return { ...base, HOME, SHELL: '/bin/zsh', PATH: `${bindir}:${PATH_BASE}`, ...extra }
  }

  function runCli(args: string[], extraEnv: Record<string, string> = {}) {
    return spawnSync('node', [CLI, ...args], { encoding: 'utf8', env: cliEnv(extraEnv), cwd: TMP })
  }

  beforeEach(() => {
    realbin = join(TMP, 'realbin')
    bindir = join(TMP, 'bindir')
    mkdirSync(realbin, { recursive: true })
    mkdirSync(bindir, { recursive: true })
    PATH_BASE = process.env.PATH || '/usr/bin:/bin'
    // A fake `mx-env` on PATH delegating to the freshly built CLI.
    writeBin(bindir, 'mx-env', `#!/bin/sh\nexec ${process.execPath} ${JSON.stringify(CLI)} "$@"\n`)
    // The real tool the shim will wrap. Prints value-free probes only.
    writeBin(realbin, 'faketool', `#!/bin/sh
echo "secret_present:$( [ -n "$MXTEST_E2E" ] && echo yes || echo no )"
echo "resolves_to:$(command -v faketool)"
echo "shim_marker:$(printenv MXENV_SHIM >/dev/null 2>&1 && echo set || echo unset)"
exit "\${1:-0}"
`)
    mkdirSync(join(HOME, '.mx-env'), { recursive: true })
    writeFileSync(join(HOME, '.mx-env', 'config.json'), JSON.stringify({ shims: ['faketool'] }))
    writeFileSync(join(TMP, 'mx-env.config.json'), JSON.stringify({
      sources: { local: { provider: 'local', files: ['.env.local'] } },
      profiles: { dev: { sources: ['local'] } },
      defaultProfile: 'dev',
    }))
    writeFileSync(join(TMP, '.env.local'), `MXTEST_E2E=mxenv_e2e_${randomUUID().replace(/-/g, '')}\n`)
  })

  it('full cycle: init → bare invocation injects, resolves to real tool inside, audit marks via=shim', () => {
    const init = runCli(['shell-init'])
    expect(init.status).toBe(0)
    expect(init.stdout).toContain('export PATH=')
    const shimPath = join(shimsDir(HOME), 'faketool')
    expect(existsSync(shimPath)).toBe(true)

    const viaShimPath = `${shimsDir(HOME)}:${bindir}:${realbin}:${PATH_BASE}`
    const bare = spawnSync(shimPath, [], { encoding: 'utf8', env: cliEnv({ PATH: viaShimPath }), cwd: TMP })
    expect(bare.status).toBe(0)
    expect(bare.stdout).toContain('secret_present:yes')
    expect(bare.stdout).toContain(`resolves_to:${join(realbin, 'faketool')}`)
    expect(bare.stdout).toContain('shim_marker:unset')
    expect(bare.stderr).not.toContain('MXTEST_E2E=')

    // Exit code passthrough.
    const failing = spawnSync(shimPath, ['3'], { encoding: 'utf8', env: cliEnv({ PATH: viaShimPath }), cwd: TMP })
    expect(failing.status).toBe(3)

    // Audit: via=shim, key name present, value absent.
    const day = new Date().toISOString().slice(0, 10)
    const audit = readFileSync(join(HOME, '.mx-env', 'audit', `${day}.jsonl`), 'utf8')
    expect(audit).toContain('"via":"shim"')
    expect(audit).toContain('MXTEST_E2E')
    const secret = readFileSync(join(TMP, '.env.local'), 'utf8').trim().split('=')[1]
    expect(audit).not.toContain(secret)
  }, 30_000)

  it('composition-time recursion guard: a plugin provider calling the shimmed command does not recurse', () => {
    // The plugin invokes `faketool` internally; if run failed to sanitize PATH
    // before composition, the plugin would re-enter the shim forever.
    writeBin(bindir, 'mx-env-provider-faketest', `#!/bin/sh
faketool >/dev/null 2>&1 || exit 1
printf '%s' "plugval_$1"
`)
    writeFileSync(join(TMP, 'mx-env.config.json'), JSON.stringify({
      sources: { plug: { provider: 'plugin', plugin: 'faketest', keys: ['MXTEST_PLUG'] } },
      profiles: { dev: { sources: ['plug'] } },
      defaultProfile: 'dev',
    }))
    expect(runCli(['shell-init']).status).toBe(0)
    const viaShimPath = `${shimsDir(HOME)}:${bindir}:${realbin}:${PATH_BASE}`
    const result = spawnSync(join(shimsDir(HOME), 'faketool'), [], {
      encoding: 'utf8', env: cliEnv({ PATH: viaShimPath }), cwd: TMP, timeout: 25_000,
    })
    // Completion itself is the assertion: without boot-time PATH sanitization
    // this recurses shim → run → plugin → faketool → shim until the timeout.
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(`resolves_to:${join(realbin, 'faketool')}`)
  }, 40_000)

  it('init lifecycle: write idempotent, remove idempotent, unknown flag rejected', () => {
    expect(runCli(['shell-init']).status).toBe(0)
    const rc = join(HOME, '.zshrc')

    expect(runCli(['shell-init', '--write']).status).toBe(0)
    const once = readFileSync(rc, 'utf8')
    expect(once).toContain('# >>> mx-env shims >>>')
    expect(runCli(['shell-init', '--write']).status).toBe(0)
    expect(readFileSync(rc, 'utf8')).toBe(once)

    expect(runCli(['shell-init', '--remove']).status).toBe(0)
    expect(readFileSync(rc, 'utf8')).not.toContain('mx-env shims')
    expect(readdirSync(shimsDir(HOME))).toEqual([])
    expect(runCli(['shell-init', '--remove']).status).toBe(0)

    const bad = runCli(['shell-init', '--wirte'])
    expect(bad.status).toBe(1)
    expect(bad.stderr).toContain('unrecognized flag')
  }, 30_000)

  it('invalid shims: shell-init hard-fails, run only warns and still injects', () => {
    writeFileSync(join(TMP, 'mx-env.config.json'), JSON.stringify({
      shims: ['run'],
      sources: { local: { provider: 'local', files: ['.env.local'] } },
      profiles: { dev: { sources: ['local'] } },
      defaultProfile: 'dev',
    }))
    const init = runCli(['shell-init'])
    expect(init.status).toBe(1)
    expect(init.stderr).toContain('reserved')

    const run = runCli(['run', '--no-infisical', '--', 'node', '-e', 'process.exit(process.env.MXTEST_E2E ? 0 : 7)'])
    expect(run.status).toBe(0)
    expect(run.stderr).toContain('Ignoring invalid "shims"')
  }, 30_000)

  it('shim without mx-env on PATH fails with an actionable message and exit 127', () => {
    expect(runCli(['shell-init']).status).toBe(0)
    const bareNoMx = spawnSync(join(shimsDir(HOME), 'faketool'), [], {
      encoding: 'utf8', env: cliEnv({ PATH: `${realbin}:/usr/bin:/bin` }), cwd: TMP,
    })
    expect(bareNoMx.status).toBe(127)
    expect(bareNoMx.stderr).toContain('shell-init --remove')
  }, 20_000)

  it('warns when a declared command is shadowed by an earlier PATH entry', () => {
    const init = runCli(['shell-init'], { PATH: `${realbin}:${bindir}:${PATH_BASE}` })
    expect(init.status).toBe(0)
    expect(init.stderr).toContain('resolve to a different executable ahead of their shim')
  }, 20_000)
})
