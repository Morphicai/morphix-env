import { homedir } from 'os'
import {
  type ConfigLayers,
  type InfisicalSource,
  type LoadedConfig,
  normalizeProfile,
  type ProfileInput,
  type SecretSource,
  validateConfig,
} from './config'
import { isPublicKey, loadSource, type LoadedSource, type SourceEntry } from './sources'

const DEFAULT_ENV_FILE = '.env.local'
const GLOBAL_DOTENV_SOURCE = '__mx_global_dotenv'
const LEGACY_INFISICAL_SOURCE = '__mx_legacy_infisical'
const LEGACY_LOCAL_SOURCE = '__mx_legacy_local'

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

function declaredEntries(loaded: LoadedConfig): Map<string, SourceEntry> {
  return new Map(Object.entries(loaded.config.sources || {}).map(([name, source]) => [name, {
    name,
    source,
    baseDir: loaded.baseDir,
  }]))
}

function profileEntries(
  profileName: string,
  profiles: Map<string, ProfileInput>,
  sources: Map<string, SourceEntry>,
  visiting = new Set<string>(),
): SourceEntry[] {
  if (visiting.has(profileName)) {
    throw new CompositionError(`[morphix-env] Profile "${profileName}" has a circular extends chain.`)
  }
  const input = profiles.get(profileName)
  if (!input) throw new CompositionError(`[morphix-env] Unknown profile "${profileName}".`)

  visiting.add(profileName)
  const profile = normalizeProfile(input)
  const resolved = profile.extends ? profileEntries(profile.extends, profiles, sources, visiting) : []
  for (const sourceName of profile.sources) {
    const source = sources.get(sourceName)
    if (!source) throw new CompositionError(`[morphix-env] Profile "${profileName}" references unknown source "${sourceName}".`)
    resolved.push(source)
  }
  visiting.delete(profileName)
  return resolved
}

function legacyEntries(project: LoadedConfig, envFilesOverride?: string[]): SourceEntry[] {
  const infisical = project.config.infisical
  const entries: SourceEntry[] = []
  if (infisical) {
    const infisicalSource: InfisicalSource = {
      provider: 'infisical',
      paths: infisical.paths,
      // The legacy project source sits above global baseline sources.
      override: true,
      ...(infisical.projectId ? { projectId: infisical.projectId } : {}),
      ...(infisical.siteUrl ? { siteUrl: infisical.siteUrl } : {}),
      ...(infisical.envPrefix ? { envPrefix: infisical.envPrefix } : {}),
    }
    entries.push({
      name: LEGACY_INFISICAL_SOURCE,
      source: infisicalSource,
      baseDir: project.baseDir,
      legacy: true,
    })
  }
  entries.push({
      name: LEGACY_LOCAL_SOURCE,
      source: {
        provider: 'local',
        files: envFilesOverride?.length ? envFilesOverride : (project.config.envFiles || [DEFAULT_ENV_FILE]),
        optional: true,
        override: true,
      },
      baseDir: project.baseDir,
      legacy: true,
    })
  return entries
}

function configProblems(layers: ConfigLayers, includeGlobal: boolean): string[] {
  return [
    ...(includeGlobal ? validateConfig(layers.global.config, layers.global.path) : []),
    ...validateConfig(layers.project.config, layers.project.path),
  ]
}

function resolveEntries(layers: ConfigLayers, options: ComposeOptions): { name: string; entries: SourceEntry[] } {
  const includeGlobal = !options.noGlobal
  const errors = configProblems(layers, includeGlobal)
  if (errors.length) throw new CompositionError(`[morphix-env] Invalid configuration: ${errors.join('; ')}`)

  const globalSources = includeGlobal ? declaredEntries(layers.global) : new Map<string, SourceEntry>()
  const projectSources = declaredEntries(layers.project)
  const sources = new Map([...globalSources, ...projectSources])
  const profiles = new Map<string, ProfileInput>([
    ...(includeGlobal ? Object.entries(layers.global.config.profiles || {}) : []),
    ...Object.entries(layers.project.config.profiles || {}),
  ])

  const globalDotenv: SourceEntry[] = includeGlobal ? [{
    name: GLOBAL_DOTENV_SOURCE,
    source: { provider: 'local', files: [layers.globalEnvFile], optional: true },
    baseDir: layers.global.baseDir,
    globalImplicit: true,
  }] : []
  const explicitProfile = options.profile || null
  const projectDefault = layers.project.config.defaultProfile
  const globalDefault = includeGlobal ? layers.global.config.defaultProfile : undefined
  const legacy = legacyEntries(layers.project, options.envFiles)
  const cliLocalOverride: SourceEntry[] = options.envFiles?.length ? [{
    name: '__mx_cli_local_override',
    source: { provider: 'local', files: options.envFiles, optional: true, override: true },
    baseDir: layers.project.baseDir,
  }] : []

  if (explicitProfile) {
    return { name: explicitProfile, entries: [...globalDotenv, ...profileEntries(explicitProfile, profiles, sources), ...cliLocalOverride] }
  }
  if (projectDefault) {
    return { name: projectDefault, entries: [...globalDotenv, ...profileEntries(projectDefault, profiles, sources), ...cliLocalOverride] }
  }
  if (globalDefault) {
    const baseline = profileEntries(globalDefault, profiles, sources)
    return {
      name: `${globalDefault}+legacy`,
      entries: [...globalDotenv, ...baseline, ...legacy],
    }
  }

  return { name: 'legacy', entries: [...globalDotenv, ...legacy] }
}

/**
 * Resolves sources in precedence order without mutating global process.env.
 * A caller receives an environment object suitable for exactly one child run.
 */
export async function composeEnvironment(layers: ConfigLayers, options: ComposeOptions = {}): Promise<EnvironmentComposition> {
  const { name: profileName, entries } = resolveEntries(layers, options)
  const environment: NodeJS.ProcessEnv = { ...(options.baseEnvironment || process.env) }
  const owner = new Map<string, KeyProvenance>()
  const sourceStatuses: SourceStatus[] = []
  const homeDir = options.homeDir || homedir()

  for (let precedence = 0; precedence < entries.length; precedence++) {
    const entry = entries[precedence]
    const loaded = await loadSource(entry, {
      homeDir,
      envName: options.envName,
      noInfisical: options.noInfisical,
      allowInsecureGlobal: options.allowInsecureGlobal,
      environment,
    })
    sourceStatuses.push({
      name: loaded.name,
      provider: loaded.provider,
      availability: loaded.availability,
      keyCount: Object.keys(loaded.values).length,
    })

    for (const [key, value] of Object.entries(loaded.values)) {
      const previous = owner.get(key)
      if (previous && !entry.source.override) {
        throw new CompositionError(
          `[morphix-env] Key "${key}" is provided by both "${previous.source}" and "${entry.name}". Declare override: true on the later source to allow this.`,
        )
      }

      environment[key] = value
      owner.set(key, {
        key,
        source: entry.name,
        provider: entry.source.provider,
        precedence,
        overriddenSources: previous ? [...previous.overriddenSources, previous.source] : [],
      })
    }
  }

  return {
    environment,
    profileName,
    sourceStatuses,
    provenance: Object.fromEntries(owner),
    sourceEntries: entries,
    redactionValues: [...new Set([...owner.entries()]
      .filter(([key]) => !isPublicKey(key) && Boolean(environment[key]))
      .map(([key]) => environment[key] as string)
      .filter(Boolean))],
  }
}
