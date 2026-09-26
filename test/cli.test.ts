import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { writeFileSync, unlinkSync, existsSync, readFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const CLI = join(__dirname, '..', 'dist', 'cli.js')
const TMP = join(tmpdir(), 'mx-env-cli-test-' + Date.now())
const testValue = (label: string) => `mxenv_test_${label}_${randomUUID().replace(/-/g, '')}`

function run(args: string[], env?: Record<string, string>): string {
  const command = args[0]
  const needsNoInfisical = (command === 'run' || command === 'generate') && !args.includes('--no-infisical')
  const cliArgs = needsNoInfisical
    ? [command, '--no-infisical', ...args.slice(1)]
    : args

  return execFileSync('node', [CLI, ...cliArgs], {
    encoding: 'utf8',
    env: { ...process.env, ...env, HOME: join(TMP, 'home') },
    cwd: TMP,
  })
}

// ─── Setup ────────────────────────────────────────────────

mkdirSync(TMP, { recursive: true })

afterEach(() => {
  // 清理临时文件
  for (const f of ['.env.local', '.env.staging', 'editable.env', 'workflow-skill.md', 'mx-env.config.json']) {
    const p = join(TMP, f)
    if (existsSync(p)) unlinkSync(p)
  }
})

// ─── CLI 基本功能 ─────────────────────────────────────────

describe('CLI basic', () => {
  it('publishes mx-env and morphix-env as the same binary entry', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { bin: Record<string, string> }
    expect(manifest.bin['mx-env']).toBe('./dist/cli.js')
    expect(manifest.bin['morphix-env']).toBe(manifest.bin['mx-env'])
  })

  it('--help 输出帮助', () => {
    const out = run(['--help'])
    expect(out).toContain('mx-env')
    expect(out).toContain('Usage:')
  })

  it('--version 输出版本', () => {
    const out = run(['--version'])
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('未知命令报错（exit code 1）', () => {
    try {
      run(['unknown-cmd'])
      expect.unreachable()
    } catch (e: any) {
      // Unknown command 输出到 stderr，help 输出到 stdout
      const output = (e.stdout || '') + (e.stderr || '')
      expect(output).toContain('Unknown command')
    }
  })
})

// ─── mx-env run ───────────────────────────────────────────

describe('mx-env run', () => {
  it('注入 .env.local 变量到子进程', () => {
    writeFileSync(join(TMP, '.env.local'), 'MXTEST_RUN=injected\n')

    const out = run(['run', '--', 'node', '-e', 'console.log(process.env.MXTEST_RUN)'])
    expect(out).toContain('[REDACTED]')
    expect(out).not.toContain('injected')
  })

  it('指定 --env-file', () => {
    writeFileSync(join(TMP, '.env.staging'), 'MXTEST_STAGE=from-staging\n')

    const out = run(['run', '-f', '.env.staging', '--', 'node', '-e', 'console.log(process.env.MXTEST_STAGE)'])
    expect(out).toContain('[REDACTED]')
    expect(out).not.toContain('from-staging')
  })

  it('.env.local 覆盖已有 env', () => {
    writeFileSync(join(TMP, '.env.local'), 'MXTEST_OVERRIDE=local-wins\n')

    const out = run(
      ['run', '--', 'node', '-e', 'console.log(process.env.MXTEST_OVERRIDE)'],
      { MXTEST_OVERRIDE: 'original' }
    )
    expect(out).toContain('[REDACTED]')
    expect(out).not.toContain('local-wins')
  })

  it('非零退出时也会脱敏 child stdout 和 stderr', () => {
    writeFileSync(join(TMP, '.env.local'), 'MXTEST_FAILURE=hidden-on-failure\n')
    try {
      run(['run', '--', 'node', '-e', 'console.log(process.env.MXTEST_FAILURE);console.error(process.env.MXTEST_FAILURE);process.exit(7)'])
      expect.unreachable()
    } catch (error: any) {
      const output = `${error.stdout || ''}${error.stderr || ''}`
      expect(error.status).toBe(7)
      expect(output).toContain('[REDACTED]')
      expect(output).not.toContain('hidden-on-failure')
    }
  })

  it('没有 .env.local 时正常通过', () => {
    const out = run(['run', '--no-infisical', '--', 'node', '-e', 'console.log("ok")'])
    expect(out).toContain('ok')
  })

  it('没有子命令时报错', () => {
    try {
      run(['run'])
      expect.unreachable()
    } catch (e: any) {
      expect(e.stdout + e.stderr).toContain('No command specified')
    }
  })

  it('--verbose 仅显示 source 状态和 key 数量', () => {
    writeFileSync(join(TMP, '.env.local'), 'MXTEST_VERB=value-not-visible\n')

    const out = run(['run', '-v', '--', 'node', '-e', 'console.log("done")'])
    expect(out).toContain('__mx_legacy_local: loaded (1 keys)')
    expect(out).not.toContain('MXTEST_VERB')
    expect(out).not.toContain('value-not-visible')
  })
})

// ─── mx-env generate ─────────────────────────────────────

describe('mx-env generate', () => {
  it('生成 __env.js 包含公开变量', () => {
    const outDir = join(TMP, 'public')
    mkdirSync(outDir, { recursive: true })
    const outFile = join(outDir, '__env.js')

    run(
      ['generate', '-o', outFile],
      {
        NEXT_PUBLIC_MXTEST_GEN: 'gen-value',
        MXTEST_PRIVATE: 'should-not-appear',
      }
    )

    const content = readFileSync(outFile, 'utf8')
    expect(content).toContain('window.__ENV=')
    expect(content).toContain('NEXT_PUBLIC_MXTEST_GEN')
    expect(content).toContain('gen-value')
    expect(content).not.toContain('MXTEST_PRIVATE')
  })

  it('--filter 只包含指定前缀', () => {
    const outFile = join(TMP, 'filtered.js')

    run(
      ['generate', '-o', outFile, '--filter', 'VITE_'],
      {
        VITE_MXTEST_A: 'vite-val',
        NEXT_PUBLIC_MXTEST_B: 'next-val',
      }
    )

    const content = readFileSync(outFile, 'utf8')
    expect(content).toContain('VITE_MXTEST_A')
    expect(content).not.toContain('NEXT_PUBLIC_MXTEST_B')
  })
})

// ─── mx-env inspect ──────────────────────────────────────

describe('mx-env inspect', () => {
  it('显示 .env.local key 和 provenance，不显示任何值', () => {
    const longValue = testValue('inspect-long')
    const shortValue = testValue('inspect-short')
    writeFileSync(join(TMP, '.env.local'), `MXTEST_SECRET=${longValue}\nMXTEST_SHORT=${shortValue}\n`)

    const out = run(['inspect'])
    expect(out).toContain('MXTEST_SECRET — __mx_legacy_local (local)')
    expect(out).toContain('MXTEST_SHORT — __mx_legacy_local (local)')
    expect(out).not.toContain(longValue)
    expect(out).not.toContain(shortValue)
  })

  it('文件不存在时显示 source 缺失状态', () => {
    const out = run(['inspect', '-f', '.env.nonexistent'])
    expect(out).toContain('__mx_legacy_local (local) — missing-optional, 0 keys')
  })
})

// ─── mx-env.config.json ──────────────────────────────────

describe('config file integration', () => {
  it('从 config 读取 envFiles', () => {
    writeFileSync(join(TMP, 'mx-env.config.json'), JSON.stringify({
      envFiles: ['.env.staging'],
    }))
    writeFileSync(join(TMP, '.env.staging'), 'MXTEST_CFG=from-config\n')

    const out = run(['run', '--no-infisical', '--', 'node', '-e', 'console.log(process.env.MXTEST_CFG)'])
    expect(out).toContain('[REDACTED]')
    expect(out).not.toContain('from-config')
  })

  it('edit opens a value-free profile page and only exposes local values in the browser session', async () => {
    const initial = `mxenv_test_editor_${Date.now()}_initial`
    const replacement = `mxenv_test_editor_${Date.now()}_replacement`
    writeFileSync(join(TMP, 'editable.env'), `MXTEST_EDITOR=${initial}\n`)
    writeFileSync(join(TMP, 'mx-env.config.json'), JSON.stringify({
      sources: { local: { provider: 'local', files: ['editable.env'] } },
      profiles: { editable: { sources: ['local'] } },
    }))

    const output = run(['edit', '--profile', 'editable', '--no-infisical', '--print-editor-url'], { MX_ENV_NO_OPEN: '1' })
    const url = output.match(/Local editor URL: (http:\/\/[^\s]+)/)?.[1]
    expect(url).toBeTruthy()
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
    expect(output).not.toContain(initial)

    const profile = await fetch(url!).then((response) => response.text())
    expect(profile).toContain('MXTEST_EDITOR')
    expect(profile).not.toContain(initial)

    const source = await fetch(`${url}/source/local`).then((response) => response.text())
    expect(source).toContain(initial)

    const saved = await fetch(`${url}/source/local/local`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ fileIndex: '0', content: `MXTEST_EDITOR=${replacement}\n` }),
    }).then((response) => response.text())
    expect(saved).toContain('Saved')
    expect(readFileSync(join(TMP, 'editable.env'), 'utf8')).toContain(replacement)
  })

  it('edit rejects an unknown profile without starting an editor', () => {
    try {
      run(['edit', '--profile', 'does-not-exist', '--no-infisical'])
      expect.unreachable()
    } catch (error: any) {
      const output = `${error.stdout || ''}${error.stderr || ''}`
      expect(output).toContain('Unknown profile')
      expect(output).not.toContain('Opened local editor')
    }
  })

  it('doc generates a value-free Agent workflow Skill', () => {
    const sentinel = `mxenv_test_skill_${Date.now()}`
    const skill = join(TMP, 'workflow-skill.md')
    writeFileSync(join(TMP, '.env.local'), `MXTEST_SKILL=${sentinel}\n`)

    const output = run(['doc', '-o', skill, '--no-infisical'])
    const content = readFileSync(skill, 'utf8')
    expect(output).toContain('Generated value-free workflow Skill')
    expect(output).not.toContain(sentinel)
    expect(content).toContain('mx-env edit --profile <profile>')
    expect(content).toContain('MXTEST_SKILL')
    expect(content).not.toContain(sentinel)
  })
})
