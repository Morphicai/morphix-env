import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

const CONFIG_FILE = 'mx-env.config.json'

export interface MxEnvConfig {
  /** Infisical 配置 */
  infisical?: {
    projectId: string
    paths: string[]
    /** 支持 $ENV_VAR 引用，如 "$DEPLOY_ENV"，默认 "dev" */
    env?: string
    siteUrl?: string
  }
  /** 要加载的 env 文件列表，默认 [".env.local"] */
  envFiles?: string[]
  /** 客户端 __env.js 生成配置 */
  generate?: {
    out: string
    filter?: string
  }
}

/** 解析配置值中的 $ENV_VAR 引用 */
function resolveEnvRef(value: string): string {
  if (value.startsWith('$')) {
    return process.env[value.slice(1)] || ''
  }
  return value
}

/** 读取项目根目录的 mx-env.config.json */
export function loadConfig(): MxEnvConfig {
  const configPath = resolve(CONFIG_FILE)
  if (!existsSync(configPath)) return {}

  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as MxEnvConfig

    // 解析 env 字段中的环境变量引用
    if (raw.infisical?.env) {
      raw.infisical.env = resolveEnvRef(raw.infisical.env)
    }

    return raw
  } catch (e: any) {
    console.warn(`[mx-env] Failed to parse ${CONFIG_FILE}: ${e.message}`)
    return {}
  }
}
