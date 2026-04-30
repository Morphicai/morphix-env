import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getInfisicalConfig, fetchInfisicalSecrets } from '../src/infisical'

// ─── Mock Infisical SDK ───────────────────────────────────

const mockSecrets = {
  '/ai/shared': [
    { secretKey: 'SUPABASE_URL', secretValue: 'https://xxx.supabase.co' },
    { secretKey: 'SUPABASE_ANON_KEY', secretValue: 'eyJ-anon-key' },
    { secretKey: 'SENTRY_DSN', secretValue: 'https://sentry.io/xxx' },
  ],
  '/ai/web': [
    { secretKey: 'NEXT_PUBLIC_API_BASE_URL', secretValue: 'https://api.morphix.app' },
    { secretKey: 'NEXT_PUBLIC_APP_SHELL_URL', secretValue: 'https://app.morphix.app' },
    { secretKey: 'NEXT_PUBLIC_PADDLE_TOKEN', secretValue: 'pdl_xxx' },
  ],
  '/ai/api': [
    { secretKey: 'DATABASE_URL', secretValue: 'postgres://user:pass@host/db' },
    { secretKey: 'OPENAI_API_KEY', secretValue: 'sk-xxx' },
    { secretKey: 'JWT_SECRET', secretValue: 'super-secret-jwt' },
  ],
}

vi.mock('@infisical/sdk', () => {
  class MockInfisicalSDK {
    auth() {
      return {
        universalAuth: {
          login: vi.fn().mockResolvedValue(undefined),
        },
      }
    }
    secrets() {
      return {
        listSecrets: vi.fn().mockImplementation(({ secretPath }: { secretPath: string }) => {
          const secrets = mockSecrets[secretPath as keyof typeof mockSecrets] || []
          return Promise.resolve({ secrets })
        }),
      }
    }
  }
  return { InfisicalSDK: MockInfisicalSDK }
})

// ─── 测试 ─────────────────────────────────────────────────

describe('getInfisicalConfig', () => {
  const envBackup: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of ['INFISICAL_CLIENT_ID', 'INFISICAL_CLIENT_SECRET', 'INFISICAL_PROJECT_ID', 'DEPLOY_ENV', 'INFISICAL_ENV', 'INFISICAL_PATHS', 'INFISICAL_SITE_URL']) {
      envBackup[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(envBackup)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('缺少凭证返回 null', () => {
    expect(getInfisicalConfig()).toBeNull()
  })

  it('只有部分凭证返回 null', () => {
    process.env.INFISICAL_CLIENT_ID = 'id'
    expect(getInfisicalConfig()).toBeNull()
  })

  it('完整凭证返回配置', () => {
    process.env.INFISICAL_CLIENT_ID = 'id'
    process.env.INFISICAL_CLIENT_SECRET = 'secret'
    process.env.INFISICAL_PROJECT_ID = 'proj'

    const config = getInfisicalConfig()
    expect(config).not.toBeNull()
    expect(config!.clientId).toBe('id')
    expect(config!.environment).toBe('dev') // 默认值
    expect(config!.paths).toEqual(['/'])     // 默认值
  })

  it('读取 DEPLOY_ENV', () => {
    process.env.INFISICAL_CLIENT_ID = 'id'
    process.env.INFISICAL_CLIENT_SECRET = 'secret'
    process.env.INFISICAL_PROJECT_ID = 'proj'
    process.env.DEPLOY_ENV = 'prod'

    expect(getInfisicalConfig()!.environment).toBe('prod')
  })

  it('INFISICAL_ENV 作为 fallback', () => {
    process.env.INFISICAL_CLIENT_ID = 'id'
    process.env.INFISICAL_CLIENT_SECRET = 'secret'
    process.env.INFISICAL_PROJECT_ID = 'proj'
    process.env.INFISICAL_ENV = 'staging'

    expect(getInfisicalConfig()!.environment).toBe('staging')
  })

  it('解析逗号分隔的 paths', () => {
    process.env.INFISICAL_CLIENT_ID = 'id'
    process.env.INFISICAL_CLIENT_SECRET = 'secret'
    process.env.INFISICAL_PROJECT_ID = 'proj'
    process.env.INFISICAL_PATHS = '/ai/shared, /ai/web'

    expect(getInfisicalConfig()!.paths).toEqual(['/ai/shared', '/ai/web'])
  })
})

describe('fetchInfisicalSecrets', () => {
  const injectedKeys: string[] = []

  afterEach(() => {
    for (const key of injectedKeys) {
      delete process.env[key]
    }
    injectedKeys.length = 0
  })

  it('拉取单路径 secrets 并注入 process.env', async () => {
    const count = await fetchInfisicalSecrets({
      clientId: 'id',
      clientSecret: 'secret',
      projectId: 'proj',
      environment: 'dev',
      paths: ['/ai/shared'],
    })

    injectedKeys.push('SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SENTRY_DSN')

    expect(count).toBe(3)
    expect(process.env.SUPABASE_URL).toBe('https://xxx.supabase.co')
    expect(process.env.SUPABASE_ANON_KEY).toBe('eyJ-anon-key')
    expect(process.env.SENTRY_DSN).toBe('https://sentry.io/xxx')
  })

  it('拉取多路径 secrets', async () => {
    const count = await fetchInfisicalSecrets({
      clientId: 'id',
      clientSecret: 'secret',
      projectId: 'proj',
      environment: 'prod',
      paths: ['/ai/shared', '/ai/web'],
    })

    injectedKeys.push('SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SENTRY_DSN',
      'NEXT_PUBLIC_API_BASE_URL', 'NEXT_PUBLIC_APP_SHELL_URL', 'NEXT_PUBLIC_PADDLE_TOKEN')

    expect(count).toBe(6)
    expect(process.env.NEXT_PUBLIC_API_BASE_URL).toBe('https://api.morphix.app')
    expect(process.env.NEXT_PUBLIC_APP_SHELL_URL).toBe('https://app.morphix.app')
  })

  it('API 项目路径拉取', async () => {
    const count = await fetchInfisicalSecrets({
      clientId: 'id',
      clientSecret: 'secret',
      projectId: 'proj',
      environment: 'prod',
      paths: ['/ai/shared', '/ai/api'],
    })

    injectedKeys.push('SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SENTRY_DSN',
      'DATABASE_URL', 'OPENAI_API_KEY', 'JWT_SECRET')

    expect(count).toBe(6)
    expect(process.env.DATABASE_URL).toBe('postgres://user:pass@host/db')
    expect(process.env.OPENAI_API_KEY).toBe('sk-xxx')
  })

  it('不存在的路径返回 0', async () => {
    const count = await fetchInfisicalSecrets({
      clientId: 'id',
      clientSecret: 'secret',
      projectId: 'proj',
      environment: 'dev',
      paths: ['/nonexistent'],
    })

    expect(count).toBe(0)
  })
})
