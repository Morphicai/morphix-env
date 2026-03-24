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
  const projectId = process.env.INFISICAL_PROJECT_ID

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

/**
 * 通过 SDK（Machine Identity）拉取 secrets 并注入 process.env。
 */
export async function fetchInfisicalSecrets(config: InfisicalConfig): Promise<number> {
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
      process.env[secret.secretKey] = secret.secretValue
      count++
    }
  }

  return count
}

/**
 * 检测本地是否有 infisical CLI 可用且已登录。
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

/**
 * 通过 infisical CLI 拉取 secrets（本地开发场景）。
 * 利用 CLI 的本地用户登录 session + .infisical.json 的 projectId。
 */
export function fetchSecretsViaCLI(
  environment: string,
  paths: string[]
): number {
  let count = 0

  for (const secretPath of paths) {
    try {
      const output = execSync(
        `infisical export --path=${secretPath} --env=${environment} --format=dotenv`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      )

      const vars = dotenvParse(output)
      for (const [key, value] of Object.entries(vars)) {
        process.env[key] = value
        count++
      }
    } catch {
      // 单个 path 失败不阻塞其他 path
    }
  }

  return count
}

export { hasInfisicalCLI, readInfisicalJson }
