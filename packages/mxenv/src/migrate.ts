import { execFileSync } from 'child_process'
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, rmdirSync, statSync, symlinkSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'path'
import { parse as dotenvParse } from 'dotenv'
import {
  composeEnvironment,
  CONFIG_FILE,
  ensureCommand,
  expandHomePath,
  GLOBAL_CONFIG_DIR,
  GLOBAL_DOTENV_SOURCE,
  hasRcBlock,
  hasGlobalDataAt,
  isDotenvxEncrypted,
  LEGACY_GLOBAL_CONFIG_DIR,
  loadConfigLayers,
  loadKeytar,
  loadSource,
  parseEnvFile,
  replaceRcBlocks,
  shimsDir,
  suppressLegacyHomeHint,
  type ConfigLayers,
  type LocalSource,
  type SecretSource,
  type SourceEntry,
} from '@morphixai/mxenv-core'

export type MigrateTarget = 'dotenvx' | 'keychain'

/**
 * One migratable plaintext unit. `global-implicit` is the hardcoded
 * ~/.mxenv/.env source (dotenvx target only — its loading does not go through
 * profiles, so no config declaration can take it over; design decision 3).
 */
export interface MigrationUnit {
  name: string
  kind: 'global-implicit' | 'declared'
  /** Which layer declared the source (null for the implicit unit). */
  scope: 'global' | 'project' | null
  baseDir: string
  /** Config file to rewrite for declared units. */
  configPath: string | null
  /** The declared local source, with `files` as written in config. */
  source: LocalSource
  /** Existing plaintext files, absolute. */
  files: string[]
  /** Value-free key names for plan output and audit. */
  keyNames: string[]
}

export interface UnitOutcome {
  unit: MigrationUnit
  status: 'migrated' | 'skipped' | 'failed'
  /** Value-free explanation shown to the operator. */
  detail: string
  backups: string[]
  warnings: string[]
}

function resolveUnitFile(rawFile: string, baseDir: string, homeDir: string): string {
  const expanded = expandHomePath(rawFile, homeDir)
  return isAbsolute(expanded) ? expanded : resolve(baseDir, expanded)
}

/** Merges the unit's files in order — the same semantics resolveLocal uses. */
function snapshotValues(unit: MigrationUnit): Record<string, string> {
  const values: Record<string, string> = {}
  for (const file of unit.files) Object.assign(values, parseEnvFile(file))
  return values
}

function declaredUnits(loaded: ConfigLayers['global'], scope: 'global' | 'project', homeDir: string): MigrationUnit[] {
  const units: MigrationUnit[] = []
  for (const [name, source] of Object.entries(loaded.config.sources || {})) {
    if (source.provider !== 'local') continue
    const files = source.files
      .map((file) => resolveUnitFile(file, loaded.baseDir, homeDir))
      .filter(existsSync)
    if (!files.length) continue
    const probe: MigrationUnit = {
      name, kind: 'declared', scope, baseDir: loaded.baseDir,
      configPath: loaded.path, source, files, keyNames: [],
    }
    units.push({ ...probe, keyNames: Object.keys(snapshotValues(probe)).sort() })
  }
  return units
}

/**
 * Discovers plaintext local units in scope. An already-encrypted global file
 * and sources already pointing at encrypted providers are naturally absent —
 * that is what makes re-running migrate idempotent.
 */
export function discoverPlaintextUnits(layers: ConfigLayers, homeDir = homedir()): MigrationUnit[] {
  const units: MigrationUnit[] = []
  if (existsSync(layers.globalEnvFile) && !isDotenvxEncrypted(layers.globalEnvFile)) {
    const source: LocalSource = { provider: 'local', files: [layers.globalEnvFile], optional: true }
    const probe: MigrationUnit = {
      name: GLOBAL_DOTENV_SOURCE, kind: 'global-implicit', scope: null,
      baseDir: dirname(layers.globalEnvFile), configPath: null, source,
      files: [layers.globalEnvFile], keyNames: [],
    }
    units.push({ ...probe, keyNames: Object.keys(snapshotValues(probe)).sort() })
  }
  units.push(...declaredUnits(layers.global, 'global', homeDir))
  units.push(...declaredUnits(layers.project, 'project', homeDir))
  return units
}

/**
 * Legacy plaintext files (`.env.local` / configured `envFiles`) are not
 * auto-migrated: there is no declared source to rewrite (design decision 8).
 * They are surfaced as hints instead.
 */
export function legacyPlaintextHints(layers: ConfigLayers, units: MigrationUnit[], homeDir = homedir()): string[] {
  const covered = new Set(units.flatMap((unit) => unit.files))
  const legacyFiles = layers.project.config.envFiles || ['.env.local']
  return legacyFiles
    .map((file) => resolveUnitFile(file, layers.project.baseDir, homeDir))
    .filter((file) => existsSync(file) && !covered.has(file) && !isDotenvxEncrypted(file))
}

const BACKUP_MARK = '.mxenv-backup-'
// 解析侧双认旧后缀：备份同一次运行内生成即消费，但手工恢复/跨版本残留的
// 旧名备份仍须能解析出还原目标（写侧只产新名）。
const LEGACY_BACKUP_MARK = '.mx-env-backup-'

