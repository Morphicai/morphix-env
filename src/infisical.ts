import { InfisicalSDK } from '@infisical/sdk'
import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { parse as dotenvParse } from 'dotenv'

export interface InfisicalConfig {
  clientId: string
  clientSecret: string
  projectId: string
  environment: string
  paths: string[]
  siteUrl?: string
}

/**
 * 从环境变量中读取 Infisical Machine Identity 配置。
 * 如果缺少必要字段则返回 null。
 */
export function getInfisicalConfig(): InfisicalConfig | null {
  const clientId = process.env.INFISICAL_CLIENT_ID
  const clientSecret = process.env.INFISICAL_CLIENT_SECRET
  // projectId: 环境变量 > .infisical.json workspaceId
  const projectId = process.env.INFISICAL_PROJECT_ID || readInfisicalJson().workspaceId

  if (!clientId || !clientSecret || !projectId) return null

  return {
    clientId,
    clientSecret,
    projectId,
    environment: process.env.DEPLOY_ENV || process.env.INFISICAL_ENV || 'dev',
    paths: (process.env.INFISICAL_PATHS || '/').split(',').map(p => p.trim()),
    siteUrl: process.env.INFISICAL_SITE_URL,
  }
}

/** 给 key 添加前缀，已有前缀的不重复添加 */
function applyPrefix(key: string, prefix?: string): string {
  if (!prefix) return key
  return key.startsWith(prefix) ? key : prefix + key
}

/**
 * 通过 SDK（Machine Identity）拉取 secrets 并注入 process.env。
 */
export async function fetchInfisicalSecrets(config: InfisicalConfig, envPrefix?: string): Promise<number> {
  const client = new InfisicalSDK({
    ...(config.siteUrl ? { siteUrl: config.siteUrl } : {}),
  })

  await client.auth().universalAuth.login({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  })

  let count = 0

  for (const secretPath of config.paths) {
    const result = await client.secrets().listSecrets({
      environment: config.environment,
      projectId: config.projectId,
      secretPath,
      expandSecretReferences: true,
      viewSecretValue: true,
    })

    for (const secret of result.secrets) {
      const key = applyPrefix(secret.secretKey, envPrefix)
      process.env[key] = secret.secretValue
      count++
    }
  }

  return count
}

/**
 * 检测本地是否有 infisical CLI 可用。
 */
function hasInfisicalCLI(): boolean {
  try {
    execSync('infisical --version', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * 检测 infisical CLI 当前是否已登录。
 *
 * `infisical user` 在已登录时返回当前账号信息，未登录时退出码非 0 且 stderr
 * 通常包含 "Login expired" / "no login session" 等提示。
 */
export function isInfisicalLoggedIn(): boolean {
  try {
    execSync('infisical user', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * 读取项目 .infisical.json 获取 workspaceId（projectId）。
 */
function readInfisicalJson(): { workspaceId?: string } {
  const filePath = resolve('.infisical.json')
  if (!existsSync(filePath)) return {}
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return {}
  }
}

/** infisical export 错误分类 */
export type InfisicalCliErrorKind = 'not-logged-in' | 'no-project' | 'other'

export interface InfisicalCliError {
  kind: InfisicalCliErrorKind
  path: string
  stderr: string
}

/**
 * 通过 infisical CLI 拉取 secrets（本地开发场景）。
 * 利用 CLI 的本地用户登录 session + .infisical.json 的 projectId。
 *
 * 错误不再静默吞掉：捕获 stderr 后由调用方决定如何呈现（区分未登录 / 无项目 / 其他）。
 */
export function fetchSecretsViaCLI(
  environment: string,
  paths: string[],
  envPrefix?: string
): { count: number; errors: InfisicalCliError[] } {
  let count = 0
  const errors: InfisicalCliError[] = []

  for (const secretPath of paths) {
    try {
      const output = execSync(
        `infisical export --path=${secretPath} --env=${environment} --format=dotenv`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      )

      const vars = dotenvParse(output)
      for (const [key, value] of Object.entries(vars)) {
        process.env[applyPrefix(key, envPrefix)] = value
        count++
      }
    } catch (e: any) {
      const stderr = String(e?.stderr || e?.message || '')
      const lower = stderr.toLowerCase()
      let kind: InfisicalCliErrorKind = 'other'
      if (
        lower.includes('login expired') ||
        lower.includes('no login session') ||
        lower.includes('not logged in') ||
        lower.includes('please login') ||
        lower.includes('user is not logged')
      ) {
        kind = 'not-logged-in'
      } else if (
        lower.includes('workspaceid') ||
        lower.includes('project id') ||
        lower.includes('infisical.json')
      ) {
        kind = 'no-project'
      }
      errors.push({ kind, path: secretPath, stderr })
    }
  }

  return { count, errors }
}

export { hasInfisicalCLI, readInfisicalJson }
