import { existsSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { homedir } from 'os'
import {
  CONFIG_FILE,
  GLOBAL_CONFIG_FILE,
  GLOBAL_ENV_FILE,
  type ConfigLayers,
  type LoadConfigOptions,
  type LoadedConfig,
  type MxEnvConfig,
} from './contracts'
import { GLOBAL_CONFIG_DIR } from './contracts'

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
    console.warn(`[mxenv] Failed to parse configuration at ${path}: ${e?.name || 'invalid JSON'}`)
    return {}
  }
}

/**
 * 0.12.x 垫片：项目配置读取 `mxenv.config.json` 优先、缺失时回退旧名
 * `mx-env.config.json`（naming-migration「旧名垫片与弃用窗口」）。双文件并存
 * 时只认新名并提示清理旧文件；写侧落新名的收口在 migrate（写前备份+改名）。
 */
const LEGACY_CONFIG_FILE = 'mx-env.config.json'

function loadProjectConfig(cwd: string): LoadedConfig {
  const primary = loadConfigAt(resolve(cwd, CONFIG_FILE))
  const legacyPath = resolve(cwd, LEGACY_CONFIG_FILE)
  if (primary.exists) {
    if (existsSync(legacyPath)) {
      console.warn(`[mxenv] 同时存在 ${CONFIG_FILE} 与旧名 ${LEGACY_CONFIG_FILE}：已读取新名，旧文件请删除`)
    }
    return primary
  }
  return loadConfigAt(legacyPath)
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

/** Reads the current project's mxenv.config.json (legacy name falls back). */
export function loadConfig(cwd = process.cwd()): MxEnvConfig {
  return loadProjectConfig(cwd).config
}

/**
 * Loads the two intentional configuration discovery points. Values are never
 * read here; ~/.mxenv/.env is represented as a source by composition later.
 */
export function loadConfigLayers(options: LoadConfigOptions = {}): ConfigLayers {
  const cwd = options.cwd || process.cwd()
  const homeDir = options.homeDir || homedir()
  const globalDir = join(homeDir, GLOBAL_CONFIG_DIR)

  return {
    global: loadConfigAt(resolve(globalDir, GLOBAL_CONFIG_FILE)),
    project: loadProjectConfig(cwd),
    globalEnvFile: resolve(globalDir, GLOBAL_ENV_FILE),
  }
}

/** Expand only a leading ~/; no shell expansion is performed. */
export function expandHomePath(path: string, homeDir = homedir()): string {
  if (path === '~') return homeDir
  if (path.startsWith('~/')) return resolve(homeDir, path.slice(2))
  return path
}
