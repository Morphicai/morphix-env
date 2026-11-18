// L0 契约层（纯，无 IO）—— config schema、`mxenv://` 引用语法、组合/审计类型、
// redaction 规则的唯一定义地。L1 能力模块（config/refs/composition/audit/
// sources/redaction）从此处 import 并 re-export 原符号，既有导入面不倒退；
// 主入口 index.ts 同样 re-export。此入口的零 IO 副作用与导出面（不含值能力
// compose/revealSingle）由 test/contracts.test.ts 经 noio 探针守护。

// ─── config schema：常量与纯类型/结构定义 ─────────────────────────

export const CONFIG_FILE = 'mxenv.config.json'
export const GLOBAL_CONFIG_DIR = '.mxenv'
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

/** os-keychain 依赖的原生钥匙串平台面（process.platform 的抽象）。 */
export type KeychainPlatform = 'macos' | 'linux' | 'windows'

/**
 * Linux 凭据存储后端：secret-service（gnome-keyring/KWallet/keepassxc，持
 * 久化，默认）或 keyutils（内核态、重启即失，必须显式声明）。macOS/Win
 * 忽略此选项。
 */
export type LinuxKeyringStore = 'secret-service' | 'keyutils'

export interface KeychainSource extends SourceBase {
  provider: 'os-keychain'
  service: string
  /**
   * 要读取的账号（钥匙串里的 entry 名）。跨平台原生桥没有服务级发现
   * （keytar 的 findCredentials 无等价物），显式声明键集才是可移植读模
   * 型；未声明或键缺失的条目按缺省处理（不报错、组合结果不含它）。
   */
  keys?: string[]
  /** 声明此源只存在于哪个平台；与当前机器不符时 fail-closed（防把 mac 的
   * 源静默空读进 Linux 组合）。 */
  platform?: KeychainPlatform
  linuxStore?: LinuxKeyringStore
}

export interface DopplerSource extends SourceBase {
  provider: 'doppler'
  project: string
  config: string
}

