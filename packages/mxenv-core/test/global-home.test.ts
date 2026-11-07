import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

// 全局目录判定（0.12.1 写只落新名配套）：新目录用 hasGlobalData 判活而非存在性；
// 迁移提示每机一次（旧目录内 marker）。
const HOME = join(tmpdir(), `mxenv-global-home-${randomUUID()}`)
const NEXT = join(HOME, '.mxenv')
const LEGACY = join(HOME, '.mx-env')

async function freshModule() {
  vi.resetModules()
  return import('../src/global-home')
}

beforeEach(() => {
  mkdirSync(HOME, { recursive: true })
})

afterEach(() => {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true, force: true })
})

describe('hasGlobalDataAt', () => {
  it('treats scaffolding-only dirs as no data and real files as data', async () => {
    const { hasGlobalDataAt } = await freshModule()
    expect(hasGlobalDataAt(join(HOME, 'missing'))).toBe(false)
    mkdirSync(join(NEXT, 'audit'), { recursive: true })
    mkdirSync(join(NEXT, 'shims'), { recursive: true })
    writeFileSync(join(NEXT, '.mxenv-verify-pending'), '')
    expect(hasGlobalDataAt(NEXT)).toBe(false)
    writeFileSync(join(NEXT, 'config.json'), '{}')
    expect(hasGlobalDataAt(NEXT)).toBe(true)
  })
})

describe('resolveGlobalDir', () => {
  it('keeps the legacy dir active while the new dir holds only scaffolding (no read flip)', async () => {
    const { resolveGlobalDir } = await freshModule()
    mkdirSync(LEGACY, { recursive: true })
    writeFileSync(join(LEGACY, '.env'), 'K=v\n')
    mkdirSync(join(NEXT, 'audit'), { recursive: true })
    expect(resolveGlobalDir(HOME)).toBe(LEGACY)
  })

  it('prefers the new dir once it holds real data', async () => {
    const { resolveGlobalDir } = await freshModule()
    mkdirSync(LEGACY, { recursive: true })
    mkdirSync(NEXT, { recursive: true })
    writeFileSync(join(NEXT, 'config.json'), '{}')
    expect(resolveGlobalDir(HOME)).toBe(NEXT)
  })

  it('returns the new dir when neither exists (fresh install)', async () => {
    const { resolveGlobalDir } = await freshModule()
    expect(resolveGlobalDir(HOME)).toBe(NEXT)
  })
})

describe('legacy migration hint', () => {
  it('prints once per machine via a marker in the legacy dir', async () => {
    const { resolveGlobalDir, legacyHomeHintShown } = await freshModule()
    mkdirSync(LEGACY, { recursive: true })
    resolveGlobalDir(HOME)
    expect(legacyHomeHintShown()).toBe(true)
    expect(existsSync(join(LEGACY, '.mxenv-legacy-hint-shown'))).toBe(true)

    // 第二个"进程"：marker 在场 → 不再打印。
    const again = await freshModule()
    again.resolveGlobalDir(HOME)
    expect(again.legacyHomeHintShown()).toBe(false)
  })

  it('stays silent when suppressed (migrate --home, --no-global)', async () => {
    const { resolveGlobalDir, suppressLegacyHomeHint, legacyHomeHintShown } = await freshModule()
    mkdirSync(LEGACY, { recursive: true })
    suppressLegacyHomeHint()
    resolveGlobalDir(HOME)
    expect(legacyHomeHintShown()).toBe(false)
  })
})
