import { describe, it, expect, afterEach, vi } from 'vitest'
import { loadConfig } from '../src/config'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { resolve } from 'path'

const CONFIG_PATH = resolve('mxenv.config.json')
const LEGACY_CONFIG_PATH = resolve('mx-env.config.json')

afterEach(() => {
  vi.restoreAllMocks()
  for (const p of [CONFIG_PATH, LEGACY_CONFIG_PATH]) {
    if (existsSync(p)) {
      unlinkSync(p)
    }
  }
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
    expect(config.envFiles).toEqual(['.env.local', '.env.staging'])
    expect(config.generate?.out).toBe('public/__env.js')
  })

  it('只有 paths 的最小配置', () => {
    writeFileSync(CONFIG_PATH, JSON.stringify({
      infisical: {
        paths: ['/ai'],
      },
    }))

    const config = loadConfig()
    expect(config.infisical?.paths).toEqual(['/ai'])
    expect(config.infisical?.projectId).toBeUndefined()
  })

  it('JSON 格式错误不崩溃', () => {
    writeFileSync(CONFIG_PATH, '{ invalid json }}}')

    const config = loadConfig()
    expect(config).toEqual({})
  })
})

describe('配置双读垫片（naming-migration 旧名垫片与弃用窗口）', () => {
  it('仅旧名 mx-env.config.json 存在时不读取并给改名指引（垫片移除）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeFileSync(LEGACY_CONFIG_PATH, JSON.stringify({ envFiles: ['.env.legacy'] }))

    expect(loadConfig()).toEqual({})
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('mx-env.config.json')
    warn.mockRestore()
  })

  it('双配置并存新名优先，忽略旧文件并提示清理', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeFileSync(LEGACY_CONFIG_PATH, JSON.stringify({ envFiles: ['.env.old'] }))
    writeFileSync(CONFIG_PATH, JSON.stringify({ envFiles: ['.env.new'] }))

    expect(loadConfig().envFiles).toEqual(['.env.new'])
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('mx-env.config.json')
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/删除|清理/)
  })

  it('仅新名存在时不提示', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeFileSync(CONFIG_PATH, JSON.stringify({ envFiles: ['.env.new'] }))

    expect(loadConfig().envFiles).toEqual(['.env.new'])
    expect(warn).not.toHaveBeenCalled()
  })
})
