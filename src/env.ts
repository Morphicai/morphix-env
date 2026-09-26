import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { parse as dotenvParse } from 'dotenv'

/** 解析 .env 文件，返回 key-value 对象 */
export function parseEnvFile(filePath: string): Record<string, string> {
  const absPath = resolve(filePath)
  if (!existsSync(absPath)) return {}
  return dotenvParse(readFileSync(absPath, 'utf8'))
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

    // Legacy helper: new composition code reads files without mutation.
    const parsed = dotenvParse(readFileSync(absPath, 'utf8'))
    if (parsed) {
      Object.assign(process.env, parsed)
      for (const key of Object.keys(parsed)) {
        overrides.push({ key, source: file })
      }
    }
  }

  return overrides
}

/** 客户端公开变量的前缀 */
const PUBLIC_PREFIXES = ['NEXT_PUBLIC_', 'VITE_', 'EXPO_PUBLIC_']

/** 从 process.env 中提取客户端公开变量 */
export function extractPublicVars(environment: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [key, value] of Object.entries(environment)) {
    if (value && PUBLIC_PREFIXES.some(p => key.startsWith(p))) {
      vars[key] = value
    }
  }
  return vars
}
