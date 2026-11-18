import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

// Wave B：gui 已落地（panel-host）；global/host 仍骨架预留，--help 不得暴露它们。

const CLI = join(__dirname, '..', 'dist', 'cli.js')

function run(args: string[]): string {
  return execFileSync('node', [CLI, ...args], { encoding: 'utf8' })
}

function runCapture(args: string[]) {
  return spawnSync('node', [CLI, ...args], { encoding: 'utf8' })
}

describe('mxenv-cli face', () => {
  it('--help lists shell-init and hides the Wave B placeholders', () => {
    const out = run(['--help'])
    expect(out).toContain('mxenv-cli shell-init')
    expect(out).toContain('Usage:')
    // --no-global 是真实生效 flag，必须可发现（help 文档化不得触发 gate）。
    expect(out).toContain('--no-global')
    // gui 已实现须可发现；未实现命令（global/host）不得列出（占位只在
    // dispatch 里拦）。gate 按行首匹配，不做子串禁令。
    expect(out).toMatch(/^mxenv gui\b/m)
    expect(out).not.toMatch(/^\s+(global|host)\b/m)
  })

  it('routes gui subcommands (words land in positionals, not subArgs)', () => {
    // 回归：parseArgs 是 L2 逐字节 parity 拷贝（仅 run 有 subArgs 语义），
    // cmdGui 必须从 positionals 取子命令——否则 gui status 落进默认附着分支
    // 并派生 detached serve 链（0.16.0 实发缺陷）。
    const home = join(tmpdir(), `mxenv-cli-gui-route-${randomUUID()}`)
    const r = spawnSync('node', [CLI, 'gui', 'status'], { encoding: 'utf8', env: { ...process.env, HOME: home } })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('no running host session')
  })

  it('gui edit opens the requested project scope and rejects an unwired directory', { timeout: 15_000 }, async () => {
    const home = join(tmpdir(), `mxenv-cli-gui-edit-${randomUUID()}`)
    const project = join(home, 'project')
    mkdirSync(project, { recursive: true })
    const env = { ...process.env, HOME: home, MX_ENV_NO_OPEN: '1' }
    const missing = spawnSync('node', [CLI, 'gui', 'edit', project, '--print-editor-url'], { encoding: 'utf8', env })
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain('mxenv.config.json')

    writeFileSync(join(project, 'mxenv.config.json'), JSON.stringify({
      sources: { local: { provider: 'local', files: ['.env.local'], optional: true } },
      profiles: { default: ['local'] }, defaultProfile: 'default',
    }))
    try {
      const opened = spawnSync('node', [CLI, 'gui', 'edit', project, '--print-editor-url'], { encoding: 'utf8', env })
      expect(opened.status, opened.stderr).toBe(0)
      const url = new URL(opened.stdout.trim())
      expect(url.origin).toMatch(/^http:\/\/127\.0\.0\.1:/)
      expect(url.searchParams.get('scope')).toBe('project:project')
      expect((await fetch(url)).status).toBe(200)
    } finally {
      spawnSync('node', [CLI, 'gui', 'close'], { encoding: 'utf8', env })
    }
  })

  it('--version matches the package manifest', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version: string }
    expect(run(['--version']).trim()).toBe(manifest.version)
  })

  it('reserved Wave B commands fail as not implemented', () => {
    for (const command of ['global', 'host']) {
      const result = runCapture([command])
      expect(result.status, command).toBe(1)
      expect(result.stderr, command).toContain('not implemented')
    }
  })

  it('shell-init --help shows help and exits 0 (subcommand help, 0.12.1)', () => {
    const result = runCapture(['shell-init', '--help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('mxenv-cli shell-init')
    expect(result.stderr).not.toContain('unrecognized flag')
  })

  it('project commands get a "run it inside a project" hint (0.12.1)', () => {
    const result = runCapture(['run'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('project command from @morphixai/mxenv')
    expect(result.stderr).toContain('npx mxenv run')
  })

  it('unknown commands fail with help on stderr/stdout', () => {
    const result = runCapture(['explode'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Unknown command')
  })
})
