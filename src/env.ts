import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

/** 解析 .env 文件，返回 key-value 对象 */
export function parseEnvFile(filePath: string): Record<string, string> {
  const absPath = resolve(filePath)
  if (!existsSync(absPath)) return {}

  const vars: Record<string, string> = {}
  const content = readFileSync(absPath, 'utf8')

  for (const raw of content.split('\n')) {
    const line = raw.trim()
    // 跳过空行和注释
    if (!line || line.startsWith('#')) continue

    const eq = line.indexOf('=')
    if (eq === -1) continue

    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()

    // 去除包裹的引号
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    vars[key] = value
  }

  return vars
}

/**
 * 加载 env 文件列表，后面的覆盖前面的，最终注入 process.env。
 * 返回被覆盖的变量列表（用于日志）。
 */
export function loadEnvFiles(files: string[]): { key: string; source: string }[] {
  const overrides: { key: string; source: string }[] = []

  for (const file of files) {
    const vars = parseEnvFile(file)
    for (const [key, value] of Object.entries(vars)) {
      process.env[key] = value
      overrides.push({ key, source: file })
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