function backupFile(file: string, stamp: string): string {
  const backup = `${file}${BACKUP_MARK}${stamp}`
  copyFileSync(file, backup)
  chmodSync(backup, 0o600)
  return backup
}

/** 还原目标推导：取两种后缀中实际出现的位置（lastIndexOf：源文件名自身可含标记串）。 */
function backupOriginalPath(backup: string): string {
  const at = Math.max(backup.lastIndexOf(BACKUP_MARK), backup.lastIndexOf(LEGACY_BACKUP_MARK))
  return at >= 0 ? backup.slice(0, at) : ''
}

/**
 * Restores every backup over its original path (config writes land on the
 * new-name file the read side consults; the legacy name is no longer read).
 * Returns the paths that could NOT be restored — the caller must surface them
 * instead of claiming a clean restore, otherwise a half-restored unit would
 * leave ciphertext being loaded as plaintext with no alarm.
 */
function restoreBackups(backups: string[]): string[] {
  const failed: string[] = []
  for (const backup of backups) {
    const original = backupOriginalPath(backup)
    const target = original
    try {
      if (!target || !existsSync(backup)) continue
      // 未受损文件（如删除失败残留的原件）与备份逐字节一致即视作已还原：复制会
      // 因文件锁定失败，但状态本就闭合，不应误报 RESTORE FAILED。
      if (existsSync(target) && readFileSync(target).equals(readFileSync(backup))) continue
      copyFileSync(backup, target)
      // 改名后旧路径理论上已被 rename 移除；防御性清残留以维持单一配置事实源。
      if (original && target !== original && existsSync(original)) {
        try { rmSync(original) } catch { /* 残留清理是防御性的，失败不改变还原结果 */ }
      }
    } catch {
      if (target) failed.push(target)
    }
  }
  return failed
}

/** Appends the restore outcome to a failure message; never claims a restore that did not happen. */
function withRestoreOutcome(message: string, failed: string[], backups: string[]): string {
  if (failed.length) {
    return `${message} RESTORE FAILED for: ${failed.join(', ')} — restore manually from the .mxenv-backup-* file backups${backups.length ? ` (${backups.join(', ')})` : ''}.`
  }
  return `${message} Plaintext and configuration were restored from backup${backups.length ? ` (${backups.join(', ')})` : ''}.`
}

function equivalent(expected: Record<string, string>, actual: Record<string, string>, presenceOnly: Set<string>): boolean {
  const expectedKeys = Object.keys(expected).sort()
  const actualKeys = Object.keys(actual).sort()
  if (expectedKeys.length !== actualKeys.length) return false
  return expectedKeys.every((key, index) => key === actualKeys[index] && (presenceOnly.has(key) || expected[key] === actual[key]))
}

/** The declared `files` subset that exists on disk (post-migration config must not name missing files — dotenvx hard-fails on those). */
function existingDeclaredFiles(unit: MigrationUnit, homeDir: string): string[] {
  const existing = new Set(unit.files)
  return unit.source.files.filter((file) => existing.has(resolveUnitFile(file, unit.baseDir, homeDir)))
}

/** Declared files absent at migration time — dropped from the rewritten config; surfaced as a warning. */
function droppedDeclaredFiles(unit: MigrationUnit, homeDir: string): string[] {
  const existing = new Set(unit.files)
  return unit.source.files.filter((file) => !existing.has(resolveUnitFile(file, unit.baseDir, homeDir)))
}

function rewriteDeclaredSource(unit: MigrationUnit, newSource: SecretSource, stamp: string, backups: string[]): void {
  // 写只落新名（naming-migration「垫片移除与到期公告」）：读侧恒取
  // mxenv.config.json，写即该文件（备份在上方落好，可回滚）；旧名文件不
  // 参与解析，由加载链的改名指引引导用户自行迁移。
  const configPath = unit.configPath!
  backups.push(backupFile(configPath, stamp))
  const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as { sources?: Record<string, SecretSource> }
  parsed.sources![unit.name] = newSource
  writeFileSync(configPath, `${JSON.stringify(parsed, null, 2)}\n`)
}

/** Warns when a produced `.env.keys` sits inside a git work tree unignored. Never blocks. */
export function gitIgnoreWarnings(paths: string[]): string[] {
  const warnings: string[] = []
  for (const path of paths) {
    try {
      execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dirname(path), stdio: ['ignore', 'ignore', 'ignore'] })
    } catch {
      continue
    }
    try {
      execFileSync('git', ['check-ignore', '-q', path], { cwd: dirname(path), stdio: ['ignore', 'ignore', 'ignore'] })
    } catch (error: any) {
      if (error?.status === 1) {
        warnings.push(`[mxenv] WARNING: ${path} is inside a git repository and NOT git-ignored — this file holds the decryption key and must never be committed.`)
      }
    }
  }
  return warnings
}

async function reloadViaKeychain(unit: MigrationUnit, newSource: SecretSource, homeDir: string): Promise<Record<string, string>> {
  const entry: SourceEntry = {
    name: unit.name,
    source: newSource,
    baseDir: unit.baseDir,
    globalImplicit: unit.kind === 'global-implicit',
  }
  const loaded = await loadSource(entry, { homeDir, environment: { ...process.env } })
  return loaded.values
}

