import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig } from '../src/config'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { resolve } from 'path'

const CONFIG_PATH = resolve('mx-env.config.json')

afterEach(() => {
  if (existsSync(CONFIG_PATH)) {
    unlinkSync(CONFIG_PATH)
  }
  delete process.env.DEPLOY_ENV
})

describe('loadConfig', () => {
  it('配置文件不存在返回空对象', () => {
    const config = loadConfig()
    expect(config).toEqual({})
  })

  it('读取完整配置', () => {
    writeFileSync(CONFIG_PATH, JSON.stringify({
      infisical: {
        projectId: 'proj-123',
        paths: ['/ai/shared', '/ai/web'],
        env: 'prod',
      },
      envFiles: ['.env.local', '.env.staging'],
      generate: {
        out: 'public/__env.js',
        filter: 'NEXT_PUBLIC_',
      },
    }))

    const config = loadConfig()
    expect(config.infisical?.projectId).toBe('proj-123')
    expect(config.infisical?.paths).toEqual(['/ai/shared', '/ai/web'])
    expect(config.infisical?.env).toBe('prod')
    expect(config.envFiles).toEqual(['.env.local', '.env.staging'])
    expect(config.generate?.out).toBe('public/__env.js')
  })

  it('解析 $ENV_VAR 引用', () => {
    process.env.DEPLOY_ENV = 'staging'
    writeFileSync(CONFIG_PATH, JSON.stringify({
      infisical: {
        projectId: 'proj-123',
        paths: ['/ai/shared'],
        env: '$DEPLOY_ENV',
      },
    }))

    const config = loadConfig()
    expect(config.infisical?.env).toBe('staging')
  })

  it('$ENV_VAR 引用不存在时返回空字符串', () => {
    writeFileSync(CONFIG_PATH, JSON.stringify({
      infisical: {
        projectId: 'proj-123',
        paths: ['/'],
        env: '$NONEXISTENT_VAR',
      },
    }))

    const config = loadConfig()
    expect(config.infisical?.env).toBe('')
  })

  it('JSON 格式错误不崩溃', () => {
    writeFileSync(CONFIG_PATH, '{ invalid json }}}')

    const config = loadConfig()
    expect(config).toEqual({})
  })
})
