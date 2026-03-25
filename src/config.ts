import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

const CONFIG_FILE = 'mx-env.config.json'

export interface MxEnvConfig {
  /** Infisical 配置 */
  infisical?: {
    projectId?: string
    paths: string[]
    siteUrl?: string
    /** 自动为 Infisical 拉取的变量添加前缀（如 "VITE_"），已有该前缀的变量不会重复添加 */
    envPrefix?: string
  }
  /** 要加载的 env 文件列表，默认 [".env.local"] */
  envFiles?: string[]
  /** 客户端 __env.js 生成配置 */
  generate?: {
    out: string
    filter?: string
  }
}

/** 读取项目根目录的 mx-env.config.json */
export function loadConfig(): MxEnvConfig {
  const configPath = resolve(CONFIG_FILE)
  if (!existsSync(configPath)) return {}

  try {
    return JSON.parse(readFileSync(configPath, 'utf8')) as MxEnvConfig
  } catch (e: any) {
    console.warn(`[morphix-env] Failed to parse ${CONFIG_FILE}: ${e.message}`)
    return {}
  }
}