/**
 * Verification child processes get a minimal allowlisted environment, never
 * the caller's. Empirical dotenvx 2.30 behavior this defends against:
 * `decrypt --stdout` merges same-named parent-env variables over file values
 * (no --overload exists for decrypt) and resolves `DOTENV_PRIVATE_KEY*` key
 * material from the environment — so an inherited environment can both
 * false-fail verification and substitute for the `.env.keys` the check is
 * supposed to prove. PATH is pinned to reach the current Node runtime for the
 * dotenvx shebang (same rationale as resolveDotenvx). Shared with the visual
 * editor's dotenvx calls (get/set/del) for the same defense.
 */
export function verificationEnv(): NodeJS.ProcessEnv {
  return {
    ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
    ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}),
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
    ...(process.env.TMP ? { TMP: process.env.TMP } : {}),
    ...(process.env.TEMP ? { TEMP: process.env.TEMP } : {}),
    PATH: [dirname(process.execPath), process.env.PATH || ''].filter(Boolean).join(delimiter),
    DOTENVX_NO_NATIVE: 'true',
  }
}

/**
 * dotenvx verification goes through `decrypt --stdout`, NOT `run`: run injects
 * into a child env, and without --overload a same-named shell export would
 * shadow the file value and produce false mismatches. decrypt keeps values in
 * the pipe and is a genuinely independent code path from the snapshot's
 * dotenv.parse — but it still consults the child environment (see
 * verificationEnv) and expands `$name` sequences in values during loading, so
 * values that would not survive migration intact are refused and named rather
 * than silently changed. --no-native pins the file model so verification
 * proves the `.env.keys` on disk, never a keychain-custodian fluke.
 */
function decryptValues(command: string, files: string[]): Record<string, string> {
  const values: Record<string, string> = {}
  for (const file of files) {
    const output = execFileSync(command, ['decrypt', '-f', file, '--stdout', '--no-native'], {
      encoding: 'utf8',
      cwd: dirname(file),
      stdio: ['ignore', 'pipe', 'ignore'],
      env: verificationEnv(),
    })
    // Strip the public-key markers the encrypted file declares (dotenvx
    // machinery, never part of the plaintext snapshot). dotenvx reserves the
    // whole DOTENV_PUBLIC_KEY* prefix and migrateToDotenvx refuses such keys up
    // front, so in practice only the marker line is dropped here.
    const markerKeys = new Set(Object.keys(parseEnvFile(file)).filter((key) => key.startsWith('DOTENV_PUBLIC_KEY')))
    for (const [key, value] of Object.entries(dotenvParse(output))) {
      if (!markerKeys.has(key)) values[key] = value
    }
  }
  return values
}

async function migrateToDotenvx(unit: MigrationUnit, stamp: string, homeDir: string, backups: string[]): Promise<{ warnings: string[] }> {
  const snapshot = snapshotValues(unit)
  // Push one at a time: a mid-map throw must not leave unregistered plaintext
  // copies on disk that the failure output never mentions (review M2).
  for (const file of unit.files) backups.push(backupFile(file, stamp))
  // Track pre-existing keys files so a failed run only removes what it created,
  // and pre-existing ones get backed up too (dotenvx appends new private keys
  // to them — the file is mutated in place, review L1).
  const candidateKeysFiles = [...new Set(unit.files.map((file) => join(dirname(file), '.env.keys')))]
  const preExistingKeys = new Set(candidateKeysFiles.filter(existsSync))
  for (const keysFile of preExistingKeys) backups.push(backupFile(keysFile, stamp))
  try {
    let command: string
    try {
      command = ensureCommand('dotenvx', unit.name, 'dotenvx')
    } catch {
      throw new Error('the dotenvx CLI is required; install it (e.g. `npm i -g @dotenvx/dotenvx`) or migrate to another target.')
    }
    for (const file of unit.files) {
      // dotenvx reserves the DOTENV_PUBLIC_KEY* prefix: encrypt rejects such
      // files with a raw hex error. Refuse up front with the key named so the
      // operator knows what to rename.
      for (const key of Object.keys(parseEnvFile(file))) {
        if (key.startsWith('DOTENV_PUBLIC_KEY')) {
          throw new Error(`dotenvx reserves the DOTENV_PUBLIC_KEY* prefix; rename key "${key}" in ${file} before migrating.`)
        }
      }
      // cwd pins where `.env.keys` lands — beside the file, matching
      // resolveDotenvx's lookup assumption. --no-native forces the file model:
      // dotenvx 2.x on macOS otherwise custodies the private key in the OS
      // keychain and no portable `.env.keys` is produced (design decision 2).
      execFileSync(command, ['encrypt', '-f', file, '--no-native'], { cwd: dirname(file), stdio: ['ignore', 'ignore', 'ignore'] })
      // dotenvx drops `.env.keys` with default (usually 0644) permissions;
      // close the window immediately rather than after all files are done.
      const keysFile = join(dirname(file), '.env.keys')
      if (existsSync(keysFile)) chmodSync(keysFile, 0o600)
    }
    const keysFiles = candidateKeysFiles.filter(existsSync)

    const values = decryptValues(command, unit.files)
    // Keys that collide with the runtime environment the dotenvx CLI itself
    // needs (PATH, HOME, …) cannot be proven value-wise through a shebang-run
    // CLI — the child env must carry them and dotenvx's output shadows them.
    // Their presence is verified here; value fidelity for them rests on
    // encrypt reading the file and composition's `run --overload` file-wins.
    const presenceOnly = new Set(Object.keys(verificationEnv()))
    if (!equivalent(snapshot, values, presenceOnly)) {
      const diffKeys = [...new Set([...Object.keys(snapshot), ...Object.keys(values)])]
        .filter((key) => !presenceOnly.has(key) && snapshot[key] !== values[key])
        .sort()
      throw new Error(
        `post-migration verification failed: decrypted values differ from the plaintext snapshot for: ${diffKeys.join(', ')}.` +
        ' dotenvx expands $name sequences during loading — if a listed key holds a $ sequence, migration would change what consumers see and is refused; edit that value first.',
      )
    }
    const warnings: string[] = []
    if (unit.kind === 'declared') {
      const newSource: SecretSource = {
        provider: 'dotenvx',
        files: existingDeclaredFiles(unit, homeDir),
        ...(unit.source.override ? { override: true } : {}),
        ...(unit.source.optional ? { optional: true } : {}),
      }
      rewriteDeclaredSource(unit, newSource, stamp, backups)
      for (const dropped of droppedDeclaredFiles(unit, homeDir)) {
        warnings.push(`[mxenv] Warning: declared file "${dropped}" did not exist at migration time and was dropped from the rewritten source; re-add it to the config if it returns.`)
      }
    }
    return { warnings: [...warnings, ...gitIgnoreWarnings(keysFiles)] }
  } catch (error) {
    const failed = restoreBackups(backups)
    // Remove `.env.keys` files this run created — they hold the private key for
    // ciphertext that no longer exists after the restore. Pre-existing ones are
    // covered by their backup restore above.
    for (const keysFile of candidateKeysFiles) {
      if (!preExistingKeys.has(keysFile) && existsSync(keysFile)) rmSync(keysFile)
    }
    const message = error instanceof Error ? error.message : 'unknown failure'
    throw new Error(withRestoreOutcome(message, failed, backups))
  }
}

