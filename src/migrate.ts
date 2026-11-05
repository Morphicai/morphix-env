import { execFileSync } from 'child_process'
import { chmodSync, copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, isAbsolute, join, resolve } from 'path'
import { parse as dotenvParse } from 'dotenv'
import {
  type ConfigLayers,
  type LocalSource,
  type SecretSource,
  expandHomePath,
} from './config'
import { GLOBAL_DOTENV_SOURCE } from './composition'
import { isDotenvxEncrypted, parseEnvFile } from './env'
import { ensureCommand, loadKeytar, loadSource, type SourceEntry } from './sources'

export type MigrateTarget = 'dotenvx' | 'keychain'

/**
 * One migratable plaintext unit. `global-implicit` is the hardcoded
 * ~/.mx-env/.env source (dotenvx target only — its loading does not go through
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

function backupFile(file: string, stamp: string): string {
  const backup = `${file}.mx-env-backup-${stamp}`
  copyFileSync(file, backup)
  chmodSync(backup, 0o600)
  return backup
}

const BACKUP_MARK = '.mx-env-backup-'

/**
 * Restores every backup over its original. Returns the paths that could NOT be
 * restored — the caller must surface them instead of claiming a clean restore,
 * otherwise a half-restored unit would leave ciphertext being loaded as
 * plaintext with no alarm.
 */
function restoreBackups(backups: string[]): string[] {
  const failed: string[] = []
  for (const backup of backups) {
    // lastIndexOf: a source file may itself carry the mark in its name.
    const original = backup.slice(0, backup.lastIndexOf(BACKUP_MARK))
    try {
      if (original && existsSync(backup)) copyFileSync(backup, original)
    } catch {
      if (original) failed.push(original)
    }
  }
  return failed
}

/** Appends the restore outcome to a failure message; never claims a restore that did not happen. */
function withRestoreOutcome(message: string, failed: string[], backups: string[]): string {
  if (failed.length) {
    return `${message} RESTORE FAILED for: ${failed.join(', ')} — restore manually from the .mx-env-backup-* copies${backups.length ? ` (${backups.join(', ')})` : ''}.`
  }
  return `${message} Plaintext and configuration were restored from backup${backups.length ? ` (${backups.join(', ')})` : ''}.`
}

function equivalent(expected: Record<string, string>, actual: Record<string, string>): boolean {
  const expectedKeys = Object.keys(expected).sort()
  const actualKeys = Object.keys(actual).sort()
  if (expectedKeys.length !== actualKeys.length) return false
  return expectedKeys.every((key, index) => key === actualKeys[index] && expected[key] === actual[key])
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
        warnings.push(`[morphix-env] WARNING: ${path} is inside a git repository and NOT git-ignored — this file holds the decryption key and must never be committed.`)
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
 * dotenvx verification goes through `decrypt --stdout`, NOT `run`: run injects
 * into a child env that already contains this process's variables, and without
 * --overload a same-named shell export would shadow the file value and produce
 * false mismatches. decrypt keeps values in the pipe and is a genuinely
 * independent code path from the snapshot's dotenv.parse. --no-native pins the
 * file model so verification proves the `.env.keys` on disk, never a
 * keychain-custodian fluke.
 */
function decryptValues(command: string, files: string[]): Record<string, string> {
  const values: Record<string, string> = {}
  for (const file of files) {
    const output = execFileSync(command, ['decrypt', '-f', file, '--stdout', '--no-native'], {
      encoding: 'utf8',
      cwd: dirname(file),
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    // Strip exactly the public-key markers the encrypted file declares (they
    // are dotenvx machinery, never part of the plaintext snapshot) — not a
    // prefix match, which could eat a user key named DOTENV_PUBLIC_KEY_*.
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
    if (!equivalent(snapshot, values)) {
      throw new Error('post-migration verification failed: decrypted values differ from the plaintext snapshot.')
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
        warnings.push(`[morphix-env] Warning: declared file "${dropped}" did not exist at migration time and was dropped from the rewritten source; re-add it to the config if it returns.`)
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
 * `mx-env:<source>` collides across projects, and manual entries exist). Foreign
 * accounts are reported as a warning, never a failure (review H1).
 */
function snapshotCovered(expected: Record<string, string>, actual: Record<string, string>): boolean {
  return Object.keys(expected).every((key) => actual[key] === expected[key])
}

async function migrateToKeychain(unit: MigrationUnit, service: string, stamp: string, homeDir: string, backups: string[]): Promise<{ warnings: string[] }> {
  if (process.platform !== 'darwin') throw new Error('the os-keychain target is supported on macOS only; use --to dotenvx on this machine.')
  const keytar = await loadKeytar()
  if (!keytar) throw new Error('the os-keychain target needs the optional native module "keytar"; reinstall morphix-env or use --to dotenvx.')

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
      ? [`[morphix-env] Warning: keychain service "${service}" also holds ${foreign.length} unrelated account(s) (e.g. "${foreign[0]}"); verify the service is not shared unexpectedly.`]
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
  // A zero-key unit has nothing to move; dotenvx encrypt would report "no
  // change" and leave a plaintext file behind while the report claims success.
  if (!unit.keyNames.length) {
    return { unit, status: 'skipped', backups: [], warnings: [], detail: 'no keys in the file(s); nothing to migrate.' }
  }
  try {
    const { warnings } = target === 'dotenvx'
      ? await migrateToDotenvx(unit, stamp, homeDir, backups)
      : await migrateToKeychain(unit, options.service || `mx-env:${unit.name}`, stamp, homeDir, backups)
    return { unit, status: 'migrated', backups, warnings, detail: '' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown failure'
    return { unit, status: 'failed', backups, warnings: [], detail: message }
  }
}
