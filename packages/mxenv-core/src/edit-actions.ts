/**
 * L1 逐键写动作：L2 editor 与 L3 panel 共用的白名单 set/delete 能力。
 * 只支持 local / dotenvx / os-keychain；远端 provider 的写回不属于此边界。
 * 值只作为本调用的内存参数与 provider 写入输入，永不进返回值、日志或审计。
 */
import { execFileSync } from 'child_process'
import { randomBytes } from 'crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'path'
import { ensureCommand, type SourceEntry } from './sources'
import { expandHomePath } from './config'
import { isDotenvxEncrypted } from './env'
import { deleteKeychainValue, loadKeyring, writeKeychainValue } from './keyring'
import { writeAudit } from './audit'
import { resolveAuditConfigPath } from './value-reveal'

export type EditAction = 'set' | 'delete'
export type EditSubject = 'editor' | 'host'

export interface EditActionParams {
  action: EditAction
  key: string
  /** set 必填且非空；delete 忽略。空值不会被隐式当成删除。 */
  value?: string
  entry: SourceEntry
  fileIndex?: number
  subject: EditSubject
  profileName?: string
  /** 审计归属的项目目录。 */
  cwd?: string
  options?: { homeDir?: string }
}

export interface EditActionResult {
  action: EditAction
  key: string
  source: string
  provider: 'local' | 'dotenvx' | 'os-keychain'
  fileIndex?: number
}

export class EditActionError extends Error {
  readonly audited = true
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'EditActionError'
  }
}

function resolveSourceFile(entry: SourceEntry, fileIndex: number | undefined, homeDir: string): { file: string; fileIndex: number } {
  if (entry.source.provider !== 'local' && entry.source.provider !== 'dotenvx') throw new EditActionError('unsupported-provider', 'This source does not use dotenv files.')
  const index = fileIndex ?? 0
  if (!Number.isInteger(index) || index < 0 || index >= entry.source.files.length) {
    throw new EditActionError('invalid-file-index', 'The file index is outside this source.')
  }
  const expanded = expandHomePath(entry.source.files[index], homeDir)
  return { file: isAbsolute(expanded) ? expanded : resolve(entry.baseDir, expanded), fileIndex: index }
}

/** 与 editor/migrate 相同的 dotenvx 环境白名单：父环境不得覆盖文件值或替换私钥。 */
function dotenvxEnv(file: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
    ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}),
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
    ...(process.env.TMP ? { TMP: process.env.TMP } : {}),
    ...(process.env.TEMP ? { TEMP: process.env.TEMP } : {}),
    PATH: [dirname(process.execPath), process.env.PATH || ''].filter(Boolean).join(delimiter),
    DOTENVX_NO_NATIVE: 'true',
  }
  // 没有旁边 .env.keys 的既有加密文件可能由 OS keychain 保管私钥。
  if (!existsSync(join(dirname(file), '.env.keys')) && isDotenvxEncrypted(file)) delete env.DOTENVX_NO_NATIVE
  return env
}

