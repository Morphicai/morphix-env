/**
 * config-actions — 项目接线的高风险写动作（唯一写入口，L2/L3 共享）
 *
 * 原则：
 * - 只写 mxenv.config.json 中的接线，不写任何密钥值。
 * - preview 与 commit 由服务端重算同一份 diff/fingerprint，不信任 UI 摘要。
 * - 写前备份原文，临时文件 + rename 原子替换；写后校验失败则回滚。
 * - 全局面板接线编辑不在此入口；caller 必须明确 project cwd。
 */
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'
import type { AuditEvent, AuditWiringSource, MxEnvConfig, ProfileInput, SecretSource } from './contracts'
import { validateConfig } from './contracts'
import { writeAudit } from './audit'
import { resolveAuditConfigPath } from './value-reveal'

export type ConfigAction =
  | { type: 'add-source'; name: string; source: SecretSource; profile?: string }
  | { type: 'update-source'; name: string; source: SecretSource }
  | { type: 'remove-source'; name: string }
  | { type: 'migrate-legacy' }

export interface WiringSourceSummary extends AuditWiringSource {
  /** UI-compatible alias for the declared key count; audits use `keys`. */
  keyCount?: number
}

export interface ConfigActionPreview {
  actionType: ConfigAction['type']
  configPath: string
  fingerprint: string
  before: WiringSourceSummary[]
  after: WiringSourceSummary[]
}

export interface ConfigActionResult extends ConfigActionPreview {
  backupPath: string
}

export class ConfigActionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public audited = false,
  ) { super(message); this.name = 'ConfigActionError' }
}

interface ModernConfig extends MxEnvConfig {
  sources: Record<string, SecretSource>
  profiles: Record<string, ProfileInput>
  defaultProfile: string
}

function profileSourceNames(profile: ProfileInput): string[] {
  return Array.isArray(profile) ? profile : profile.sources
}

function withoutProfileSource(profile: ProfileInput, name: string): ProfileInput {
  return Array.isArray(profile)
    ? profile.filter((item) => item !== name)
    : { ...profile, sources: profile.sources.filter((item) => item !== name) }
}

function sourceSummary(name: string, source: SecretSource, profiles: Record<string, ProfileInput>, order: number): WiringSourceSummary {
  const summary: WiringSourceSummary = {
    name,
    provider: source.provider,
    order,
    ...(source.override !== undefined ? { override: source.override } : {}),
    profiles: Object.entries(profiles).filter(([, definition]) => profileSourceNames(definition).includes(name)).map(([profile]) => profile),
  }
  if ('files' in source && source.files) summary.files = [...source.files]
  if ('paths' in source && source.paths) summary.paths = [...source.paths]
  if ('env' in source && source.env) summary.env = source.env
  if ('service' in source && source.service) summary.service = source.service
  if ('keys' in source && source.keys) {
    summary.keys = source.keys.length
    summary.keyCount = source.keys.length
  }
  return summary
}

function summaries(config: ModernConfig): WiringSourceSummary[] {
  return Object.entries(config.sources).map(([name, source], order) => sourceSummary(name, source, config.profiles, order))
}

function validateName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name) || name.startsWith('__mx')) {
    throw new ConfigActionError('invalid-source-name', 'Source names must be 1–64 letters, digits, _ or - and cannot use the reserved __mx prefix')
  }
}

function validateSource(name: string, source: unknown): asserts source is SecretSource {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new ConfigActionError('invalid-source', 'A source object is required')
  }
  const probe = {
    sources: { [name]: source as SecretSource },
    profiles: { default: [name] },
    defaultProfile: 'default',
  }
  try {
    validateConfig(probe, 'panel wiring editor')
  } catch (err) {
    throw new ConfigActionError('invalid-source', err instanceof Error ? err.message : 'Invalid source wiring')
  }
}

