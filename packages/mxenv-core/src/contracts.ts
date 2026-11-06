// L0 契约层（纯，无 IO）—— config schema、`mx-env://` 引用语法、组合/审计类型、
// redaction 规则的唯一定义地。L1 能力模块（config/refs/composition/audit/
// sources/redaction）从此处 import 并 re-export 原符号，既有导入面不倒退；
// 主入口 index.ts 同样 re-export。此入口的零 IO 副作用与导出面（不含值能力
// compose/revealSingle）由 test/contracts.test.ts 经 noio 探针守护。

// ─── config schema：常量与纯类型/结构定义 ─────────────────────────

export const CONFIG_FILE = 'mx-env.config.json'
export const GLOBAL_CONFIG_DIR = '.mx-env'
export const GLOBAL_CONFIG_FILE = 'config.json'
export const GLOBAL_ENV_FILE = '.env'

export type SecretProvider = 'infisical' | 'local' | 'dotenvx' | 'os-keychain' | 'doppler' | 'plugin'

interface SourceBase {
  /** A later source may replace keys supplied by an earlier source. */
  override?: boolean
  /** Only a missing local file source may be optional. */
  optional?: boolean
}

export interface InfisicalSource extends SourceBase {
  provider: 'infisical'
  paths: string[]
  projectId?: string
  siteUrl?: string
  env?: string
  envPrefix?: string
}

export interface LocalSource extends SourceBase {
  provider: 'local'
  files: string[]
}

export interface DotenvxSource extends SourceBase {
  provider: 'dotenvx'
  files: string[]
}

export interface KeychainSource extends SourceBase {
  provider: 'os-keychain'
  service: string
  platform?: 'macos'
}

export interface DopplerSource extends SourceBase {
  provider: 'doppler'
  project: string
  config: string
}

/**
 * External provider plugin: any executable named `mx-env-provider-<plugin>`
 * found on PATH. It is invoked once per key with the key name as argv[1] and
 * writes the value to stdout (one trailing line ending stripped). Provider
 * login/bootstrap stays inside the plugin, never in repository config.
 */
export interface PluginSource extends SourceBase {
  provider: 'plugin'
  plugin: string
  keys: string[]
}

export type SecretSource = InfisicalSource | LocalSource | DotenvxSource | KeychainSource | DopplerSource | PluginSource

export interface ProfileDefinition {
  sources: string[]
  extends?: string
}

export type ProfileInput = string[] | ProfileDefinition

export interface MxEnvConfig {
  /** Legacy Infisical configuration retained for backwards compatibility. */
  infisical?: {
    projectId?: string
    paths: string[]
    siteUrl?: string
    /** Automatically add a prefix (such as VITE_) to loaded keys. */
    envPrefix?: string
  }
  /** Legacy local override files retained for backwards compatibility. */
  envFiles?: string[]
  /** Client __env.js generation configuration. */
  generate?: {
    out?: string
    filter?: string
  }
  /** Named whole-source collections. Source values never belong in this file. */
  sources?: Record<string, SecretSource>
  /** Named ordered source profiles. */
  profiles?: Record<string, ProfileInput>
  /** Profile selected when a caller does not pass --profile. */
  defaultProfile?: string
  /**
   * Commands that get a PATH shim via `mx-env shell-init` (global and project
   * lists are unioned). Wiring only — never values. Deliberately excluded from
   * validateConfig's hard errors: a convenience layer must not break the core
   * injection path, so `shell-init` validates and hard-fails while composition
   * paths only warn (see shims.ts validateShimList).
   */
  shims?: string[]
}

export interface LoadedConfig {
  config: MxEnvConfig
  path: string
  baseDir: string
  exists: boolean
}

export interface ConfigLayers {
  global: LoadedConfig
  project: LoadedConfig
  globalEnvFile: string
}

export interface LoadConfigOptions {
  cwd?: string
  homeDir?: string
}

export function normalizeProfile(input: ProfileInput): ProfileDefinition {
  if (Array.isArray(input)) return { sources: input }
  return {
    sources: Array.isArray(input?.sources) ? input.sources : [],
    ...(input?.extends ? { extends: input.extends } : {}),
  }
}

/**
 * Returns human-readable validation problems without echoing provider values.
 * Provider credentials deliberately have no place in the declared schema.
 */
