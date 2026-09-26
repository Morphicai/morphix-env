import { existsSync, readFileSync } from 'fs'
import { dirname, homedir, resolve } from 'path'

export const CONFIG_FILE = 'mx-env.config.json'
export const GLOBAL_CONFIG_DIR = '.mx-env'
export const GLOBAL_CONFIG_FILE = 'config.json'
export const GLOBAL_ENV_FILE = '.env'

export type SecretProvider = 'infisical' | 'local' | 'dotenvx' | 'os-keychain' | 'doppler'

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

export type SecretSource = InfisicalSource | LocalSource | DotenvxSource | KeychainSource | DopplerSource

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

function safeParseConfig(path: string): MxEnvConfig {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as MxEnvConfig
      : {}
  } catch (e: any) {
    // JSON parser messages never need to echo the input content.
    console.warn(`[morphix-env] Failed to parse configuration at ${path}: ${e?.name || 'invalid JSON'}`)
    return {}
  }
}

/** Reads one config file. It intentionally does not resolve or load source values. */
export function loadConfigAt(path: string): LoadedConfig {
  const absolutePath = resolve(path)
  if (!existsSync(absolutePath)) {
    return { config: {}, path: absolutePath, baseDir: dirname(absolutePath), exists: false }
  }

  return {
    config: safeParseConfig(absolutePath),
    path: absolutePath,
    baseDir: dirname(absolutePath),
    exists: true,
  }
}

/** Reads the current project's mx-env.config.json (legacy public API). */
export function loadConfig(cwd = process.cwd()): MxEnvConfig {
  return loadConfigAt(resolve(cwd, CONFIG_FILE)).config
}

/**
 * Loads the two intentional configuration discovery points. Values are never
 * read here; ~/.mx-env/.env is represented as a source by composition later.
 */
export function loadConfigLayers(options: LoadConfigOptions = {}): ConfigLayers {
  const cwd = options.cwd || process.cwd()
  const homeDir = options.homeDir || homedir()
  const globalDir = resolve(homeDir, GLOBAL_CONFIG_DIR)

  return {
    global: loadConfigAt(resolve(globalDir, GLOBAL_CONFIG_FILE)),
    project: loadConfigAt(resolve(cwd, CONFIG_FILE)),
    globalEnvFile: resolve(globalDir, GLOBAL_ENV_FILE),
  }
}

export function normalizeProfile(input: ProfileInput): ProfileDefinition {
  if (Array.isArray(input)) return { sources: input }
  return {
    sources: Array.isArray(input?.sources) ? input.sources : [],
    ...(input?.extends ? { extends: input.extends } : {}),
  }
}

/** Expand only a leading ~/; no shell expansion is performed. */
export function expandHomePath(path: string, homeDir = homedir()): string {
  if (path === '~') return homeDir
  if (path.startsWith('~/')) return resolve(homeDir, path.slice(2))
  return path
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
