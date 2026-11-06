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
 * dotenvx 加密文件的内容嗅探：加密产物头部携带 DOTENV_PUBLIC_KEY 且至少一行
 * 为 `KEY=encrypted:` 形态的密文值（行锚定，注释里出现 "encrypted:" 不算；
 * 键名含点号也算——dotenv 允许 `A.B=` 形态）。两个标记同时要求，避免明文文件
 * 合法定义同名 key 时被误判走 dotenvx 加载。只认标记、不解析值；读失败一律
 * 按未加密处理。
 */
export function isDotenvxEncrypted(filePath: string): boolean {
  try {
    const content = readFileSync(resolve(filePath), 'utf8')
    return content.includes('DOTENV_PUBLIC_KEY') && /^[A-Za-z_][A-Za-z0-9_.]*="?encrypted:/m.test(content)
  } catch {
    return false
  }
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
