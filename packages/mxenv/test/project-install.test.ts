import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from 'fs'
import { dirname, join, delimiter } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

// 3.3 项目态完整可用（spec package-boundary 验收口径①）：
// devDep 安装（真实 tarball → npm install）+ 无全局 CLI 场景跑通 run/export/
// inspect/来源管理/migrate/编辑，并显式断言零全局依赖。
// 打包+安装只做一次（beforeAll，慢属预期）；工作项目=消费项目本身，
// 每用例清理产物（保留 node_modules/package.json 清单）。

const SCRATCH = join(tmpdir(), `mx-env-project-install-${randomUUID()}`)
const TARBALLS = join(SCRATCH, 'tarballs')
const CONSUMER = join(SCRATCH, 'consumer')
const HOME = join(SCRATCH, 'home')
const BIN_DIR = join(CONSUMER, 'node_modules', '.bin')
const CLI = join(BIN_DIR, 'mx-env')
const PKG_MXENV = join(__dirname, '..')
const PKG_CORE = join(PKG_MXENV, '..', 'mxenv-core')

const manifest = JSON.parse(readFileSync(join(PKG_MXENV, 'package.json'), 'utf8')) as {
  name: string
  version: string
  bin: Record<string, string>
}
const coreManifest = JSON.parse(readFileSync(join(PKG_CORE, 'package.json'), 'utf8')) as {
  name: string
  version: string
}

const secret = (label: string) => `mxenv_pi_${label}_${randomUUID().replace(/-/g, '')}`

// hermetic env：剥离 shim/serve/provider 标记（与 cli/migrate 测试同纪律）。
// PATH 只含：项目 node_modules/.bin（本地 CLI+本地 dotenvx）+ node/npm 目录 +
// 系统目录——任何全局 npm bin 不在场，命令成功即证明零全局 CLI 依赖。
function hermeticEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const {
    MXENV_SHIM, MXENV_ENDPOINT, MXENV_TOKEN, MXENV_WARN_PLAINTEXT, DOTENV_KEY,
    INFISICAL_CLIENT_ID, INFISICAL_CLIENT_SECRET, ...base
  } = process.env
  return {
    ...base,
    HOME,
    PATH: [BIN_DIR, dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter),
    ...extra,
  }
}