/**
 * Verification for the keychain target is a **subset** check over the snapshot's
 * keys — a service may legitimately carry other accounts (the default name
 * `mxenv:<source>` collides across projects, and manual entries exist; configs
 * that recorded a legacy `mx-env:<source>` service keep reading it as-is).
 * Foreign
 * accounts are reported as a warning, never a failure (review H1).
 */
function snapshotCovered(expected: Record<string, string>, actual: Record<string, string>): boolean {
  return Object.keys(expected).every((key) => actual[key] === expected[key])
}

async function migrateToKeychain(unit: MigrationUnit, service: string, stamp: string, homeDir: string, backups: string[]): Promise<{ warnings: string[] }> {
  if (process.platform !== 'darwin') throw new Error('the os-keychain target is supported on macOS only; use --to dotenvx on this machine.')
  const keytar = await loadKeytar()
  if (!keytar) throw new Error('the os-keychain target needs the optional native module "keytar"; reinstall @morphixai/mxenv or use --to dotenvx.')

  const snapshot = snapshotValues(unit)
  for (const file of unit.files) backups.push(backupFile(file, stamp))
  // Snapshot pre-existing VALUES, not just names: setPassword OVERWRITES
  // same-named accounts, and rollback must write the old values back — deleting
  // only "new" keys would silently lose overwritten user data (review H2).
  const preExisting = new Map((await keytar.findCredentials(service)).map(({ account, password }) => [account, password]))
  try {
    for (const [key, value] of Object.entries(snapshot)) await keytar.setPassword(service, key, value)
    const newSource: SecretSource = {
      provider: 'os-keychain',
      service,
      ...(unit.source.override ? { override: true } : {}),
    }
    const values = await reloadViaKeychain(unit, newSource, homeDir)
    if (!snapshotCovered(snapshot, values)) {
      throw new Error('post-migration verification failed: keychain values differ from the plaintext snapshot.')
    }
    const foreign = Object.keys(values).filter((key) => !(key in snapshot))
    const warnings = foreign.length
      ? [`[mxenv] Warning: keychain service "${service}" also holds ${foreign.length} unrelated account(s) (e.g. "${foreign[0]}"); verify the service is not shared unexpectedly.`]
      : []
    rewriteDeclaredSource(unit, newSource, stamp, backups)
    // Verification passed against the new store; the plaintext copies go away
    // (0600 backups remain until the operator deletes them).
    for (const file of unit.files) rmSync(file)
    return { warnings }
  } catch (error) {
    const failed = restoreBackups(backups)
    for (const key of Object.keys(snapshot)) {
      if (preExisting.has(key)) {
        // Restore the overwritten old value — never leave the new value in place.
        await keytar.setPassword(service, key, preExisting.get(key)!).catch(() => {})
      } else {
        // Best-effort: remove the entries this run created, so a failed
        // migration leaves no orphan credentials behind.
        await keytar.deletePassword(service, key).catch(() => {})
      }
    }
    const message = error instanceof Error ? error.message : 'unknown failure'
    throw new Error(withRestoreOutcome(message, failed, backups))
  }
}

