import { existsSync, readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { homedir } from 'os'
import {
  CONFIG_FILE,
  GLOBAL_CONFIG_DIR,
  GLOBAL_CONFIG_FILE,
  GLOBAL_ENV_FILE,
  type ConfigLayers,
  type LoadConfigOptions,
  type LoadedConfig,
  type MxEnvConfig,
} from './contracts'

// 纯 schema（常量/类型/纯校验）已抽至 ./contracts（L0）；此处 re-export 保持
// 既有模块导入面不倒退。此模块只保留读文件的配置发现能力（L1）。
export {
  CONFIG_FILE,
  GLOBAL_CONFIG_DIR,
  GLOBAL_CONFIG_FILE,
  GLOBAL_ENV_FILE,
  normalizeProfile,
  validateConfig,
} from './contracts'
export type {
  ConfigLayers,
  DotenvxSource,
  InfisicalSource,
  KeychainSource,
  LoadConfigOptions,
  LoadedConfig,
  LocalSource,
  MxEnvConfig,
  PluginSource,
  ProfileDefinition,
  ProfileInput,
  SecretProvider,
  SecretSource,
  DopplerSource,
} from './contracts'

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

/** Expand only a leading ~/; no shell expansion is performed. */
export function expandHomePath(path: string, homeDir = homedir()): string {
  if (path === '~') return homeDir
  if (path.startsWith('~/')) return resolve(homeDir, path.slice(2))
  return path
}