function runCli(args: string[], opts: { env?: Record<string, string>; expectStatus?: number } = {}) {
  const res = spawnSync(CLI, args, {
    encoding: 'utf8',
    env: hermeticEnv(opts.env),
    cwd: CONSUMER,
    timeout: 30_000,
  })
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`
  const expectStatus = opts.expectStatus ?? 0
  expect(res.status, `mx-env ${args.join(' ')} 期望退出 ${expectStatus}，实际 ${res.status}\n${output}`).toBe(expectStatus)
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', output }
}

const KEEP = new Set(['node_modules', 'package.json', 'package-lock.json'])

function cleanProject() {
  for (const entry of readdirSync(CONSUMER)) {
    if (KEEP.has(entry)) continue
    rmSync(join(CONSUMER, entry), { recursive: true, force: true })
  }
}

beforeAll(() => {
  expect(existsSync(join(PKG_MXENV, 'dist', 'cli.js')), 'dist 未构建（先跑 pnpm build）').toBe(true)
  mkdirSync(TARBALLS, { recursive: true })
  mkdirSync(CONSUMER, { recursive: true })
  mkdirSync(HOME, { recursive: true })

  // pnpm pack 从包目录发起（--filter 会注入 --recursive，pack 不支持）；
  // workspace:* 由 pnpm pack 重写为具体版本，tarball 可独立安装。
  for (const pkgDir of [PKG_CORE, PKG_MXENV]) {
    const args = [process.env.npm_execpath ?? 'pnpm', 'pack', '--pack-destination', TARBALLS]
    const res = process.env.npm_execpath
      ? spawnSync(process.execPath, args, { cwd: pkgDir, encoding: 'utf8', timeout: 60_000 })
      : spawnSync('pnpm', args.slice(1), { cwd: pkgDir, encoding: 'utf8', timeout: 60_000 })
    expect(res.status, `pnpm pack 失败：${pkgDir}\n${res.stdout ?? ''}${res.stderr ?? ''}`).toBe(0)
  }

  writeFileSync(join(CONSUMER, 'package.json'), JSON.stringify({ name: 'mxenv-consumer', version: '1.0.0', private: true }, null, 2))

  // devDep 形态安装：双 tarball（模拟发布后 mxenv 传递依赖 mxenv-core 能被解析）
  // + @dotenvx/dotenvx（migrate 目标工具，migrate 报错文案即指引安装）。
  // --omit=optional：keytar 为可选原生依赖，本场景不测 keychain。
  const install = spawnSync('npm', [
    'install', '--no-audit', '--no-fund', '--omit=optional', '--loglevel=error',
    join(TARBALLS, `${coreManifest.name}-${coreManifest.version}.tgz`),
    join(TARBALLS, `${manifest.name}-${manifest.version}.tgz`),
    '@dotenvx/dotenvx',
  ], { cwd: CONSUMER, encoding: 'utf8', timeout: 240_000 })
  expect(install.status, `npm install 失败\n${install.stdout ?? ''}${install.stderr ?? ''}`).toBe(0)
}, 300_000)

afterEach(() => {
  cleanProject()
})

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true })
})

describe('项目装即完整可用（验收口径①）', () => {
  it('安装形态：本地 bin 双名可用，--version 与安装产物一致，零全局目录写', { timeout: 30_000 }, () => {
    expect(existsSync(CLI), 'node_modules/.bin/mx-env 缺失').toBe(true)
    expect(existsSync(join(BIN_DIR, 'morphix-env')), 'node_modules/.bin/morphix-env 缺失').toBe(true)

    const installed = JSON.parse(readFileSync(join(CONSUMER, 'node_modules', 'mxenv', 'package.json'), 'utf8')) as { version: string }
    const out = runCli(['--version']).stdout
    expect(out.trim()).toBe(installed.version)
    expect(out.trim()).toBe(manifest.version)

    // 零全局依赖：临时 HOME 下无全局库目录即全绿（本用例已跑通），
    // 且只读命令不得顺手创建全局目录。
    expect(existsSync(join(HOME, '.mx-env')), '只读命令创建了 ~/.mx-env').toBe(false)
    expect(existsSync(join(HOME, '.mxenv')), '只读命令创建了 ~/.mxenv').toBe(false)
    // 依赖图自洽：mxenv 的传递依赖由 tarball 解析，不借任何全局安装。
    expect(existsSync(join(CONSUMER, 'node_modules', 'mxenv-core'))).toBe(true)
  })

  it('run：项目 .env.local 注入子进程且输出脱敏', { timeout: 30_000 }, () => {
    const value = secret('run')
    writeFileSync(join(CONSUMER, '.env.local'), `MXTEST_PI_RUN=${value}\n`)

    const out = runCli(['run', '--no-infisical', '--', 'node', '-e', 'console.log(process.env.MXTEST_PI_RUN)']).stdout
    expect(out).toContain('[REDACTED]')
    expect(out).not.toContain(value)
  })

  it('export：stdout 全行 eval-able 且携带项目变量', { timeout: 30_000 }, () => {
    const value = secret('export')
    writeFileSync(join(CONSUMER, '.env.local'), `MXTEST_PI_EXPORT=${value}\n`)

    const stdout = runCli(['export', '--no-infisical']).stdout
    const lines = stdout.trim().split('\n').filter(Boolean)
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(line.startsWith('export ')).toBe(true)
    expect(stdout).toContain('export MXTEST_PI_EXPORT=')
  })

  it('inspect + 来源管理：config 定制上游与项目 .env.local 并列可见，零值泄露', { timeout: 30_000 }, () => {
    const localValue = secret('inspect-local')
    const upstreamValue = secret('inspect-upstream')
    writeFileSync(join(CONSUMER, '.env.local'), `MXTEST_PI_LOCAL=${localValue}\n`)
    writeFileSync(join(CONSUMER, 'upstream.env'), `MXTEST_PI_UP=${upstreamValue}\n`)
    // profile 语义：sources 是完整清单（隐式 legacy 在 profile 下不叠加），
    // .env.local 以显式声明源进 profile 与定制上游并列。
    writeFileSync(join(CONSUMER, 'mx-env.config.json'), JSON.stringify({
      sources: {
        local: { provider: 'local', files: ['.env.local'] },
        upstream: { provider: 'local', files: ['upstream.env'] },
      },
      profiles: { dev: { sources: ['local', 'upstream'] } },
      defaultProfile: 'dev',
    }, null, 2))

    const out = runCli(['inspect']).output
    expect(out).toContain('MXTEST_PI_LOCAL')
    expect(out).toContain('local (local)')
    expect(out).toContain('MXTEST_PI_UP')
    expect(out).toContain('upstream (local)')
    expect(out).not.toContain(localValue)
    expect(out).not.toContain(upstreamValue)
  })

  it('口径①组合：进程全局变量 ∪ 全局库 .env ∪ 项目 .env.local ∪ config 定制上游', { timeout: 30_000 }, async () => {
    const gval = secret('global')
    const pval = secret('proj')
    const uval = secret('up')
    const procval = secret('proc')
    // 全局库数据层（0600 安全模式；这是数据不是安装）
    mkdirSync(join(HOME, '.mx-env'), { recursive: true })
    writeFileSync(join(HOME, '.mx-env', '.env'), `MXTEST_PI_GKEY=${gval}\n`, { mode: 0o600 })
    writeFileSync(join(CONSUMER, '.env.local'), `MXTEST_PI_PKEY=${pval}\n`)
    writeFileSync(join(CONSUMER, 'upstream.env'), `MXTEST_PI_UKEY=${uval}\n`)
    writeFileSync(join(CONSUMER, 'mx-env.config.json'), JSON.stringify({
      sources: {
        local: { provider: 'local', files: ['.env.local'] },
        upstream: { provider: 'local', files: ['upstream.env'] },
      },
      profiles: { dev: { sources: ['local', 'upstream'] } },
      defaultProfile: 'dev',
    }, null, 2))

    // 子进程打印四个来源的键是否在场（布尔，不触值）
    const out = runCli(
      ['run', '--no-infisical', '--', 'node', '-e',
        'console.log([!!process.env.MXTEST_PI_GKEY, !!process.env.MXTEST_PI_PKEY, !!process.env.MXTEST_PI_UKEY, !!process.env.MXTEST_PI_PROC].join(","))'],
      { env: { MXTEST_PI_PROC: procval } },
    ).stdout
    expect(out).toContain('true,true,true,true')

    // provenance 各归其源
    const inspect = runCli(['inspect']).output
    expect(inspect).toContain('MXTEST_PI_GKEY')
    expect(inspect).toContain('__mx_global_dotenv')
    expect(inspect).toContain('MXTEST_PI_PKEY')
    expect(inspect).toContain('local (local)')
    expect(inspect).toContain('MXTEST_PI_UKEY')
    expect(inspect).toContain('upstream (local)')
    for (const v of [gval, pval, uval]) expect(inspect).not.toContain(v)
    // 用后即焚全局数据层，维持零全局目录基线
    rmSync(join(HOME, '.mx-env'), { recursive: true, force: true })
  })

  it('migrate：项目明文 --to dotenvx 全链（备份→加密→等价），值不落输出', { timeout: 60_000 }, () => {
    const value = secret('migrate')
    writeFileSync(join(CONSUMER, '.env.local'), `MXTEST_PI_MIG=${value}\n`)
    writeFileSync(join(CONSUMER, 'mx-env.config.json'), JSON.stringify({
      sources: { plain: { provider: 'local', files: ['.env.local'] } },
    }, null, 2))

    const result = runCli(['migrate', '--to', 'dotenvx'])
    expect(result.output).not.toContain(value)

    // 源文件已加密 + 0600 备份在场（migrate 纪律）
    const migrated = readFileSync(join(CONSUMER, '.env.local'), 'utf8')
    expect(migrated).toContain('encrypted:')
    expect(migrated).not.toContain(value)
    const backups = readdirSync(CONSUMER).filter((f) => f.includes('backup') || f.endsWith('.bak'))
    expect(backups.length, `未见备份文件，目录：${readdirSync(CONSUMER).join(', ')}`).toBeGreaterThan(0)
    for (const backup of backups) {
      const mode = statSync(join(CONSUMER, backup)).mode & 0o777
      expect(mode, `${backup} 备份应为 0600`).toBe(0o600)
    }

    // 迁移后组合仍注入（等价性由 migrate 内部验证守卫，此处验证可用性）
    const out = runCli(['run', '--no-infisical', '--', 'node', '-e', 'console.log(!!process.env.MXTEST_PI_MIG)']).stdout
    expect(out).toContain('true')
  })

  it('编辑：--print-editor-url 起会话→索引页→来源视图→关闭', { timeout: 30_000 }, async () => {
    const value = secret('edit')
    writeFileSync(join(CONSUMER, 'editable.env'), `MXTEST_PI_EDIT=${value}\n`)
    writeFileSync(join(CONSUMER, 'mx-env.config.json'), JSON.stringify({
      sources: { local: { provider: 'local', files: ['editable.env'] } },
      profiles: { editable: { sources: ['local'] } },
    }, null, 2))

    const result = runCli(['edit', '--profile', 'editable', '--no-infisical', '--print-editor-url'], {
      env: { MX_ENV_NO_OPEN: '1' },
    })
    const url = result.stdout.match(/Local editor URL: (http:\/\/[^\s]+)/)?.[1]
    expect(url, `未取得编辑器 URL\n${result.output}`).toBeTruthy()
    expect(url!).not.toContain(value)

    const index = await fetch(url!).then((r) => r.text())
    expect(index).toContain('<title>mx-env editor</title>')

    // 来源管理视图：本地源值仅在浏览器会话内可见（现有语义）
    const source = await fetch(`${url}/source/local`).then((r) => r.text())
    expect(source).toContain(value)

    await fetch(url!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ action: 'close' }),
    })
    // 零全局依赖的正确边界：审计数据（writeAudit → ~/.mx-env/audit）合法存在，
    // 但不得合成全局配置或全局密钥库——全局安装/预置目录始终不在场。
    const globalDir = join(HOME, '.mx-env')
    if (existsSync(globalDir)) {
      expect(existsSync(join(globalDir, 'config.json')), '编辑器合成了全局配置').toBe(false)
      expect(existsSync(join(globalDir, '.env')), '编辑器合成了全局密钥库').toBe(false)
    }
    expect(existsSync(join(HOME, '.mxenv'))).toBe(false)
  })
})
