import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseEnvFile, loadEnvFiles, extractPublicVars } from '../src/env'
import { writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const TMP = join(tmpdir(), 'mx-env-test-' + Date.now())

beforeEach(() => {
  mkdirSync(TMP, { recursive: true })
})

afterEach(() => {
  // 清理测试创建的 env keys
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('MXTEST_')) {
      delete process.env[key]
    }
  }
})

// ─── parseEnvFile ─────────────────────────────────────────

describe('parseEnvFile', () => {
  it('解析基本 key=value', () => {
    const f = join(TMP, '.env.basic')
    writeFileSync(f, 'MXTEST_A=hello\nMXTEST_B=world\n')

    const vars = parseEnvFile(f)
    expect(vars).toEqual({ MXTEST_A: 'hello', MXTEST_B: 'world' })
  })

  it('跳过注释和空行', () => {
    const f = join(TMP, '.env.comments')
    writeFileSync(f, '# this is a comment\n\nMXTEST_C=value\n\n# another\n')

    const vars = parseEnvFile(f)
    expect(vars).toEqual({ MXTEST_C: 'value' })
  })

  it('去除双引号', () => {
    const f = join(TMP, '.env.quotes')
    writeFileSync(f, 'MXTEST_D="quoted value"\nMXTEST_E=\'single quoted\'\n')

    const vars = parseEnvFile(f)
    expect(vars).toEqual({ MXTEST_D: 'quoted value', MXTEST_E: 'single quoted' })
  })

  it('value 中包含等号', () => {
    const f = join(TMP, '.env.eqvalue')
    writeFileSync(f, 'MXTEST_URL=postgres://user:pass@host/db?ssl=true\n')

    const vars = parseEnvFile(f)
    expect(vars.MXTEST_URL).toBe('postgres://user:pass@host/db?ssl=true')
  })

  it('空值', () => {
    const f = join(TMP, '.env.empty')
    writeFileSync(f, 'MXTEST_EMPTY=\nMXTEST_SPACE= \n')

    const vars = parseEnvFile(f)
    expect(vars.MXTEST_EMPTY).toBe('')
    expect(vars.MXTEST_SPACE).toBe('')
  })

  it('文件不存在返回空对象', () => {
    const vars = parseEnvFile('/nonexistent/.env.nope')
    expect(vars).toEqual({})
  })

  it('处理 CRLF 换行符', () => {
    const f = join(TMP, '.env.crlf')
    writeFileSync(f, 'MXTEST_CR=one\r\nMXTEST_LF=two\r\n')

    const vars = parseEnvFile(f)
    expect(vars).toEqual({ MXTEST_CR: 'one', MXTEST_LF: 'two' })
  })

  it('key 两侧有空格', () => {
    const f = join(TMP, '.env.spaces')
    writeFileSync(f, '  MXTEST_SP  =  trimmed  \n')

    const vars = parseEnvFile(f)
    expect(vars.MXTEST_SP).toBe('trimmed')
  })
})

// ─── loadEnvFiles ─────────────────────────────────────────

describe('loadEnvFiles', () => {
  it('注入 process.env', () => {
    const f = join(TMP, '.env.inject')
    writeFileSync(f, 'MXTEST_INJECT=yes\n')

    loadEnvFiles([f])
    expect(process.env.MXTEST_INJECT).toBe('yes')
  })

  it('后文件覆盖前文件', () => {
    const f1 = join(TMP, '.env.first')
    const f2 = join(TMP, '.env.second')
    writeFileSync(f1, 'MXTEST_PRIO=first\n')
    writeFileSync(f2, 'MXTEST_PRIO=second\n')

    loadEnvFiles([f1, f2])
    expect(process.env.MXTEST_PRIO).toBe('second')
  })

  it('返回 overrides 列表', () => {
    const f = join(TMP, '.env.overrides')
    writeFileSync(f, 'MXTEST_OV1=a\nMXTEST_OV2=b\n')

    const result = loadEnvFiles([f])
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ key: 'MXTEST_OV1', source: f })
  })

  it('不存在的文件不报错', () => {
    const result = loadEnvFiles(['/nonexistent/.env.nope'])
    expect(result).toEqual([])
  })
})

// ─── extractPublicVars ────────────────────────────────────

describe('extractPublicVars', () => {
  it('提取 NEXT_PUBLIC_ 前缀', () => {
    process.env.MXTEST_PRIVATE = 'secret'
    process.env.NEXT_PUBLIC_MXTEST_API = 'http://localhost'

    const vars = extractPublicVars()
    expect(vars.NEXT_PUBLIC_MXTEST_API).toBe('http://localhost')
    expect(vars.MXTEST_PRIVATE).toBeUndefined()

    delete process.env.NEXT_PUBLIC_MXTEST_API
  })

  it('提取 VITE_ 前缀', () => {
    process.env.VITE_MXTEST_URL = 'https://api.test'

    const vars = extractPublicVars()
    expect(vars.VITE_MXTEST_URL).toBe('https://api.test')

    delete process.env.VITE_MXTEST_URL
  })

  it('提取 EXPO_PUBLIC_ 前缀', () => {
    process.env.EXPO_PUBLIC_MXTEST_KEY = 'expo-key'

    const vars = extractPublicVars()
    expect(vars.EXPO_PUBLIC_MXTEST_KEY).toBe('expo-key')

    delete process.env.EXPO_PUBLIC_MXTEST_KEY
  })

  it('不提取无前缀变量', () => {
    process.env.MXTEST_NOPE = 'nope'

    const vars = extractPublicVars()
    expect(vars.MXTEST_NOPE).toBeUndefined()
  })
})