function readProjectConfig(cwd: string): { configPath: string; raw: string; config: MxEnvConfig } {
  const configPath = join(cwd, 'mxenv.config.json')
  if (!existsSync(configPath)) {
    throw new ConfigActionError('config-not-found', 'No mxenv.config.json exists in this project')
  }
  let raw: string
  let config: MxEnvConfig
  try {
    raw = readFileSync(configPath, 'utf8')
    config = JSON.parse(raw) as MxEnvConfig
    validateConfig(config, configPath)
  } catch (err) {
    if (err instanceof ConfigActionError) throw err
    throw new ConfigActionError('invalid-config', `Cannot edit invalid project wiring: ${err instanceof Error ? err.message : 'parse failed'}`)
  }
  return { configPath, raw, config }
}

function asModern(config: MxEnvConfig): ModernConfig {
  if (!config.sources || !config.profiles || !config.defaultProfile) {
    throw new ConfigActionError('legacy-config', 'Migrate legacy project wiring before editing individual sources')
  }
  return config as ModernConfig
}

function migrateLegacy(config: MxEnvConfig): ModernConfig {
  if (config.sources || config.profiles || config.defaultProfile) {
    throw new ConfigActionError('already-modern', 'Project wiring already uses sources and profiles')
  }
  const sources: Record<string, SecretSource> = {}
  const names: string[] = []
  if (config.infisical) {
    sources.infisical = { ...config.infisical, provider: 'infisical', override: true }
    names.push('infisical')
  }
  if (config.envFiles?.length) {
    sources.local = {
      provider: 'local',
      files: [...config.envFiles],
      optional: true,
      override: true,
    }
    names.push('local')
  }
  if (!names.length) throw new ConfigActionError('nothing-to-migrate', 'Legacy wiring has no Infisical source or env files')
  const migrated: ModernConfig = {
    sources,
    profiles: { default: names },
    defaultProfile: 'default',
  }
  validateConfig(migrated, 'legacy migration')
  return migrated
}

function applyActionToConfig(config: MxEnvConfig, action: ConfigAction): ModernConfig {
  if (action.type === 'migrate-legacy') return migrateLegacy(config)
  const modern = asModern(config)
  const next = structuredClone(modern)
  const { name } = action
  validateName(name)
  if (action.type === 'add-source') {
    if (next.sources[name]) throw new ConfigActionError('source-exists', `Source already exists: ${name}`)
    validateSource(name, action.source)
    next.sources[name] = structuredClone(action.source)
    const profile = action.profile || next.defaultProfile
    const selected = next.profiles[profile]
    if (!selected) throw new ConfigActionError('profile-not-found', `Profile not found: ${profile}`)
    const names = profileSourceNames(selected)
    if (!names.includes(name)) names.push(name)
  } else if (action.type === 'update-source') {
    if (!next.sources[name]) throw new ConfigActionError('source-not-found', `Source not found: ${name}`)
    validateSource(name, action.source)
    next.sources[name] = structuredClone(action.source)
  } else if (action.type === 'remove-source') {
    if (!next.sources[name]) throw new ConfigActionError('source-not-found', `Source not found: ${name}`)
    delete next.sources[name]
    for (const [profile, definition] of Object.entries(next.profiles)) {
      next.profiles[profile] = withoutProfileSource(definition, action.name)
    }
  } else {
    throw new ConfigActionError('invalid-action', 'Unsupported wiring action')
  }
  try {
    validateConfig(next, 'panel wiring editor')
  } catch (err) {
    throw new ConfigActionError('invalid-result', err instanceof Error ? err.message : 'Invalid resulting wiring')
  }
  return next
}

function fingerprint(configPath: string, action: ConfigAction, before: WiringSourceSummary[], after: WiringSourceSummary[]): string {
  return createHash('sha256').update(JSON.stringify({ configPath, action, before, after })).digest('hex')
}

interface ConfigActionPlan {
  preview: ConfigActionPreview
  next: ModernConfig
  originalRaw: string
}

function planConfigAction(cwd: string, action: ConfigAction): ConfigActionPlan {
  const { configPath, raw, config } = readProjectConfig(cwd)
  const next = applyActionToConfig(config, action)
  const before = summaries(asModernForSummary(config, next))
  const after = summaries(next)
  return {
    next,
    originalRaw: raw,
    preview: {
      actionType: action.type,
      configPath,
      before,
      after,
      fingerprint: fingerprint(configPath, action, before, after),
    },
  }
}