/**
 * External provider plugin: any executable named `mxenv-provider-<plugin>`
 * found on PATH (legacy `mx-env-provider-<plugin>` is no longer resolved).
 * It is invoked
 * once per key with the key name as argv[1] and writes the value to stdout
 * (one trailing line ending stripped). Provider login/bootstrap stays inside
 * the plugin, never in repository config.
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
    /** Pin the Infisical environment so runs don't need --env/-e. */
    env?: string
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
   * Commands that get a PATH shim via `mxenv-cli shell-init` (global and project
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
 * Synthesized source name for a legacy flat `infisical` block. Composition
 * displays this name and `doctor`/`inspect` report against it, so the two
 * must never drift apart.
 */
export const LEGACY_INFISICAL_SOURCE = '__mx_legacy_infisical'

/** Where a run's Infisical environment resolution came from. */
export type InfisicalEnvResolution = 'pinned' | 'cli-env' | 'deploy-env' | 'infisical-env' | null

export interface InfisicalEnvPin {
  /** Source name as composition displays it. */
  name: string
  /** True when the source itself declares `env` — the durable pin. */
  pinned: boolean
  /** Resolved environment name, or null when nothing resolves (run fails closed). */
  env: string | null
  /** Where the resolution came from; null when fail-closed. */
  resolvedVia: InfisicalEnvResolution
}

/**
 * Static env-pin analysis for every Infisical source a config declares
 * (legacy flat `infisical` block and named `sources` entries). Mirrors the
 * resolver precedence in sources.ts (`source.env || --env || DEPLOY_ENV ||
 * INFISICAL_ENV`) — keep the two in sync when changing either. Pure: names
 * and environment labels only, never values.
 */
export function infisicalEnvPins(
  config: MxEnvConfig,
  options: { envName?: string | null; processEnv?: NodeJS.ProcessEnv } = {},
): InfisicalEnvPin[] {
  const processEnv = options.processEnv ?? process.env
  const candidates: { name: string; env?: string }[] = []
  if (config.infisical) candidates.push({ name: LEGACY_INFISICAL_SOURCE, env: config.infisical.env })
  for (const [name, source] of Object.entries(config.sources || {})) {
    if (source.provider === 'infisical') candidates.push({ name, env: source.env })
  }
  return candidates.map(({ name, env }) => {
    if (env) return { name, pinned: true, env, resolvedVia: 'pinned' }
    const cliEnv = options.envName || null
    if (cliEnv) return { name, pinned: false, env: cliEnv, resolvedVia: 'cli-env' }
    const deployEnv = processEnv.DEPLOY_ENV || null
    if (deployEnv) return { name, pinned: false, env: deployEnv, resolvedVia: 'deploy-env' }
    const infisicalEnv = processEnv.INFISICAL_ENV || null
    if (infisicalEnv) return { name, pinned: false, env: infisicalEnv, resolvedVia: 'infisical-env' }
    return { name, pinned: false, env: null, resolvedVia: null }
  })
}

/**
 * Prefix reserving source names for mxenv's auto-generated sources. Declaring
 * a source with this prefix is a config error — it would collide with
 * implicit sources (`__mx_global_dotenv` et al) in provenance and statuses.
 */
export const INTERNAL_SOURCE_PREFIX = '__mx'

const INTERNAL_SOURCE_LABELS: Record<string, string> = {
  __mx_global_dotenv: 'global baseline',
  __mx_default_local: 'local files',
  __mx_default_dotenvx: 'dotenvx files',
  __mx_legacy_infisical: 'Infisical (legacy)',
  __mx_cli_local_override: 'env-file override',
}

/**
 * Human-facing label for a source name. Internal `__mx*` identifiers never
 * print raw: they are stable machine keys, not prose. User-declared names
 * pass through unchanged.
 */
export function sourceLabel(name: string): string {
  return INTERNAL_SOURCE_LABELS[name] ?? name
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
    if (name.startsWith(INTERNAL_SOURCE_PREFIX)) {
      errors.push(`${label}: source names starting with "${INTERNAL_SOURCE_PREFIX}" are reserved for mxenv's implicit sources`)
    }
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
  /** Value-free human-readable reason when availability is not 'loaded'. */
  detail?: string
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
  /** Value-free skip reason; present when availability is 'skipped'. */
  detail?: string
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
   * `host` marks panel-host session actions (reveal/unlock/lock/session life).
   */
  via?: 'cli' | 'shim' | 'editor' | 'host'
  /**
   * Action kind. Value-free by contract: events carry key names only, never
   * values. `unlock`/`lock` are panel-host session state transitions.
   */
  action?: 'set' | 'delete' | 'reveal' | 'close' | 'unlock' | 'lock' | 'start'
  /** Value-free reveal outcome detail (`locked` / `not-found` / `read-error`). */
  reason?: string
  /**
   * Project config path this event is attributed to (value-free). `'-'` when
   * no config file actually exists (never a phantom candidate path). Used by
   * the project registry aggregation (ux-architecture 2.4); older events omit
   * the field and readers tolerate its absence.
   */
  configPath?: string
}

// ─── panel-host API 资源模型（L0 契约；消费方=面板 UI 与未来 SDK） ─────

/** names-only key row for `GET /keys` (values never appear). */
export interface PanelKeyInfo {
  key: string
  source: string
  /** File scope within a multi-file source (set/del/reveal symmetry). */
  fileIndex?: number
  /** Whether the key currently has a stored value (`present`/`missing`). */
  status: 'present' | 'missing'
}

/** Reveal request for `POST /reveal` (scoped like the editor: key + owning source). */
export interface PanelRevealRequest {
  key: string
  source: string
  fileIndex?: number
}

// ─── `mxenv://` 引用语法（纯解析层） ──────────────────────────────

/**
 * 1Password-style reference (`op://vault/item/field`) for value-free files:
 * `mxenv://<profile>/<KEY>` is written into MCP configs and dotenv templates
 * and resolved at the consumption point (`mxenv inject` / `mxenv run`), so
 * those files can be committed without carrying a value.
 */
const MXENV_REFERENCE_SOURCE = 'mxenv:\\/\\/([A-Za-z0-9][A-Za-z0-9_-]*)\\/([A-Za-z0-9_][A-Za-z0-9_.-]*)'

/**
 * 0.11 时代的 scheme。零存量消费者（已核 `~/.trellis` 与全仓无真实引用），
 * 故不设垫片：解析面命中即拒绝并提示改用 `mxenv://`（naming-migration「引用
 * 语法直切」）。
 */
const LEGACY_REFERENCE_PATTERN = /mx-env:\/\//

function rejectLegacyReference(text: string): void {
  if (LEGACY_REFERENCE_PATTERN.test(text)) {
    throw new Error(
      '[mxenv] 旧引用语法 `mx-env://` 已拒绝：请改用 `mxenv://<profile>/<KEY>`（0.12.0 起 scheme 唯一生效）',
    )
  }
}

/** Fresh global-flag pattern each call; callers may keep no state across matches. */
export function referencePattern(): RegExp {
  return new RegExp(MXENV_REFERENCE_SOURCE, 'g')
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

/** Unique `mxenv://profile/KEY` references in declaration order. */
export function findMxEnvReferences(text: string): MxEnvReference[] {
  rejectLegacyReference(text)
  const found = new Map<string, MxEnvReference>()
  for (const match of text.matchAll(referencePattern())) {
    const reference: MxEnvReference = { profile: match[1], key: match[2] }
    found.set(`${reference.profile}/${reference.key}`, reference)
  }
  return [...found.values()]
}

export function hasMxEnvReference(text: string): boolean {
  rejectLegacyReference(text)
  return referencePattern().test(text)
}

// ─── redaction 规则 ────────────────────────────────────────────────

/**
 * Minimum length for a composed value to participate in substring redaction.
 * 1–2 character values carry at most ~13 bits of entropy — they cannot be
 * usable credentials — while substring-redacting them deterministically
 * corrupts ordinary output (a value of "1" marks every "1" in the stream;
 * issue #31). Length is the only "shape" signal used here on purpose:
 * source provenance already defines secrecy, and token-look heuristics miss
 * weak-but-real secrets while false-positiving on ordinary strings.
 */
export const MIN_REDACTABLE_VALUE_LENGTH = 3

/**
 * Composed values at or below this length trigger a compose-time collision
 * warning: ≤2 chars are exempt from redaction entirely, 3–4 chars still
 * redact but collide with ordinary output easily. Both shapes are
 * config-like, not credentials — the durable fix lives in secret-source
 * admission, not in the redactor.
 */
export const SHORT_VALUE_WARN_LENGTH = 4

/** Whether a composed value participates in output redaction (length floor). */
export function isRedactableValue(value: string | undefined): value is string {
  return typeof value === 'string' && value.length >= MIN_REDACTABLE_VALUE_LENGTH
}

/**
 * Values worth redacting from child output: every non-public sourced value
 * still present in the environment, above the redaction length floor. Also
 * used after `mxenv://` reference resolution, which can introduce new values
 * for the same keys.
 */
export function collectRedactionValues(
  environment: NodeJS.ProcessEnv,
  provenance: Record<string, KeyProvenance>,
): string[] {
  return [...new Set(Object.entries(provenance)
    .filter(([key]) => !isPublicKey(key) && Boolean(environment[key]))
    .map(([key]) => environment[key] as string)
    .filter(isRedactableValue))]
}

/**
 * Key names whose composed non-public values are ≤SHORT_VALUE_WARN_LENGTH
 * chars: exempt from redaction (≤2) or redacting with extreme collision
 * risk (3–4). Names only — never values; feeds the compose-time warning
 * that pushes config-like values out of secret sources.
 */
export function highCollisionValueKeys(
  environment: NodeJS.ProcessEnv,
  provenance: Record<string, KeyProvenance>,
): string[] {
  return Object.entries(provenance)
    .filter(([key]) => !isPublicKey(key))
    .map(([key]) => [key, environment[key]] as const)
    .filter(([, value]) => typeof value === 'string' && value.length > 0 && value.length <= SHORT_VALUE_WARN_LENGTH)
    .map(([key]) => key)
    .sort((a, b) => a.localeCompare(b))
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
    // Length floor (issue #31): 1–2 char values are exempt — no meaningful
    // entropy, deterministic output corruption. This constructor is the
    // authoritative filter; collectRedactionValues applies the same rule so
    // the public composition field matches redactor behavior.
    this.values = [...new Set(values.filter(isRedactableValue))].sort((a, b) => b.length - a.length)
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
