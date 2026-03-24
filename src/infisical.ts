import { InfisicalSDK } from '@infisical/sdk'

export interface InfisicalConfig {
  clientId: string
  clientSecret: string
  projectId: string
  environment: string
  paths: string[]
  siteUrl?: string
}

/**
 * 从环境变量中读取 Infisical 配置。
 * 如果缺少必要字段则返回 null（表示不使用 Infisical）。
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
 * 从 Infisical 拉取 secrets 并注入 process.env。
 * 返回注入的变量数量。
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