/** 只读预览：解析失败 fail closed，不把配置原文返回给 UI。 */
export function prepareConfigAction(params: { cwd: string; action: ConfigAction }): ConfigActionPreview {
  return planConfigAction(params.cwd, params.action).preview
}

function asModernForSummary(original: MxEnvConfig, migrated: ModernConfig): ModernConfig {
  if (original.sources && original.profiles && original.defaultProfile) return original as ModernConfig
  // legacy 迁移的 before 是空接线清单；after 展示完整迁移结果。
  return { ...migrated, sources: {}, profiles: {}, defaultProfile: migrated.defaultProfile }
}

function writeAtomic(path: string, content: string, mode = 0o600): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(tmp, content, { encoding: 'utf8', mode, flag: 'wx' })
    renameSync(tmp, path)
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp)
  }
}

/** 供失败恢复与后续显式 restore 命令复用；备份内容不回显。 */
export function rollbackConfigWrite(configPath: string, backupPath: string): void {
  if (!existsSync(backupPath)) throw new ConfigActionError('backup-not-found', 'No wiring backup is available for rollback')
  writeAtomic(configPath, readFileSync(backupPath, 'utf8'), 0o600)
}

export interface ApplyConfigActionParams {
  cwd: string
  action: ConfigAction
  expectedFingerprint: string
  subject?: AuditEvent['via']
  profileName?: string
  homeDir?: string
}

/** commit：必须用当前文件重算并匹配 preview 指纹，再备份、原子写、校验、审计。 */
export function applyConfigAction(params: ApplyConfigActionParams): ConfigActionResult {
  const started = Date.now()
  const homeDir = params.homeDir || homedir()
  const sourceName = 'name' in params.action ? params.action.name : 'legacy'
  const auditConfigPath = () => configPath || resolveAuditConfigPath({ homeDir }, params.cwd)
  const fail = (err: unknown): never => {
    const safe = err instanceof ConfigActionError
      ? err
      : new ConfigActionError('write-failed', 'Wiring write failed; the original configuration was preserved or restored')
    writeAudit({
      timestamp: new Date().toISOString(),
      profile: params.profileName ?? '-',
      sources: [sourceName],
      keys: [],
      outcome: 'failure',
      durationMs: Date.now() - started,
      via: params.subject,
      action: 'wiring-write',
      reason: safe.code,
      configPath: auditConfigPath(),
    }, homeDir)
    safe.audited = true
    throw safe
  }

  let configPath = ''
  let backupPath = ''
  let configWritten = false
  try {
    const plan = planConfigAction(params.cwd, params.action)
    const preview = plan.preview
    configPath = preview.configPath
    if (params.expectedFingerprint !== preview.fingerprint) {
      throw new ConfigActionError('stale-fingerprint', 'Wiring changed after preview; review a fresh diff before confirming')
    }
    backupPath = `${configPath}.bak`
    writeAtomic(backupPath, plan.originalRaw, 0o600)
    const next = plan.next
    writeAtomic(configPath, `${JSON.stringify(next, null, 2)}\n`, 0o600)
    configWritten = true
    const verified = readProjectConfig(params.cwd).config
    if (JSON.stringify(verified) !== JSON.stringify(next)) {
      throw new ConfigActionError('verification-failed', 'Written wiring did not verify; restoring the backup')
    }
    const result = { ...preview, backupPath }
    writeAudit({
      timestamp: new Date().toISOString(),
      profile: params.profileName ?? '-',
      sources: [sourceName],
      keys: [],
      outcome: 'success',
      durationMs: Date.now() - started,
      via: params.subject,
      action: 'wiring-write',
      reason: params.action.type,
      configPath: auditConfigPath(),
      wiring: { before: preview.before, after: preview.after },
    }, homeDir)
    return result
  } catch (err) {
    if (configWritten && configPath && backupPath) {
      try {
        rollbackConfigWrite(configPath, backupPath)
        configWritten = false
      } catch {
        return fail(new ConfigActionError('rollback-failed', 'Wiring verification failed and the backup could not be restored'))
      }
    }
    return fail(err)
  }
}
