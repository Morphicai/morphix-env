import { existsSync } from 'fs'
import { resolve } from 'path'
import { config as dotenvConfig, parse as dotenvParse } from 'dotenv'

/** 解析 .env 文件，返回 key-value 对象 */
export function parseEnvFile(filePath: string): Record<string, string> {
  const absPath = resolve(filePath)
  if (!existsSync(absPath)) return {}

  const result = dotenvConfig({ path: absPath, override: false })
  return result.parsed || {}
}

/**
 * 加载 env 文件列表，后面的覆盖前面的，最终注入 process.env。
 * 返回被覆盖的变量列表（用于日志）。
 */
export function loadEnvFiles(files: string[]): { key: string; source: string }[] {
  const overrides: { key: string; source: string }[] = []

  for (const file of files) {
    const absPath = resolve(file)
    if (!existsSync(absPath)) continue

    // override: true 确保后文件覆盖前文件及已有 env
    const result = dotenvConfig({ path: absPath, override: true })
    if (result.parsed) {
      for (const key of Object.keys(result.parsed)) {
        overrides.push({ key, source: file })
      }
    }
  }

  return overrides
}

/** 客户端公开变量的前缀 */
const PUBLIC_PREFIXES = ['NEXT_PUBLIC_', 'VITE_', 'EXPO_PUBLIC_']

/** 从 process.env 中提取客户端公开变量 */
export function extractPublicVars(): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value && PUBLIC_PREFIXES.some(p => key.startsWith(p))) {
      vars[key] = value
    }
  }
  return vars
}