/**
 * Executes one unit. All failure paths restore plaintext and config from
 * backup before surfacing; error messages stay value-free. On failure the
 * backups are reported as retained — they are 0600 plaintext copies the
 * operator should delete by hand.
 */
export async function executeUnit(
  unit: MigrationUnit,
  target: MigrateTarget,
  options: { service?: string } = {},
  homeDir = homedir(),
): Promise<UnitOutcome> {
  if (unit.kind === 'global-implicit' && target === 'keychain') {
    return {
      unit, status: 'skipped', backups: [], warnings: [],
      detail: 'the global implicit file cannot migrate to os-keychain (its loading does not go through profiles); use --to dotenvx for it.',
    }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backups: string[] = []
  // 改名记账：rewriteDeclaredSource 把旧名配置 rename 至新名后，回滚必须还原到
  // 新名（读侧生效路径），否则回滚形同虚设（review S2）。
  // A zero-key unit has nothing to move; dotenvx encrypt would report "no
  // change" and leave a plaintext file behind while the report claims success.
  if (!unit.keyNames.length) {
    return { unit, status: 'skipped', backups: [], warnings: [], detail: 'no keys in the file(s); nothing to migrate.' }
  }
  try {
    const { warnings } = target === 'dotenvx'
      ? await migrateToDotenvx(unit, stamp, homeDir, backups)
      : await migrateToKeychain(unit, options.service || `mxenv:${unit.name}`, stamp, homeDir, backups)
    return { unit, status: 'migrated', backups, warnings, detail: '' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown failure'
    return { unit, status: 'failed', backups, warnings: [], detail: message }
  }
}

// ─── migrate --home：全局目录一次性迁移（home-migration D4） ───────────────
// copy → 旧目录改名留时间戳备份 → 值级等价验证（目标目录独立生效）→ 失败从
// 备份整目录还原+清半成品。顺序取"备份先于验证"（design D4 综合裁决）：spec
// 验证失败场景要求"从备份还原、stderr 指明备份路径"（失败时备份必须已存在），
// 且目标独立验证能暴露显式旧路径引用断裂。验证完成前目标内留 `.mxenv-verify-pending`
// 标记：崩溃后重跑不报 already migrated，回滚重启使验证必然发生（review N-2）。

export interface HomeMigrationResult {
  status: 'migrated' | 'noop' | 'conflict' | 'failed'
  /** Value-free operator message: paths + key names only. */
  detail: string
  exitCode: number
  /** Timestamped backup directory (success only). */
  backupPath?: string
  /** Global-library key names verified equivalent (value-free, base keys excluded). */
  keyNames: string[]
  /** shim PATH 重接指引（仅成功路径有值时，CLI 打到 stderr；review S-1）。 */
  rcHint?: string
}

/** 尽力删除（失败不抛）：仅用于冗余副本/半成品的清理。 */
function cleanupQuiet(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true })
  } catch { /* 保留原样，调用方无需中断 */ }
}

/**
 * 0.12.1：把迁移前态目标脚手架（aside，唯一副本）**非破坏性**并入半拷贝：
 * 源文件一律不动，目标缺失的复制过去；同名 `.jsonl`（审计日志）在行边界上
 * 追加合并；其余同名双留（并入侧另存 `<name>.fold-<stamp>`）。aside 只在
 * 迁移验证成功后由调用方删除——任何失败路径都把它原样还原回目标（review F1）。
 */
function mergeScaffoldingCopy(source: string, dest: string, stamp: string): void {
  const merge = (src: string, dst: string): void => {
    mkdirSync(dst, { recursive: true })
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      const from = join(src, entry.name)
      const to = join(dst, entry.name)
      if (entry.isDirectory()) {
        merge(from, to)
        continue
      }
      if (!existsSync(to)) {
        copyFileSync(from, to)
        continue
      }
      if (from.endsWith('.jsonl') && to.endsWith('.jsonl')) {
        // 行边界保护（review F4）：末行无换行时先补，防止两个 JSON 粘成一行。
        const base = readFileSync(to, 'utf8')
        const extra = readFileSync(from, 'utf8')
        appendFileSync(to, (base && !base.endsWith('\n') ? '\n' : '') + extra)
        continue
      }
      copyFileSync(from, join(dst, `${entry.name}.fold-${stamp}`))
    }
  }
  merge(source, dest)
}

/** Recursive copy that preserves permission bits（0600 检查不变靠此保持）。 */
function copyTree(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  chmodSync(dest, statSync(src).mode & 0o7777)
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name)
    const to = join(dest, entry.name)
    if (entry.isSymbolicLink()) {
      symlinkSync(readlinkSync(from), to)
    } else if (entry.isDirectory()) {
      copyTree(from, to)
    } else {
      copyFileSync(from, to)
      chmodSync(to, statSync(from).mode & 0o7777)
    }
  }
}

/** 全局库组合快照：空项目 cwd 隔离项目层，verificationEnv 为底（hermetic 纪律）。
 * 只保留有 provenance 的库键——PATH/HOME 等底座键不属全局库内容，不进等值
 * 比对与 keyNames/审计计数（home-migration review N-7）。 */