export function validateConfig(config: MxEnvConfig, label = CONFIG_FILE): string[] {
  const errors: string[] = []
  const sources = config.sources || {}

  for (const [name, source] of Object.entries(sources)) {
    if (!name.trim()) errors.push(`${label}: source names cannot be empty`)
    if (!source || typeof source !== 'object' || !('provider' in source)) {
      errors.push(`${label}: source "${name}" must declare a provider`)
      continue
    }

    switch (source.provider) {
      case 'infisical':
        if (!Array.isArray(source.paths) || source.paths.length === 0) errors.push(`${label}: Infisical source "${name}" needs paths`)
        if (source.optional) errors.push(`${label}: remote source "${name}" cannot be optional`)
        break
      case 'local':
      case 'dotenvx':
        if (!Array.isArray(source.files) || source.files.length === 0) errors.push(`${label}: ${source.provider} source "${name}" needs files`)
        break
      case 'os-keychain':
        if (!source.service) errors.push(`${label}: os-keychain source "${name}" needs service`)
        if (source.optional) errors.push(`${label}: remote source "${name}" cannot be optional`)
        break
      case 'doppler':
        if (!source.project || !source.config) errors.push(`${label}: Doppler source "${name}" needs project and config`)
        if (source.optional) errors.push(`${label}: remote source "${name}" cannot be optional`)
        break
      case 'plugin':
        if (typeof source.plugin !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(source.plugin)) {
          errors.push(`${label}: plugin source "${name}" needs a plugin name (letters, digits, ".", "_", "-")`)
        }
        if (!Array.isArray(source.keys) || !source.keys.length || source.keys.some((key) => typeof key !== 'string' || !key)) {
          errors.push(`${label}: plugin source "${name}" needs at least one key`)
        }
        break
      default:
        errors.push(`${label}: source "${name}" has an unsupported provider`)
    }
  }

  for (const [name, profileInput] of Object.entries(config.profiles || {})) {
    const profile = normalizeProfile(profileInput)
    if (!profile.sources.length) errors.push(`${label}: profile "${name}" needs sources`)
    for (const sourceName of profile.sources) {
      if (typeof sourceName !== 'string' || !sourceName) errors.push(`${label}: profile "${name}" has an invalid source reference`)
    }
  }

  return errors
}

// ─── 来源结构类型（组合面共享的纯结构） ────────────────────────────

export type SourceAvailability = 'loaded' | 'missing-optional' | 'skipped'

export interface SourceEntry {
  name: string
  source: SecretSource
  baseDir: string
  /** Internal conventional source. Never emitted as a user configuration declaration. */
  globalImplicit?: boolean
  /** Legacy compatibility sources are allowed to skip missing Infisical setup. */
  legacy?: boolean
}

export interface SourceContext {
  homeDir: string
  envName?: string | null
  noInfisical?: boolean
  allowInsecureGlobal?: boolean
  /** Values already composed at a lower precedence. Needed by dotenvx bootstrap only. */
  environment: NodeJS.ProcessEnv
}

export interface LoadedSource {
  name: string
  provider: SecretSource['provider']
  values: Record<string, string>
  availability: SourceAvailability
}

/** Public (client-exposed) key-name rule shared by redaction and source loading. */
export function isPublicKey(key: string): boolean {
  return key.startsWith('NEXT_PUBLIC_') || key.startsWith('VITE_') || key.startsWith('EXPO_PUBLIC_')
}

// ─── 组合/审计类型 ─────────────────────────────────────────────────

export interface ComposeOptions {
  profile?: string | null
  noGlobal?: boolean
  noInfisical?: boolean
  envName?: string | null
  allowInsecureGlobal?: boolean
  envFiles?: string[]
  baseEnvironment?: NodeJS.ProcessEnv
  homeDir?: string
}

export interface KeyProvenance {
  key: string
  source: string
  provider: SecretSource['provider']
  precedence: number
  overriddenSources: string[]
}

export interface SourceStatus {
  name: string
  provider: SecretSource['provider']
  availability: LoadedSource['availability']
  keyCount: number
}

export interface EnvironmentComposition {
  environment: NodeJS.ProcessEnv
  profileName: string
  sourceStatuses: SourceStatus[]
  provenance: Record<string, KeyProvenance>
  /** Value-free source descriptors used by the one-shot editor. */
  sourceEntries: SourceEntry[]
  /** Kept only in memory for output redaction during this invocation. */
  redactionValues: string[]
}

export class CompositionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CompositionError'
  }
}

export interface AuditEvent {
  timestamp: string
  profile: string
  sources: string[]
  keys: string[]
  outcome: 'success' | 'failure'
  exitCode?: number
  durationMs: number
  /**
   * Invocation channel. `shim` means the run came through a PATH shim. This is
   * an observational dimension, not a security assertion: the marker travels
   * as an env var and is forgeable by any same-uid process. `editor` marks
   * actions taken in the one-shot visual editor (values never enter events).
   */
  via?: 'cli' | 'shim' | 'editor'
  /**
   * Editor action kind for `via: 'editor'` events. Value-free by contract:
   * events carry key names only, never values.
   */
  action?: 'set' | 'delete' | 'reveal' | 'close'
}

