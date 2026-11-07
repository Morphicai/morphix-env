import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { RESERVED_SHIM_NAMES, shimsDir, stripShimsFromPath, sanitizeBootEnv, validateShimList } from '../src/shims'

// package-split 4.1 下沉的共享 shim 逻辑（L1）独立测试：mxenv-cli 侧
// shims.test.ts 面向 L3 行为（生成/剥离/rc），本文件保证只跑 core 套件时
// 共享层同样受守卫——sanitizeBootEnv 此前全仓零覆盖，一并补齐。

const TMP = join(tmpdir(), `mx-env-core-shims-${randomUUID()}`)
const HOME = join(TMP, 'home')

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(HOME, { recursive: true })
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('validateShimList', () => {
  it('接受合法清单；undefined/null 视为空', () => {
    expect(validateShimList(['node', 'pnpm', 'my-tool.v2'], 'cfg')).toEqual([])
    expect(validateShimList(undefined, 'cfg')).toEqual([])
    expect(validateShimList(null, 'cfg')).toEqual([])
  })

  it('拒绝非数组、空串/非字符串、路径分隔符/空白/连字符开头', () => {
    expect(validateShimList('node', 'cfg')[0]).toContain('array')
    expect(validateShimList([''], 'cfg')[0]).toContain('non-empty')
    expect(validateShimList([42], 'cfg')[0]).toContain('non-empty')
    expect(validateShimList(['../evil'], 'cfg')[0]).toContain('../evil')
    expect(validateShimList(['a b'], 'cfg')[0]).toContain('a b')
    expect(validateShimList(['-lead'], 'cfg')[0]).toContain('-lead')
  })

  it('保留名（含 Wave B 占位 gui/global/host）大小写不敏感拒绝', () => {
    for (const name of ['run', 'RUN', 'mx-env', 'shell-init', 'gui', 'global', 'host']) {
      const errors = validateShimList([name], 'cfg')
      expect(errors, name).toHaveLength(1)
      expect(errors[0], name).toContain('reserved')
    }
    expect(RESERVED_SHIM_NAMES).toContain('gui')
  })

  it('bin 主名/旧名与保留入口全部在册（回归护栏，防 RESERVED 清单被修剪）', () => {
    for (const name of ['mxenv', 'mx-env', 'morphix-env', '__mx_editor', 'run', 'shell-init', 'gui', 'global', 'host']) {
      expect(RESERVED_SHIM_NAMES, name).toContain(name)
    }
    // 名字形态合法者必须命中 reserved 文案；__mx_editor 以 _ 开头被名称形态规则
    // 先拒（同为拒绝，护栏语义=一律不可作 shim 名）。
    for (const name of ['mxenv', 'mx-env', 'morphix-env', 'run', 'shell-init', 'gui', 'global', 'host']) {
      const errors = validateShimList([name], 'cfg')
      expect(errors, name).toHaveLength(1)
      expect(errors[0], name).toContain('reserved')
    }
    expect(validateShimList(['__mx_editor'], 'cfg'), '__mx_editor').toHaveLength(1)
  })

  it('大小写不敏感查重', () => {
    expect(validateShimList(['Node', 'node'], 'cfg')[0]).toContain('duplicate')
    expect(
      validateShimList(['node', 'Node', 'NODE'], 'cfg').filter((error) => error.includes('duplicate')),
    ).toHaveLength(2)
  })
})

describe('stripShimsFromPath', () => {
  it('递归剥离所有指向 shims 目录的条目（含尾斜杠/重复出现），其余保留', () => {
    const dir = shimsDir(HOME)
    mkdirSync(dir, { recursive: true })
    const path = `/usr/bin:${dir}:/bin:${dir}/:${dir}`
    expect(stripShimsFromPath(path, HOME)).toBe('/usr/bin:/bin')
  })

  it('目录不存在时按字面比较剥离；干净 PATH 原样；undefined 透传；空段保留', () => {
    const dir = shimsDir(HOME) // 故意不创建
    expect(stripShimsFromPath(`/usr/bin:${dir}:/bin`, HOME)).toBe('/usr/bin:/bin')
    expect(stripShimsFromPath('/usr/bin:/bin', HOME)).toBe('/usr/bin:/bin')
    expect(stripShimsFromPath(undefined, HOME)).toBeUndefined()
    // POSIX 语义：空 PATH 条目 = 当前目录，过滤器必须保留。
    expect(stripShimsFromPath('/usr/bin::/bin', HOME)).toBe('/usr/bin::/bin')
  })

  it('非 shim 目录不动（含同级相似名）', () => {
    const sibling = join(HOME, '.mx-env', 'shims-extra')
    mkdirSync(sibling, { recursive: true })
    expect(stripShimsFromPath(`/bin:${sibling}`, HOME)).toBe(`/bin:${sibling}`)
  })
})

describe('sanitizeBootEnv', () => {
  it('剥掉 PATH 中的 shim 目录并删除 MXENV_SHIM 标记，返回消毒前状态', () => {
    const dir = shimsDir(HOME)
    mkdirSync(dir, { recursive: true })
    const env: NodeJS.ProcessEnv = { PATH: `/usr/bin:${dir}:/bin`, MXENV_SHIM: '1' }
    const result = sanitizeBootEnv(env, HOME)
    expect(env.PATH).toBe('/usr/bin:/bin')
    expect(env.MXENV_SHIM).toBeUndefined()
    expect(result.viaShim).toBe(true)
    expect(result.originalPath).toBe(`/usr/bin:${dir}:/bin`)
  })

  it('无标记 viaShim=false；PATH 全是 shim 条目时整个删除；干净 PATH 原样', () => {
    const dir = shimsDir(HOME)
    mkdirSync(dir, { recursive: true })
    const env: NodeJS.ProcessEnv = { PATH: dir }
    const result = sanitizeBootEnv(env, HOME)
    expect('PATH' in env).toBe(false)
    expect(result.viaShim).toBe(false)
    expect(result.originalPath).toBe(dir)

    const clean: NodeJS.ProcessEnv = { PATH: '/usr/bin' }
    sanitizeBootEnv(clean, HOME)
    expect(clean.PATH).toBe('/usr/bin')
    expect(clean.MXENV_SHIM).toBeUndefined()
  })
})
