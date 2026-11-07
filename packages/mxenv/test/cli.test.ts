import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import { writeFileSync, unlinkSync, existsSync, readFileSync, mkdirSync, rmSync, symlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const CLI = join(__dirname, '..', 'dist', 'cli.js')
const TMP = join(tmpdir(), 'mxenv-cli-test-' + Date.now())
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
  for (const f of ['.env.local', '.env.staging', 'editable.env', 'workflow-skill.md', 'mxenv.config.json']) {
    const p = join(TMP, f)
    if (existsSync(p)) unlinkSync(p)
  }
  rmSync(join(TMP, '.claude'), { recursive: true, force: true })
  rmSync(join(TMP, 'home', '.claude'), { recursive: true, force: true })
  rmSync(join(TMP, 'home', '.trellis'), { recursive: true, force: true })
})

// ─── CLI 基本功能 ─────────────────────────────────────────

describe('CLI basic', () => {
  it('publishes mxenv as the primary bin, with mx-env/morphix-env as deprecated aliases', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { bin: Record<string, string> }
    expect(manifest.bin['mxenv']).toBe('./dist/cli.js')
    expect(manifest.bin['mx-env']).toBe(manifest.bin['mxenv'])
    expect(manifest.bin['morphix-env']).toBe(manifest.bin['mxenv'])
  })

  it('旧名 bin 调用行为等价且 stderr 一行弃用提示（export stdout 纯净）', () => {
    writeFileSync(join(TMP, '.env.local'), 'MXTEST_ALIAS=alias-value-visible-in-export\n')
    const binDir = join(TMP, 'bin')
    mkdirSync(binDir, { recursive: true })
    for (const legacy of ['mx-env', 'morphix-env']) {
      const link = join(binDir, legacy)
      rmSync(link, { force: true })
      symlinkSync(CLI, link)
      const result = spawnSync('node', [link, 'export', '--no-infisical'], {
        encoding: 'utf8',
        env: { ...process.env, HOME: join(TMP, 'home') },
        cwd: TMP,
      })
      expect(result.status).toBe(0)
      const lines = result.stdout.trim().split('\n').filter(Boolean)
      expect(lines.length).toBeGreaterThan(0)
      for (const line of lines) expect(line.startsWith('export ')).toBe(true)
      expect(result.stderr).toContain('已弃用')
      expect(result.stdout).not.toContain('已弃用')
    }
  })

  it('新名调用（mxenv / 直接 node dist/cli.js）不出弃用提示', () => {
    const binDir = join(TMP, 'bin')
    mkdirSync(binDir, { recursive: true })
    const link = join(binDir, 'mxenv')
    rmSync(link, { force: true })
    symlinkSync(CLI, link)
    for (const argv1 of [link, CLI]) {
      const result = spawnSync('node', [argv1, '--version'], {
        encoding: 'utf8',
        env: { ...process.env, HOME: join(TMP, 'home') },
        cwd: TMP,
      })
      expect(result.status).toBe(0)
      expect(result.stderr).not.toContain('已弃用')
    }
  })

  it('--help 输出帮助', () => {
    const out = run(['--help'])
    expect(out).toContain('mxenv')
    expect(out).toContain('Usage:')
  })

  it('--version 输出与 package.json 一致的版本', () => {
    const out = run(['--version'])
    const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version: string }
    // Version is derived from package.json at build time; drift here means the
    // published package reports a stale --version.
    expect(out.trim()).toBe(manifest.version)
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

// ─── mxenv run ───────────────────────────────────────────

describe('mxenv run', () => {
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

// ─── mxenv generate ─────────────────────────────────────

describe('mxenv generate', () => {
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

// ─── mxenv inspect ──────────────────────────────────────

describe('mxenv inspect', () => {
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

// ─── plaintext dev-only 标记与可选提醒（issue #7）─────────

describe('plaintext marking and optional reminder', () => {
  // execFileSync 不返成功路径的 stderr；提醒测试需要同时看两侧。
  function runCapture(args: string[], env?: Record<string, string>) {
    // Hermetic like migrate.test.ts: strip shim/serve markers and provider env
    // so a shimmed dev shell cannot perturb the assertions.
    const { MXENV_SHIM, MXENV_ENDPOINT, MXENV_TOKEN, MXENV_WARN_PLAINTEXT, DOTENV_KEY, INFISICAL_CLIENT_ID, INFISICAL_CLIENT_SECRET, ...base } = process.env
    return spawnSync('node', [CLI, ...args], {
      encoding: 'utf8',
      env: { ...base, ...env, HOME: join(TMP, 'home') },
      cwd: TMP,
    })
  }

  it('inspect 对 local 明文源追加 [plaintext, dev-only] 标识', () => {
    writeFileSync(join(TMP, '.env.local'), `MXTEST_MARK=${testValue('mark')}\n`)
    const out = run(['inspect'])
    expect(out).toContain('__mx_legacy_local (local) — loaded, 1 keys [plaintext, dev-only]')
  })

  it('inspect 不标记 dotenvx 源', () => {
    writeFileSync(join(TMP, 'mxenv.config.json'), JSON.stringify({
      sources: { enc: { provider: 'dotenvx', files: ['.env.missing'], optional: true } },
      profiles: { dev: { sources: ['enc'] } },
      defaultProfile: 'dev',
    }))
    const out = run(['inspect'])
    const dotenvxLine = out.split('\n').find((line) => line.includes('(dotenvx)'))
    expect(dotenvxLine).toBeTruthy()
    expect(dotenvxLine).not.toContain('dev-only')
  })

  it('组合路径默认不提醒明文', () => {
    writeFileSync(join(TMP, '.env.local'), `MXTEST_QUIET=${testValue('quiet')}\n`)
    const result = runCapture(['run', '--no-infisical', '--', 'node', '-e', 'process.exit(0)'])
    expect(result.status).toBe(0)
    expect(result.stderr).not.toContain('Plaintext local source')
  })

  it('--warn-plaintext 在 stderr 提醒一次并指向 migrate', () => {
    writeFileSync(join(TMP, '.env.local'), `MXTEST_WARN=${testValue('warn')}\n`)
    const result = runCapture(['run', '--no-infisical', '--warn-plaintext', '--', 'node', '-e', 'process.exit(0)'])
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('Plaintext local source')
    expect(result.stderr).toContain('mxenv migrate')
  })

  it('MXENV_WARN_PLAINTEXT=1 等效于 flag（shim 场景传不了 flag）', () => {
    writeFileSync(join(TMP, '.env.local'), `MXTEST_WARNENV=${testValue('warnenv')}\n`)
    const result = runCapture(['run', '--no-infisical', '--', 'node', '-e', 'process.exit(0)'], { MXENV_WARN_PLAINTEXT: '1' })
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('Plaintext local source')
  })

  it('export 开提醒时 stdout 保持 eval-able（提醒只走 stderr）', () => {
    writeFileSync(join(TMP, '.env.local'), `MXTEST_EXWARN=${testValue('exwarn')}\n`)
    const result = runCapture(['export', '--no-infisical', '--warn-plaintext'])
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('Plaintext local source')
    const stdoutLines = result.stdout.trim().split('\n').filter(Boolean)
    expect(stdoutLines.length).toBeGreaterThan(0)
    for (const line of stdoutLines) expect(line.startsWith('export ')).toBe(true)
  })
})

// ─── mxenv.config.json ─────────────────────────────────

describe('config file integration', () => {
  it('从 config 读取 envFiles', () => {
    writeFileSync(join(TMP, 'mxenv.config.json'), JSON.stringify({
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
    writeFileSync(join(TMP, 'mxenv.config.json'), JSON.stringify({
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

    // The session stays open after a save; end it explicitly to avoid leaking
    // a detached editor until its TTL.
    await fetch(url!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ action: 'close' }),
    })
  })

  it('bare edit opens the default composition without --profile/--source', async () => {
    const output = run(['edit', '--no-infisical', '--print-editor-url'], { MX_ENV_NO_OPEN: '1' })
    const url = output.match(/Local editor URL: (http:\/\/[^\s]+)/)?.[1]
    expect(url).toBeTruthy()

    const index = await fetch(url!).then((response) => response.text())
    // Assert the server-rendered <title>: component copy is inlined in every
    // page's client bundle and cannot discriminate pages.
    expect(index).toContain('<title>mxenv editor</title>')

    await fetch(url!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ action: 'close' }),
    })
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
    expect(content).toContain('mxenv edit')
    expect(content).toContain('--profile <profile>')
    expect(content).toContain('MXTEST_SKILL')
    expect(content).not.toContain(sentinel)
  })
})

// ─── mxenv skill ─────────────────────────────────────────

describe('mxenv skill', () => {
  const projectSkill = () => join(TMP, '.claude', 'skills', 'mxenv', 'SKILL.md')

  it('--help lists the skill command and targets', () => {
    const out = run(['--help'])
    expect(out).toContain('skill install')
    expect(out).toContain('--target <scope>')
  })

  it('install --target project writes the shipped template', () => {
    const out = run(['skill', 'install', '--target', 'project'])
    expect(out).toContain('Installed skill')
    const content = readFileSync(projectSkill(), 'utf8')
    expect(content).toContain('name: mxenv')
    expect(content).toContain('mxenv edit [--profile dev | --source X]')
    expect(content).toContain('os-keychain')
    // The generic template carries no project data: it must never grow a value.
    expect(content).not.toContain('=mxenv_test_')
  })

  it('re-install is idempotent when the template is unchanged', () => {
    run(['skill', 'install', '--target', 'project'])
    const out = run(['skill', 'install', '--target', 'project'])
    expect(out).toContain('already installed and up to date')
  })

  it('refuses to overwrite a modified skill without --force, then --force replaces it', () => {
    run(['skill', 'install', '--target', 'project'])
    writeFileSync(projectSkill(), 'user-customized skill')

    try {
      run(['skill', 'install', '--target', 'project'])
      expect.unreachable()
    } catch (error: any) {
      expect(`${error.stdout || ''}${error.stderr || ''}`).toContain('--force')
    }
    expect(readFileSync(projectSkill(), 'utf8')).toBe('user-customized skill')

    const out = run(['skill', 'install', '--target', 'project', '--force'])
    expect(out).toContain('Installed skill')
    expect(readFileSync(projectSkill(), 'utf8')).toContain('name: mxenv')
  })

  it('install --target global and --target trellis write into the home stores', () => {
    run(['skill', 'install', '--target', 'global'])
    expect(readFileSync(join(TMP, 'home', '.claude', 'skills', 'mxenv', 'SKILL.md'), 'utf8')).toContain('name: mxenv')

    const out = run(['skill', 'install', '--target', 'trellis'])
    expect(out).toContain('trellis sync skills')
    expect(readFileSync(join(TMP, 'home', '.trellis', 'skills', 'mxenv', 'SKILL.md'), 'utf8')).toContain('name: mxenv')
  })

  it('rejects an unknown target and unknown subcommand', () => {
    try {
      run(['skill', 'install', '--target', 'nowhere'])
      expect.unreachable()
    } catch (error: any) {
      expect(`${error.stdout || ''}${error.stderr || ''}`).toContain('Unknown skill target')
    }
    try {
      run(['skill', 'explode'])
      expect.unreachable()
    } catch (error: any) {
      expect(`${error.stdout || ''}${error.stderr || ''}`).toContain('Unknown skill subcommand')
    }
  })

  it('show reports per-target install status', () => {
    run(['skill', 'install', '--target', 'project'])
    const out = run(['skill', 'show'])
    expect(out).toContain('project: installed (matches this version)')
    expect(out).toContain('global: not installed')
  })
})

// ─── mxenv audit（读写同目录 e2e，review S1）────────────────

describe('mxenv audit', () => {
  it('run 产生审计后 audit 命令能读到（值不落输出）', () => {
    const auditValue = testValue('audit-e2e')
    writeFileSync(join(TMP, '.env.local'), `MXTEST_AUDIT=${auditValue}\n`)

    run(['run', '--', 'node', '-e', 'process.exit(0)'])

    // 真正执行 audit 命令：读面漏切旧目录时此用例必红（写面落 ~/.mxenv/audit）。
    const out = run(['audit'])
    expect(out).toContain('"outcome"')
    expect(out).toContain('MXTEST_AUDIT')
    expect(out).not.toContain(auditValue)

    const tail = run(['audit', 'tail'])
    expect(tail).toContain('"outcome"')
    expect(tail).not.toContain(auditValue)
  })
})