// ─── `mx-env://` 引用语法（纯解析层） ─────────────────────────────

/**
 * 1Password-style reference (`op://vault/item/field`) for value-free files:
 * `mx-env://<profile>/<KEY>` is written into MCP configs and dotenv templates
 * and resolved at the consumption point (`mx-env inject` / `mx-env run`), so
 * those files can be committed without carrying a value.
 */
const MX_ENV_REFERENCE_SOURCE = 'mx-env:\\/\\/([A-Za-z0-9][A-Za-z0-9_-]*)\\/([A-Za-z0-9_][A-Za-z0-9_.-]*)'

/** Fresh global-flag pattern each call; callers may keep no state across matches. */
export function referencePattern(): RegExp {
  return new RegExp(MX_ENV_REFERENCE_SOURCE, 'g')
}

export interface MxEnvReference {
  profile: string
  key: string
}

export interface UnresolvedReference extends MxEnvReference {
  reason: 'missing' | 'cycle'
}

export interface ReferenceResolution {
  text: string
  missing: UnresolvedReference[]
}

/** Unique `mx-env://profile/KEY` references in declaration order. */
export function findMxEnvReferences(text: string): MxEnvReference[] {
  const found = new Map<string, MxEnvReference>()
  for (const match of text.matchAll(referencePattern())) {
    const reference: MxEnvReference = { profile: match[1], key: match[2] }
    found.set(`${reference.profile}/${reference.key}`, reference)
  }
  return [...found.values()]
}

export function hasMxEnvReference(text: string): boolean {
  return referencePattern().test(text)
}

// ─── redaction 规则 ────────────────────────────────────────────────

/**
 * Values worth redacting from child output: every non-public sourced value
 * still present in the environment. Also used after `mx-env://` reference
 * resolution, which can introduce new values for the same keys.
 */
export function collectRedactionValues(
  environment: NodeJS.ProcessEnv,
  provenance: Record<string, KeyProvenance>,
): string[] {
  return [...new Set(Object.entries(provenance)
    .filter(([key]) => !isPublicKey(key) && Boolean(environment[key]))
    .map(([key]) => environment[key] as string)
    .filter(Boolean))]
}

/**
 * Redacts exact in-memory values while preserving normal stream output. This is
 * deliberately not an exfiltration boundary: a child process can transform a
 * value before printing it. It prevents the common accidental direct echo.
 */
export class StreamingRedactor {
  private readonly values: string[]
  private pending = ''

  constructor(values: string[]) {
    this.values = [...new Set(values.filter(Boolean))].sort((a, b) => b.length - a.length)
  }

  write(chunk: Buffer | string): string {
    if (!this.values.length) return typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    const input = this.pending + (typeof chunk === 'string' ? chunk : chunk.toString('utf8'))
    const keep = this.incompletePrefixLength(input)
    const safe = input.slice(0, input.length - keep)
    this.pending = input.slice(input.length - keep)
    return this.redact(safe)
  }

  flush(): string {
    const output = this.redact(this.pending)
    this.pending = ''
    return output
  }

  private incompletePrefixLength(input: string): number {
    const completeEnd = this.lastCompleteMatchEnd(input)
    const limit = Math.min(input.length, Math.max(...this.values.map((value) => value.length - 1), 0))
    for (let length = limit; length > 0; length--) {
      const suffix = input.slice(-length)
      const start = input.length - length
      if (start >= completeEnd && this.values.some((value) => value.startsWith(suffix))) return length
    }
    return 0
  }

  private redact(input: string): string {
    const marks = new Array(input.length).fill(false)
    for (const value of this.values) {
      let from = 0
      while (from < input.length) {
        const index = input.indexOf(value, from)
        if (index < 0) break
        for (let i = index; i < index + value.length; i++) marks[i] = true
        from = index + 1 // retain overlapping matches
      }
    }

    let output = ''
    let inRedaction = false
    for (let i = 0; i < input.length; i++) {
      if (marks[i]) {
        if (!inRedaction) output += '[REDACTED]'
        inRedaction = true
      } else {
        output += input[i]
        inRedaction = false
      }
    }
    return output
  }

  private lastCompleteMatchEnd(input: string): number {
    let lastEnd = 0
    for (const value of this.values) {
      let from = 0
      while (from < input.length) {
        const index = input.indexOf(value, from)
        if (index < 0) break
        lastEnd = Math.max(lastEnd, index + value.length)
        from = index + 1
      }
    }
    return lastEnd
  }
}
