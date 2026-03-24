import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { writeFileSync, unlinkSync, existsSync, readFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const CLI = join(__dirname, '..', 'dist', 'cli.js')
const TMP = join(tmpdir(), 'mx-env-cli-test-' + Date.now())

function run(args: string[], env?: Record<string, string>): string {
  return execFileSync('node', [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    cwd: TMP,
  })
}

// ─── Setup ────────────────────────────────────────────────

mkdirSync(TMP, { recursive: true })

afterEach(() => {
  // 清理临时文件
  for (const f of ['.env.local', '.env.staging', 'mx-env.config.json']) {
    const p = join(TMP, f)
    if (existsSync(p)) unlinkSync(p)
  }
})

// ─── CLI 基本功能 ─────────────────────────────────────────

describe('CLI basic', () => {
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
    expect(out).toContain('injected')
  })

  it('指定 --env-file', () => {
    writeFileSync(join(TMP, '.env.staging'), 'MXTEST_STAGE=from-staging\n')

    const out = run(['run', '-f', '.env.staging', '--', 'node', '-e', 'console.log(process.env.MXTEST_STAGE)'])
    expect(out).toContain('from-staging')
  })

  it('.env.local 覆盖已有 env', () => {
    writeFileSync(join(TMP, '.env.local'), 'MXTEST_OVERRIDE=local-wins\n')

    const out = run(
      ['run', '--', 'node', '-e', 'console.log(process.env.MXTEST_OVERRIDE)'],
      { MXTEST_OVERRIDE: 'original' }
    )
    expect(out).toContain('local-wins')
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

  it('--verbose 显示变量名', () => {
    writeFileSync(join(TMP, '.env.local'), 'MXTEST_VERB=val\n')

    const out = run(['run', '-v', '--', 'node', '-e', 'console.log("done")'])
    expect(out).toContain('MXTEST_VERB')
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
  it('显示 .env.local 内容（脱敏）', () => {
    writeFileSync(join(TMP, '.env.local'), 'MXTEST_SECRET=supersecretvalue123\nMXTEST_SHORT=hi\n')

    const out = run(['inspect'])
    expect(out).toContain('MXTEST_SECRET=supe***')  // 脱敏
    expect(out).toContain('MXTEST_SHORT=hi')         // 短值不脱敏
  })

  it('文件不存在时提示', () => {
    const out = run(['inspect', '-f', '.env.nonexistent'])
    expect(out).toContain('not found or empty')
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
    expect(out).toContain('from-config')
  })
})