async function composeGlobalLibrary(homeDir: string, allowInsecureGlobal: boolean): Promise<Record<string, string>> {
  const cwd = mkdtempSync(join(tmpdir(), 'mxenv-home-verify-'))
  try {
    const layers = loadConfigLayers({ cwd, homeDir })
    const composition = await composeEnvironment(layers, {
      homeDir,
      baseEnvironment: verificationEnv(),
      allowInsecureGlobal,
    })
    // ProcessEnv 的值类型含 undefined；组合产物里值均为字符串（快照只做等值比较）。
    const environment = { ...composition.environment } as Record<string, string>
    return Object.fromEntries(Object.keys(composition.provenance).map((key) => [key, environment[key]]))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

/** 值级差异只出键名（值永不落输出）。 */
function keyDiff(expected: Record<string, string>, actual: Record<string, string>): string[] {
  const names = new Set([...Object.keys(expected), ...Object.keys(actual)])
  return [...names].filter((key) => expected[key] !== actual[key]).sort()
}

/** 崩溃残留的半拷贝相位清扫（review N-6）：`.mxenv.partial-*` 不参与全局目录解析，但不许累积。 */
function sweepStalePartials(homeDir: string, targetDir: string): void {
  const prefix = `${basename(targetDir)}.partial-`
  for (const name of readdirSync(homeDir)) {
    if (!name.startsWith(prefix)) continue
    try { rmSync(join(homeDir, name), { recursive: true, force: true }) } catch { /* 残留清扫尽力而为 */ }
  }
}

/**
 * 迁移成功后重接 shim PATH（review S-1）：rc 块烘死的是 shimsDir 绝对路径，
 * 旧目录改名走后 PATH 条目指向空无。只动工具自有标记块（新旧双认），逐文件
 * 如实报结果；无块/有失败时由调用方给 stderr 指引，不得静默。
 */
function rewriteRcBlocksForMigration(homeDir: string): { updated: string[]; failures: string[]; found: boolean } {
  const updated: string[] = []
  const failures: string[] = []
  let found = false
  for (const name of ['.zshrc', '.bashrc']) {
    const rcPath = join(homeDir, name)
    let existing: string
    try { existing = readFileSync(rcPath, 'utf8') } catch { continue }
    if (!hasRcBlock(existing)) continue
    found = true
    try {
      const replaced = replaceRcBlocks(existing, homeDir)
      if (replaced !== existing) {
        const tmp = `${rcPath}.mxenv-${process.pid}.tmp`
        writeFileSync(tmp, replaced.endsWith('\n') ? replaced : `${replaced}\n`)
        chmodSync(tmp, statSync(rcPath).mode) // 保权限位（0600 rc 不得摊成 0644）
        renameSync(tmp, rcPath)
      }
      updated.push(rcPath)
    } catch (error) {
      failures.push(`${rcPath} (${error instanceof Error ? error.message : 'unknown failure'})`)
    }
  }
  return { updated, failures, found }
}

export async function migrateHome(homeDir = homedir(), options: { allowInsecureGlobal?: boolean } = {}): Promise<HomeMigrationResult> {
  suppressLegacyHomeHint()
  const legacyDir = resolve(homeDir, LEGACY_GLOBAL_CONFIG_DIR)
  const targetDir = resolve(homeDir, GLOBAL_CONFIG_DIR)
  const markerName = '.mxenv-verify-pending'
  const markerPath = join(targetDir, markerName)
  /** 迁移前态目标脚手架的暂存名：fold 的唯一副本，验证成功后才清除，失败原样还原。 */
  const asideDir = `${targetDir}.scaffold-fold`
  const allowInsecureGlobal = options.allowInsecureGlobal ?? false

  const backupsOnDisk = () =>
    readdirSync(homeDir).filter((name) => name.startsWith(`${LEGACY_GLOBAL_CONFIG_DIR}.backup-`)).sort()

  /** 目标仅存自写脚手架（audit/shims）时折入半拷贝迁移，不按 conflict 拒绝。 */
  let mergeScaffolding = false

  // 崩溃残留自愈（review F1）：aside 是"迁移前态目标脚手架"的唯一副本——目标不在场
  // 就还原回去，让本轮从真实迁移前态开始；目标在场则保留为折入源（下方统一处理）。
  if (existsSync(asideDir) && !existsSync(targetDir)) {
    try {
      renameSync(asideDir, targetDir)
    } catch (error) {
      return {
        status: 'failed', exitCode: 1, keyNames: [],
        detail: `cannot restore pre-migration scaffolding from ${asideDir}: ${error instanceof Error ? error.message : 'unknown failure'} — rename it to ${targetDir} by hand, then re-run.`,
      }
    }
  }

  if (existsSync(targetDir)) {
    if (existsSync(markerPath)) {
      // 上次迁移在验证完成前中断（review N-2）：回滚到迁移前状态后重走全流程，
      // 让值级等价验证必然发生——绝不把未验证态报成 already migrated。
      let backupDir = ''
      try { backupDir = readFileSync(markerPath, 'utf8').trim() } catch { /* 落到磁盘扫描兜底 */ }
      if (!backupDir || !existsSync(backupDir)) {
        const candidates = backupsOnDisk()
        backupDir = candidates.length ? resolve(homeDir, candidates[candidates.length - 1]) : ''
      }
      try {
        rmSync(targetDir, { recursive: true, force: true })
      } catch (error) {
        return {
          status: 'failed', exitCode: 1, keyNames: [],
          detail: `interrupted migration detected (verification pending) but the incomplete ${targetDir} cannot be removed: ${error instanceof Error ? error.message : 'unknown failure'} — remove it by hand, restore the matching ${LEGACY_GLOBAL_CONFIG_DIR}.backup-<ts> directory backup to ${legacyDir}, then re-run.`,
        }
      }
      if (!existsSync(legacyDir) && backupDir && existsSync(backupDir)) {
        try {
          renameSync(backupDir, legacyDir)
        } catch (error) {
          return {
            status: 'failed', exitCode: 1, keyNames: [],
            detail: `interrupted migration detected (verification pending); restoring the directory backup ${backupDir} failed: ${error instanceof Error ? error.message : 'unknown failure'} — rename it to ${legacyDir} by hand, then re-run.`,
          }
        }
      }
      if (!existsSync(legacyDir)) {
        return {
          status: 'failed', exitCode: 1, keyNames: [],
          detail: `interrupted migration detected (verification pending) but neither ${legacyDir} nor a directory backup to restore from was found — resolve by hand, then re-run.`,
        }
      }
      // 已回到迁移前状态：落入下方正常流程（重新快照、copy、备份、验证）。
    } else if (existsSync(legacyDir)) {
      if (hasGlobalDataAt(targetDir)) {
        return {
          status: 'conflict', exitCode: 1, keyNames: [],
          detail: `both ${targetDir} and ${legacyDir} exist — refusing to overwrite (no writes made). Resolve by hand: inspect both, keep what you need in ${targetDir}, then rename ${legacyDir} away and re-run.`,
        }
      }
      // 目标只剩自写脚手架（audit/shims 等，0.12.1 写只落新名的产物）不算冲突：
      // 折入半拷贝后放行迁移（foldScaffoldingInto），旧数据照常备份+验证。
      mergeScaffolding = true
    } else {
      // 已迁移终态：aside（若有）是崩溃残留的冗余脚手架副本，随成功态一并清除。
      if (existsSync(asideDir)) cleanupQuiet(asideDir)
      return { status: 'noop', exitCode: 0, keyNames: [], detail: `already migrated: ${targetDir} is in use.` }
    }
  }
  if (!existsSync(legacyDir)) {
    // 还原失败的残局（数据只在目录备份里）不得报 nothing to migrate（review N-5）。
    const orphans = backupsOnDisk()
    if (orphans.length) {
      return {
        status: 'failed', exitCode: 1, keyNames: [],
        detail: `nothing at ${legacyDir} or ${targetDir}, but directory backup(s) hold the global library: ${orphans.join(', ')} — a previous restore likely failed; restore manually by renaming the right backup to ${legacyDir}, then re-run.`,
      }
    }
    return { status: 'noop', exitCode: 0, keyNames: [], detail: `nothing to migrate: no legacy ${legacyDir} found.` }
  }

  sweepStalePartials(homeDir, targetDir)

  // 迁移前快照（目标不在场，回落读旧目录）。
  let before: Record<string, string>
  try {
    before = await composeGlobalLibrary(homeDir, allowInsecureGlobal)
  } catch (error) {
    return {
      status: 'failed', exitCode: 1, keyNames: [],
      detail: `cannot load the global library before migrating: ${error instanceof Error ? error.message : 'unknown failure'}; nothing was changed.`,
    }
  }

  /** 清理如实报（review N-5）：失败不吞，返回可进 detail 的说明。 */
  const cleanup = (path: string): string | null => {
    try {
      rmSync(path, { recursive: true, force: true })
      return null
    } catch (error) {
      return `cleanup incomplete for ${path} (${error instanceof Error ? error.message : 'unknown failure'}) — remove it by hand`
    }
  }

  // 半拷贝不落生效名（review N-6）：先拷到临时名，整树就绪（含验证标记）再改名
  // 入位——并存读者在任何相位都只会读到完整的旧库或完整的新库。
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = resolve(homeDir, `${LEGACY_GLOBAL_CONFIG_DIR}.backup-${stamp}`)
  const partialDir = `${targetDir}.partial-${stamp}`
  try {
    copyTree(legacyDir, partialDir)
    // 验证标记随整树入位（review N-2）：验证通过才删除；崩溃后重跑走回滚重启。
    writeFileSync(join(partialDir, markerName), `${backupDir}\n`)
    if (mergeScaffolding) {
      // 原子挪开留唯一副本（review F1）：之后一切失败路径都把 aside 原样还原回目标。
      renameSync(targetDir, asideDir)
      // 竞争复核：挪开瞬间若混入真实数据（并发写入），还原并按冲突中止。
      if (hasGlobalDataAt(asideDir)) {
        renameSync(asideDir, targetDir)
        cleanup(partialDir)
        return {
          status: 'conflict', exitCode: 1, keyNames: [],
          detail: `both ${targetDir} and ${legacyDir} appeared to hold real data mid-migration — nothing was changed; inspect both, keep what you need in ${targetDir}, then rename ${legacyDir} away and re-run.`,
        }
      }
    }
    if (existsSync(asideDir)) mergeScaffoldingCopy(asideDir, partialDir, stamp)
    renameSync(partialDir, targetDir)
  } catch (error) {
    // rename 是原子的：catch 里目标绝不是本进程产物（并发抢先建目标时误删即事故），
    // 只清自己的临时名；aside（若已挪出）还原回目标，迁移前态不丢。
    const cleanupIssue = cleanup(partialDir)
    let asideIssue = ''
    if (existsSync(asideDir) && !existsSync(targetDir)) {
      try { renameSync(asideDir, targetDir) } catch { asideIssue = `; restore ${asideDir} to ${targetDir} failed — rename it back by hand` }
    }
    return {
      status: 'failed', exitCode: 1, keyNames: [],
      detail: `copy failed: ${error instanceof Error ? error.message : 'unknown failure'}; ${cleanupIssue ?? `removed partial copy`}, original preserved at ${legacyDir}.${asideIssue}`,
    }
  }

  // 迁移前留时间戳备份：旧目录改名（验证失败可整目录原子还原）。
  try {
    renameSync(legacyDir, backupDir)
  } catch (error) {
    const cleanupIssue = [cleanup(partialDir), cleanup(targetDir)].find(Boolean) ?? null
    let asideIssue = ''
    if (existsSync(asideDir)) {
      try { renameSync(asideDir, targetDir) } catch { asideIssue = `; restore ${asideDir} to ${targetDir} failed — rename it back by hand` }
    }
    return {
      status: 'failed', exitCode: 1, keyNames: [],
      detail: `backup rename failed: ${error instanceof Error ? error.message : 'unknown failure'}; ${cleanupIssue ?? `removed partial copy`}, original preserved at ${legacyDir}.${asideIssue}`,
    }
  }

  // 迁移后值级等价验证：目标目录独立生效（旧目录已改名，显式旧路径引用在此暴露）。
  const restoreFromBackup = (why: string): HomeMigrationResult => {
    // 还原是否成立只认 rename 结果（review N-5：existsSync 兜底会谎报成功）。
    let restored = false
    try { renameSync(backupDir, legacyDir); restored = true } catch { /* 判定在 detail 里如实落 */ }
    const cleanupIssue = cleanup(targetDir)
    // aside（迁移前态目标脚手架唯一副本）还原回目标，0.12.1 的审计/shim 不丢（review F1）。
    let asideIssue = ''
    if (existsSync(asideDir)) {
      try { renameSync(asideDir, targetDir) } catch { asideIssue = `; RESTORE FAILED for ${asideDir} — rename it to ${targetDir} by hand` }
    }
    return {
      status: 'failed', exitCode: 1, keyNames: [],
      detail: `verification failed: ${why}; ${restored ? `restored from backup ${backupDir} (directory backup)` : `RESTORE FAILED — restore manually by renaming the directory backup ${backupDir} to ${legacyDir}`}; ${cleanupIssue ?? `removed partial ${targetDir}`}${asideIssue}.`,
    }
  }
  let after: Record<string, string>
  try {
    after = await composeGlobalLibrary(homeDir, allowInsecureGlobal)
  } catch (error) {
    return restoreFromBackup(error instanceof Error ? error.message : 'unknown failure')
  }
  const diff = keyDiff(before, after)
  if (diff.length) {
    // 失败 detail 给成因与下一步（review N-4）：差异键名 + 典型断裂面 + 可重跑。
    return restoreFromBackup(
      `keys differ after migration: ${diff.join(', ')} — likely a source in the global config explicitly references the legacy path (${legacyDir}/…); fix those references (values stay in place) and re-run`,
    )
  }

  try { rmSync(markerPath) } catch { /* 标记残留会被下次重跑当中断处理并自愈 */ }
  // 验证通过：aside（迁移前态脚手架副本）已并入目标，冗余副本清除。
  if (existsSync(asideDir)) cleanupQuiet(asideDir)

  // shim PATH 重接（review S-1）：rc 块烘死旧 shimsDir，不重写即断供。
  const rc = rewriteRcBlocksForMigration(homeDir)
  const rcSummary = rc.updated.length ? `; rc PATH block rewired in ${rc.updated.join(', ')}` : ''
  const rcHint = (!rc.found || rc.failures.length)
    ? `[mxenv] shim PATH wiring: run \`mxenv-cli shell-init --write\` to point your rc block at ${shimsDir(homeDir)}${rc.failures.length ? ` (rc rewrite failed: ${rc.failures.join('; ')})` : ' (no marked rc block found)'}.`
    : undefined
  return {
    status: 'migrated', exitCode: 0,
    keyNames: Object.keys(before).sort(),
    detail: `global directory migrated: ${legacyDir} -> ${targetDir} (${Object.keys(before).length} keys verified equivalent)${rcSummary}.` +
      ` If any generated shims still delegate to the old \`mx-env run\` name (removed in 0.13.x), re-run \`mxenv-cli shell-init\` to regenerate them.`,
    backupPath: backupDir,
    rcHint,
  }
}
