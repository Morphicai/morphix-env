import { existsSync, readFileSync } from 'fs'
import { dirname, resolve } from 'path'
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
import { resolveGlobalDir } from './global-home'

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
 * 垫片移除（naming-migration「垫片移除与到期公告」）：0.13.x 起项目配置只读
 * `mxenv.config.json`；旧名 `mx-env.config.json` 不再参与解析。检测到旧文件
 * 时给改名指引（非静默空配置、不自动改写用户文件——design 决策 1）。
 */
const LEGACY_CONFIG_FILE = 'mx-env.config.json'

function loadProjectConfig(cwd: string): LoadedConfig {
  const primary = loadConfigAt(resolve(cwd, CONFIG_FILE))
  const legacyExists = existsSync(resolve(cwd, LEGACY_CONFIG_FILE))
  if (primary.exists) {
    if (legacyExists) {
      console.warn(`[mxenv] 同时存在 ${CONFIG_FILE} 与旧名 ${LEGACY_CONFIG_FILE}：旧文件已不再读取，请删除`)
    }
    return primary
  }
  if (legacyExists) {
    console.warn(`[mxenv] 发现旧名配置 ${LEGACY_CONFIG_FILE}：0.13.x 起不再读取，请手工改名为 ${CONFIG_FILE}（\`migrate --home\` 只管 ~/.mx-env/ 全局目录迁移）`)
  }
  return primary
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

/** Reads the current project's mxenv.config.json (legacy name is no longer read). */
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
  const globalDir = resolveGlobalDir(homeDir)

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
