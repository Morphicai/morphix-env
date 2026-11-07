import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import {
  composeEnvironment,
  GLOBAL_CONFIG_DIR,
  LEGACY_GLOBAL_CONFIG_DIR,
  loadConfigLayers,
  suppressLegacyHomeHint,
} from '@morphixai/mxenv-core'
import { migrateHome } from '../src/migrate'

// migrate --home（home-migration）：copy → 迁移前留时间戳备份（旧目录改名）→
// 值级等价验证（目标独立生效）→ 失败从备份整目录还原。五场景 + 幂等/回落/并存。
const CLI = join(__dirname, '..', 'dist', 'cli.js')
const TMP = join(tmpdir(), `mx-env-home-migration-${randomUUID()}`)
const HOME = join(TMP, 'home')
const LEGACY_DIR = join(HOME, LEGACY_GLOBAL_CONFIG_DIR)
const TARGET_DIR = join(HOME, GLOBAL_CONFIG_DIR)
const value = (label: string) => `mxenv_home_${label}_${randomUUID().replace(/-/g, '')}`

function seedLegacy(env: Record<string, string>, config?: unknown): void {
  mkdirSync(LEGACY_DIR, { recursive: true })
  const envBody = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'
  writeFileSync(join(LEGACY_DIR, '.env'), envBody)
  chmodSync(join(LEGACY_DIR, '.env'), 0o600)
  if (config) writeFileSync(join(LEGACY_DIR, 'config.json'), JSON.stringify(config, null, 2))
  mkdirSync(join(LEGACY_DIR, 'shims'), { recursive: true })
  writeFileSync(join(LEGACY_DIR, 'shims', 'marker.txt'), 'marker')
  mkdirSync(join(LEGACY_DIR, 'audit'), { recursive: true })
  writeFileSync(join(LEGACY_DIR, 'audit', 'seed.jsonl'), '{}\n')
}

function runCli(args: string[]) {
  // Hermetic：剥 shim/provider 标记与上游 env，HOME 钉临时家（同 cli 测试纪律）。
  const { MXENV_SHIM, MXENV_ENDPOINT, MXENV_TOKEN, MXENV_WARN_PLAINTEXT, DOTENV_KEY, INFISICAL_CLIENT_ID, INFISICAL_CLIENT_SECRET, ...base } = process.env
  return spawnSync('node', [CLI, ...args], {
    encoding: 'utf8',
    env: { ...base, HOME },
    cwd: TMP,
  })
}

async function composeKeys(): Promise<Record<string, string>> {
  suppressLegacyHomeHint()
  const empty = join(TMP, 'empty-cwd')
  mkdirSync(empty, { recursive: true })
  const layers = loadConfigLayers({ cwd: empty, homeDir: HOME })
  const composition = await composeEnvironment(layers, { homeDir: HOME, baseEnvironment: {}, noInfisical: true })
  return { ...composition.environment } as Record<string, string>
}

function backupDirs(): string[] {
  return readdirSync(HOME).filter((name) => name.startsWith(`${LEGACY_GLOBAL_CONFIG_DIR}.backup-`))
}

