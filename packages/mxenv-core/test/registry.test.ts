import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  isRegistryEligible,
  pruneProjects,
  readProjectRegistry,
  registerProject,
  removeProject,
} from '../src/registry'

let home: string
let projectA: string
let projectB: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'mxenv-registry-'))
  projectA = mkdtempSync(join(tmpdir(), 'mxenv-proj-a-'))
  projectB = mkdtempSync(join(tmpdir(), 'mxenv-proj-b-'))
  delete process.env.MXENV_NO_PROJECT_REGISTRY
})

afterEach(() => {
  for (const dir of [home, projectA, projectB]) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 幂等 */ }
  }
})

function registryFile(): string {
  return join(home, '.mxenv', 'projects.json')
}

describe('mxenv-core registry（global-panel D1）', () => {
  it('首次登记：追加条目（name=basename）、0600、目录结构正确', () => {
    mkdirSync(join(projectA, '.mxenv'), { recursive: true })
    const wrote = registerProject(projectA, home)
    expect(wrote).toBe(true)
    const entries = readProjectRegistry(home)
    expect(entries).toHaveLength(1)
    expect(entries[0].path).toBe(projectA)
    expect(entries[0].name).toBe(projectA.split('/').pop())
    expect(entries[0].addedAt).toBe(entries[0].lastSeenAt)
    const mode = statSync(registryFile()).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('幂等：同路径再登记不新增条目，仅刷新 lastSeenAt（60s 内节流不写盘）', () => {
    mkdirSync(join(projectA, '.mxenv'), { recursive: true })
    registerProject(projectA, home)
    const first = readProjectRegistry(home)[0]
    // 节流窗口内：不写盘
    expect(registerProject(projectA, home)).toBe(false)
    expect(readProjectRegistry(home)[0].lastSeenAt).toBe(first.lastSeenAt)
    // 窗口外（手工把 lastSeenAt 拨回 2 分钟前）：刷新且条目数不变
    const entries = readProjectRegistry(home)
    entries[0].lastSeenAt = new Date(Date.now() - 120_000).toISOString()
    writeFileSync(registryFile(), JSON.stringify({ projects: entries }, null, 2))
    expect(registerProject(projectA, home)).toBe(true)
    const after = readProjectRegistry(home)
    expect(after).toHaveLength(1)
    expect(after[0].lastSeenAt).not.toBe(entries[0].lastSeenAt)
  })

  it('同名不同路径：basename 冲突加后缀 -2', () => {
    const parent = mkdtempSync(join(tmpdir(), 'mxenv-twin-'))
    const twinA = join(parent, 'demo')
    const twinB = join(parent, 'nested', 'demo')
    try {
      mkdirSync(twinA, { recursive: true })
      mkdirSync(join(twinA, '.mxenv'), { recursive: true })
      mkdirSync(twinB, { recursive: true })
      mkdirSync(join(twinB, '.mxenv'), { recursive: true })
      registerProject(twinA, home)
      registerProject(twinB, home)
      const names = readProjectRegistry(home).map((e) => e.name)
      expect(names).toHaveLength(2)
      expect(new Set(names).size).toBe(2) // 无重名
      expect(names).toContain('demo')
      expect(names.find((n) => n !== 'demo')).toMatch(/^demo-\d+$/)
    } finally {
      try { rmSync(parent, { recursive: true, force: true }) } catch { /* 幂等 */ }
    }
  })

  it('资格线：mxenv.config.json（现代/legacy 字段）与 .mxenv/ 目录算托管，裸目录不算', () => {
    expect(isRegistryEligible(projectA)).toBe(false) // 裸目录
    // legacy 字段形态的 mxenv.config.json 也算（接线层存在即托管过）
    writeFileSync(join(projectB, 'mxenv.config.json'), JSON.stringify({ infisical: { paths: ['/ai'] } }))
    expect(isRegistryEligible(projectB)).toBe(true)
    writeFileSync(join(projectA, 'mxenv.config.json'), JSON.stringify({ sources: {} }))
    expect(isRegistryEligible(projectA)).toBe(true)
    const plain = mkdtempSync(join(tmpdir(), 'plain-'))
    try {
      writeFileSync(join(plain, 'package.json'), JSON.stringify({ name: 'plain' }))
      expect(isRegistryEligible(plain)).toBe(false) // package.json 不是接线层
    } finally {
      try { rmSync(plain, { recursive: true, force: true }) } catch { /* 幂等 */ }
    }
  })

  it('removeProject：按 name 或绝对路径移除，幂等；清空即删文件', () => {
    mkdirSync(join(projectA, '.mxenv'), { recursive: true })
    registerProject(projectA, home)
    const name = readProjectRegistry(home)[0].name
    expect(removeProject('no-such-name', home)).toBe(false)
    expect(removeProject(name, home)).toBe(true)
    expect(readProjectRegistry(home)).toHaveLength(0)
    expect(existsSync(registryFile())).toBe(false) // 空表不留文件
    expect(removeProject(name, home)).toBe(false) // 幂等
  })

  it('pruneProjects：清除 path 已不存在的条目，返回被清除路径', () => {
    mkdirSync(join(projectA, '.mxenv'), { recursive: true })
    mkdirSync(join(projectB, '.mxenv'), { recursive: true })
    registerProject(projectA, home)
    registerProject(projectB, home)
    rmSync(projectB, { recursive: true, force: true })
    const pruned = pruneProjects(home)
    expect(pruned).toEqual([projectB])
    expect(readProjectRegistry(home).map((e) => e.path)).toEqual([projectA])
  })

  it('MXENV_NO_PROJECT_REGISTRY=1：读返回空清单、写/删/prune 全旁路', () => {
    process.env.MXENV_NO_PROJECT_REGISTRY = '1'
    mkdirSync(join(projectA, '.mxenv'), { recursive: true })
    expect(registerProject(projectA, home)).toBe(false)
    expect(readProjectRegistry(home)).toEqual([])
    expect(removeProject('x', home)).toBe(false)
    expect(pruneProjects(home)).toEqual([])
    expect(statSync(registryFile(), { throwIfNoEntry: false })).toBeUndefined()
  })

  it('损坏的注册表文件读作空清单（注册表故障不得影响 run/edit）', () => {
    mkdirSync(join(home, '.mxenv'), { recursive: true })
    writeFileSync(registryFile(), 'not json at all{')
    expect(readProjectRegistry(home)).toEqual([])
    // 再登记可自愈
    mkdirSync(join(projectA, '.mxenv'), { recursive: true })
    expect(registerProject(projectA, home)).toBe(true)
    expect(readProjectRegistry(home)).toHaveLength(1)
  })
})
