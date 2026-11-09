import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'

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