function snapshotTree(dir: string, out: Map<string, string> = new Map()): Map<string, string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    const rel = full.slice(dir.length)
    if (entry.isDirectory()) {
      out.set(rel + '/', `mode ${(statSync(full).mode & 0o7777).toString(8)}`)
      snapshotTree(full, out)
    } else {
      out.set(rel, `${(statSync(full).mode & 0o7777).toString(8)} ${readFileSync(full).toString('base64')}`)
    }
  }
  return out
}

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(HOME, { recursive: true })
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('migrate --home（home-migration 五场景 + 幂等/回落/并存）', () => {
  it('迁移成功且等价：copy 含权限位、旧目录留时间戳备份、前后组合值一致', async () => {
    const a = value('A')
    const b = value('B')
    const c = value('C')
    seedLegacy(
      { HOME_A: a, HOME_B: b },
      { sources: { extra: { provider: 'local', files: ['extra.env'] } }, profiles: { dev: { sources: ['extra'] } }, defaultProfile: 'dev' },
    )
    writeFileSync(join(LEGACY_DIR, 'extra.env'), `HOME_C=${c}\n`)

    const before = await composeKeys()
    expect(before.HOME_A).toBe(a)

    const result = runCli(['migrate', '--home'])
    const output = `${result.stdout}${result.stderr}`
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('migrated')
    expect(result.stdout).toContain('Backup:')
    // 值永不出现（成功路径）。
    for (const secret of [a, b, c]) expect(output).not.toContain(secret)

    expect(existsSync(TARGET_DIR)).toBe(true)
    expect(existsSync(LEGACY_DIR)).toBe(false)
    expect(backupDirs().length).toBe(1)
    // 备份即旧目录本体（可回滚）。
    expect(existsSync(join(HOME, backupDirs()[0], '.env'))).toBe(true)
    // 权限位保真：0600 检查不变。
    expect(statSync(join(TARGET_DIR, '.env')).mode & 0o777).toBe(0o600)
    // 整树随迁（shims/audit 产物）。
    expect(existsSync(join(TARGET_DIR, 'shims', 'marker.txt'))).toBe(true)
    expect(existsSync(join(TARGET_DIR, 'audit', 'seed.jsonl'))).toBe(true)

    const after = await composeKeys()
    expect(after.HOME_A).toBe(a)
    expect(after.HOME_B).toBe(b)
    expect(after.HOME_C).toBe(c)
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort())
  })

  it('目标已存在拒绝覆盖：零写入（两目录原样、无备份产生）', async () => {
    const oldV = value('old')
    const newV = value('new')
    seedLegacy({ HOME_A: oldV })
    mkdirSync(TARGET_DIR, { recursive: true })
    writeFileSync(join(TARGET_DIR, '.env'), `HOME_A=${newV}\n`)
    chmodSync(join(TARGET_DIR, '.env'), 0o600)
    const before = [snapshotTree(LEGACY_DIR), snapshotTree(TARGET_DIR)]

    const result = runCli(['migrate', '--home'])
    const output = `${result.stdout}${result.stderr}`
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('refusing to overwrite')
    expect(result.stderr).toContain('Resolve by hand')
    expect(output).not.toContain(oldV)
    expect(output).not.toContain(newV)

    expect(snapshotTree(LEGACY_DIR)).toEqual(before[0])
    expect(snapshotTree(TARGET_DIR)).toEqual(before[1])
    expect(backupDirs().length).toBe(0)
  })

  it('验证失败回滚：从备份整目录还原、删半成品、stderr 指明备份路径（真实失配注入：显式旧路径引用）', async () => {
    // 全局配置显式引用 `~/.mx-env/...`：迁移后旧路径消逝 → 目标独立验证键集失配
    // （正是"备份先于验证、目标独立生效"要抓的断裂面，无需 mock 即可真实触发）。
    const a = value('R1')
    const c = value('R2')
    seedLegacy(
      { HOME_A: a },
      { sources: { legacyref: { provider: 'local', files: ['~/.mx-env/extra.env'], optional: true } }, profiles: { dev: { sources: ['legacyref'] } }, defaultProfile: 'dev' },
    )
    writeFileSync(join(LEGACY_DIR, 'extra.env'), `HOME_C=${c}\n`)

    const result = await migrateHome(HOME)
    expect(result.status).toBe('failed')
    expect(result.exitCode).toBe(1)
    expect(result.detail).toContain('verification failed')
    expect(result.detail).toContain('keys differ after migration: HOME_C')
    // 失败 detail 给成因与下一步（review N-4）。
    expect(result.detail).toContain('fix those references')
    expect(result.detail).toContain('restored from backup')
    expect(result.detail).toContain(`${LEGACY_GLOBAL_CONFIG_DIR}.backup-`)
    // 值永不出现（失败路径）。
    expect(result.detail).not.toContain(a)
    expect(result.detail).not.toContain(c)
    // 半成品不留、原目录还原、备份不留（已还原回原名）。
    expect(existsSync(TARGET_DIR)).toBe(false)
    expect(existsSync(join(LEGACY_DIR, '.env'))).toBe(true)
    expect(backupDirs().length).toBe(0)
    const restored = await composeKeys()
    expect(restored.HOME_A).toBe(a)
    expect(restored.HOME_C).toBe(c)
  })

  it('未迁移时兼容读取：组合命令正常、stderr 一次性迁移提示；迁移后行为一致且无提示', async () => {
    const a = value('FALL')
    seedLegacy({ HOME_A: a })

    const first = runCli(['inspect'])
    expect(first.status).toBe(0)
    expect(first.stdout).toContain('HOME_A')
    expect(`${first.stdout}${first.stderr}`).not.toContain(a)
    // 一次性：inspect 多次解析全局目录（组合+审计），提示只出一次。
    expect(first.stderr.split('migrate --home').length - 1).toBe(1)

    const migrated = runCli(['migrate', '--home'])
    expect(migrated.status).toBe(0)

    const second = runCli(['inspect'])
    expect(second.status).toBe(0)
    expect(second.stdout).toContain('HOME_A')
    expect(`${second.stdout}${second.stderr}`).not.toContain(a)
    expect(second.stderr).not.toContain('migrate --home')
    const after = await composeKeys()
    expect(after.HOME_A).toBe(a)
  })

  it('幂等：已迁移再跑报告无操作、不产生新备份', async () => {
    const a = value('IDEM')
    seedLegacy({ HOME_A: a })
    expect(runCli(['migrate', '--home']).status).toBe(0)

    const again = runCli(['migrate', '--home'])
    expect(again.status).toBe(0)
    expect(again.stdout).toContain('already migrated')
    expect(`${again.stdout}${again.stderr}`).not.toContain(a)
    expect(backupDirs().length).toBe(1)
  })

  it('两目录并存只读新目录（旧目录值不生效、无迁移提示）', async () => {
    const oldV = value('dual-old')
    const newV = value('dual-new')
    seedLegacy({ HOME_A: oldV })
    mkdirSync(TARGET_DIR, { recursive: true })
    writeFileSync(join(TARGET_DIR, '.env'), `HOME_A=${newV}\n`)
    chmodSync(join(TARGET_DIR, '.env'), 0o600)

    const result = runCli(['export', '--no-infisical'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(newV)
    expect(result.stdout).not.toContain(oldV)
    expect(result.stderr).not.toContain('migrate --home')
  })

  it('sandbox 全链（2.1）：旧目录读取 → migrate --home → 等价 → 手工回滚演练 → 再迁移', async () => {
    const a = value('CHAIN')
    const b = value('CHAIN2')
    seedLegacy({ HOME_A: a, HOME_B: b })

    const pre = await composeKeys()
    expect(runCli(['migrate', '--home']).status).toBe(0)
    const post = await composeKeys()
    expect(post).toEqual(pre)

    // 回滚演练：备份改名回旧名、移除新目录 = 文档化的人工回滚路径。
    const backup = backupDirs()[0]
    rmSync(TARGET_DIR, { recursive: true, force: true })
    renameSync(join(HOME, backup), LEGACY_DIR)
    const rolled = await composeKeys()
    expect(rolled.HOME_A).toBe(a)
    expect(rolled.HOME_B).toBe(b)

    // 回滚后可再次迁移（备份序列重新开始）。
    const again = runCli(['migrate', '--home'])
    expect(again.status).toBe(0)
    expect(backupDirs().length).toBe(1)
    expect((await composeKeys()).HOME_A).toBe(a)
  })

  it('--home 与明文迁移的 --to 面互斥', () => {
    const result = runCli(['migrate', '--home', '--to', 'dotenvx'])
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain('--home is its own mode')
  })

  it('S-1：迁移成功后 rc 块重指新 shimsDir（新旧标记双认、用户内容不动），PATH 断供修复', async () => {
    seedLegacy({ HOME_A: value('RC') })
    // 兼容窗内 shell-init --write 的形态：块烘死旧 shimsDir 绝对路径。
    const legacyShims = join(LEGACY_DIR, 'shims')
    const targetShims = join(TARGET_DIR, 'shims')
    writeFileSync(join(HOME, '.zshrc'), `# user content\n# >>> mxenv shims >>>\nexport PATH="${legacyShims}:$PATH"\n# <<< mxenv shims <<<\n`)
    writeFileSync(join(HOME, '.bashrc'), `# >>> mx-env shims >>>\nexport PATH="${legacyShims}:$PATH"\n# <<< mx-env shims <<<\n`)

    const result = await migrateHome(HOME)
    expect(result.status).toBe('migrated')
    // 块已在场且重写成功：不得再发重接指引。
    expect(result.rcHint).toBeUndefined()
    expect(result.detail).toContain('rc PATH block rewired')
    for (const name of ['.zshrc', '.bashrc']) {
      const rc = readFileSync(join(HOME, name), 'utf8')
      expect(rc).toContain(targetShims)
      expect(rc).not.toContain(legacyShims)
    }
    // 只动工具自有标记块：用户内容原样。
    expect(readFileSync(join(HOME, '.zshrc'), 'utf8')).toContain('# user content')
  })

  it('S-1：无 rc 块时成功路径 stderr 给 shell-init --write 指引（不静默）', async () => {
    seedLegacy({ HOME_A: value('NOBLOCK') })
    const result = runCli(['migrate', '--home'])
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('mxenv-cli shell-init --write')
  })

  it('N-2：验证前崩溃重跑不报 already migrated——回滚重启、验证必然发生（失败如实报）', async () => {
    const a = value('CRASH')
    const c = value('CRASH2')
    seedLegacy(
      { HOME_A: a },
      { sources: { legacyref: { provider: 'local', files: ['~/.mx-env/extra.env'], optional: true } }, profiles: { dev: { sources: ['legacyref'] } }, defaultProfile: 'dev' },
    )
    writeFileSync(join(LEGACY_DIR, 'extra.env'), `HOME_C=${c}\n`)
    // 手工构造崩溃现场：备份改名已发生、验证未完成（`.mxenv-verify-pending` 在场）。
    const crashBackup = join(HOME, `${LEGACY_GLOBAL_CONFIG_DIR}.backup-crash`)
    renameSync(LEGACY_DIR, crashBackup)
    cpSync(crashBackup, TARGET_DIR, { recursive: true })
    writeFileSync(join(TARGET_DIR, '.mxenv-verify-pending'), `${crashBackup}\n`)

    const result = await migrateHome(HOME)
    // 不许洗成静默成功：验证重跑且因显式旧路径引用如实失败。
    expect(result.status).toBe('failed')
    expect(result.detail).toContain('verification failed')
    expect(result.detail).not.toContain('already migrated')
    expect(result.detail).toContain('restored from backup')
    // 回滚重启后失败再次还原：现场回到迁移前（值不落输出）。
    expect(existsSync(LEGACY_DIR)).toBe(true)
    expect(existsSync(TARGET_DIR)).toBe(false)
    const restored = await composeKeys()
    expect(restored.HOME_A).toBe(a)
    expect(restored.HOME_C).toBe(c)
    expect(result.detail).not.toContain(a)
  })

  it('N-2：崩溃窗重跑在配置完好时完成迁移（重新快照+验证、标记清除）', async () => {
    const a = value('CRASHOK')
    seedLegacy({ HOME_A: a })
    const crashBackup = join(HOME, `${LEGACY_GLOBAL_CONFIG_DIR}.backup-crash`)
    renameSync(LEGACY_DIR, crashBackup)
    cpSync(crashBackup, TARGET_DIR, { recursive: true })
    writeFileSync(join(TARGET_DIR, '.mxenv-verify-pending'), `${crashBackup}\n`)

    const result = await migrateHome(HOME)
    expect(result.status).toBe('migrated')
    expect(result.keyNames).toEqual(['HOME_A'])
    expect(existsSync(join(TARGET_DIR, '.mxenv-verify-pending'))).toBe(false)
    expect((await composeKeys()).HOME_A).toBe(a)
  })

  it('N-5：数据只在目录备份里时不得报 nothing to migrate（指向人工还原）', async () => {
    const orphan = join(HOME, `${LEGACY_GLOBAL_CONFIG_DIR}.backup-leftover`)
    mkdirSync(orphan, { recursive: true })
    writeFileSync(join(orphan, '.env'), `HOME_A=${value('ORPHAN')}\n`)

    const result = runCli(['migrate', '--home'])
    const output = `${result.stdout}${result.stderr}`
    expect(result.status).toBe(1)
    expect(output).toContain('directory backup')
    expect(output).toContain('.backup-leftover')
    expect(output).toContain('restore manually')
    expect(output).not.toContain('nothing to migrate')
  })

  it('N-6：半拷贝临时名不参与全局目录解析、崩溃残留迁移时清扫', async () => {
    const a = value('PARTIAL')
    const bogus = value('BOGUS')
    seedLegacy({ HOME_A: a })
    // 手工残留半拷贝相位（临时名）：任何读者都不得把它当全局库。
    const partial = `${TARGET_DIR}.partial-stale`
    mkdirSync(partial, { recursive: true })
    writeFileSync(join(partial, '.env'), `HOME_A=${bogus}\n`)

    const during = await composeKeys()
    expect(during.HOME_A).toBe(a)

    const result = runCli(['migrate', '--home'])
    expect(result.status).toBe(0)
    expect(existsSync(partial)).toBe(false)
    expect((await composeKeys()).HOME_A).toBe(a)
    expect(readdirSync(HOME).filter((name) => name.includes('.partial-'))).toEqual([])
  })

  it('N-7：keyNames 只报库键（PATH/HOME 等底座键不计数、不进审计）', async () => {
    seedLegacy({ HOME_A: value('KEYS') })
    const result = await migrateHome(HOME)
    expect(result.status).toBe('migrated')
    expect(result.keyNames).toEqual(['HOME_A'])
    expect(result.keyNames).not.toContain('PATH')
    expect(result.keyNames).not.toContain('DOTENVX_NO_NATIVE')
    expect(result.detail).toContain('(1 keys verified equivalent)')
  })

  it('N-8：验证失败走 CLI——退出码非零、stderr 指明备份路径', async () => {
    const a = value('CLI8')
    const c = value('CLI8B')
    seedLegacy(
      { HOME_A: a },
      { sources: { legacyref: { provider: 'local', files: ['~/.mx-env/extra.env'], optional: true } }, profiles: { dev: { sources: ['legacyref'] } }, defaultProfile: 'dev' },
    )
    writeFileSync(join(LEGACY_DIR, 'extra.env'), `HOME_C=${c}\n`)

    const result = runCli(['migrate', '--home'])
    const output = `${result.stdout}${result.stderr}`
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('verification failed')
    expect(result.stderr).toContain(`${LEGACY_GLOBAL_CONFIG_DIR}.backup-`)
    expect(output).not.toContain(a)
    expect(output).not.toContain(c)
  })
})