function mutateDotenvx(action: EditAction, key: string, value: string | undefined, file: string): void {
  // dotenvx set 没有 stdin/env 值通道；argv 暴露限制沿用原 editor 文档与验收口径。
  const args = action === 'set' ? ['set', key, '-f', file, '--', value ?? ''] : ['del', key, '-f', file]
  const command = ensureCommand('dotenvx', 'edit-actions', 'dotenvx')
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  execFileSync(command, args, { env: dotenvxEnv(file), cwd: dirname(file), stdio: ['ignore', 'ignore', 'ignore'] })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 原子写本地 dotenv，保留无关行、注释、export 前缀与原有 EOL 风格。 */
function mutateLocal(action: EditAction, key: string, value: string | undefined, file: string): void {
  if (isDotenvxEncrypted(file)) throw new EditActionError('encrypted-file', 'This file is dotenvx-encrypted; use a dotenvx source instead of overwriting ciphertext as plaintext.')
  const original = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  const lines = original ? original.split(/\r\n|\n|\r/) : []
  const pattern = new RegExp(`^(\\s*(?:export\\s+)?)${escapeRegExp(key)}\\s*=.*$`)
  let found = false
  const next = lines.flatMap((line) => {
    const match = pattern.exec(line)
    if (!match) return [line]
    found = true
    return action === 'delete' ? [] : [`${match[1]}${key}=${JSON.stringify(value)}`]
  })
  if (action === 'set' && !found) {
    if (next.length && next[next.length - 1] !== '') next.push('')
    next.push(`${key}=${JSON.stringify(value)}`)
  }
  // 始终保留文件末尾换行；空文件删除不存在键保持为空。
  let content = next.join(eol)
  if (content && !content.endsWith(eol)) content += eol

  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const temporary = join(dirname(file), `.${basename(file)}.mxenv-${process.pid}-${randomBytes(6).toString('hex')}.tmp`)
  try {
    writeFileSync(temporary, content, { mode: 0o600 })
    renameSync(temporary, file)
    chmodSync(file, 0o600)
  } finally {
    rmSync(temporary, { force: true })
  }
}

export async function applyEditAction(params: EditActionParams): Promise<EditActionResult> {
  const startedAt = Date.now()
  const homeDir = params.options?.homeDir || homedir()
  let fileIndex: number | undefined
  try {
    if (params.action !== 'set' && params.action !== 'delete') throw new EditActionError('invalid-action', 'Unknown edit action.')
    if (params.action === 'set' && !params.value) throw new EditActionError('invalid-value', 'A non-empty value is required for set; delete is a separate action.')
    const provider = params.entry.source.provider
    if (provider !== 'local' && provider !== 'dotenvx' && provider !== 'os-keychain') {
      throw new EditActionError('unsupported-provider', `Provider "${provider}" is read-only in this editor.`)
    }
    if (provider === 'os-keychain') {
      if (!params.key.trim()) throw new EditActionError('invalid-key', 'Keychain account names must not be empty.')
      const keyring = await loadKeyring()
      if (!keyring) throw new EditActionError('keychain-unavailable', 'Keychain editing needs a usable @napi-rs/keyring native module.')
      if (params.action === 'delete') deleteKeychainValue(keyring, params.entry.source, params.key)
      else writeKeychainValue(keyring, params.entry.source, params.key, params.value as string)
    } else {
      if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(params.key)) {
        throw new EditActionError('invalid-key', 'Key names must match [A-Za-z_][A-Za-z0-9_.]*.')
      }
      if (provider === 'dotenvx' && params.action === 'set' && (params.value as string).includes('$')) {
        throw new EditActionError('unsupported-value', 'dotenvx expands $name sequences on load, so this value cannot be stored faithfully.')
      }
      const target = resolveSourceFile(params.entry, params.fileIndex, homeDir)
      fileIndex = target.fileIndex
      if (provider === 'dotenvx') mutateDotenvx(params.action, params.key, params.value, target.file)
      else mutateLocal(params.action, params.key, params.value, target.file)
    }
    writeAudit({
      timestamp: new Date().toISOString(), profile: params.profileName ?? '-', sources: [params.entry.name], keys: [params.key],
      outcome: 'success', durationMs: Date.now() - startedAt, via: params.subject, action: params.action,
      configPath: resolveAuditConfigPath({ homeDir }, params.cwd),
    }, homeDir)
    return { action: params.action, key: params.key, source: params.entry.name, provider, ...(fileIndex !== undefined ? { fileIndex } : {}) }
  } catch (error) {
    writeAudit({
      timestamp: new Date().toISOString(), profile: params.profileName ?? '-', sources: [params.entry.name], keys: params.key ? [params.key] : [],
      outcome: 'failure', durationMs: Date.now() - startedAt, via: params.subject, action: params.action,
      configPath: resolveAuditConfigPath({ homeDir }, params.cwd),
    }, homeDir)
    if (error instanceof EditActionError) throw error
    // provider stderr/原生错误不透出：第三方错误文本不属于可信安全边界。
    throw new EditActionError('write-failed', `Could not ${params.action} this key; no provider error details were exposed.`)
  }
}
