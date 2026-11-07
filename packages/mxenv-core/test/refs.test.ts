import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { loadConfigLayers } from '../src/config'
import { findMxEnvReferences, hasMxEnvReference, ReferenceResolver } from '../src/refs'

const ROOT = join(tmpdir(), `mxenv-refs-${randomUUID()}`)
const HOME = join(ROOT, 'home')
const PROJECT = join(ROOT, 'project')

function value(label: string): string {
  return `mxenv_test_${label}_${randomUUID().replace(/-/g, '')}`
}

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

function resolver(): ReferenceResolver {
  return new ReferenceResolver(
    loadConfigLayers({ homeDir: HOME, cwd: PROJECT }),
    { homeDir: HOME, noInfisical: true, baseEnvironment: {} },
  )
}

function setup(files: Record<string, string>, config: Record<string, unknown>): void {
  mkdirSync(HOME, { recursive: true })
  mkdirSync(PROJECT, { recursive: true })
  for (const [name, content] of Object.entries(files)) write(join(PROJECT, name), content)
  write(join(PROJECT, 'mxenv.config.json'), JSON.stringify(config))
}

afterEach(() => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true })
})

describe('mxenv:// reference scanning (scheme 直切)', () => {
  it('finds unique references in declaration order', () => {
    const text = 'a=mxenv://dev/KEY1\nb=mxenv://ci/KEY2\nc=mxenv://dev/KEY1'
    expect(findMxEnvReferences(text)).toEqual([
      { profile: 'dev', key: 'KEY1' },
      { profile: 'ci', key: 'KEY2' },
    ])
    expect(hasMxEnvReference(text)).toBe(true)
    expect(hasMxEnvReference('plain text ${KEY}')).toBe(false)
  })

  it('ignores malformed references', () => {
    expect(findMxEnvReferences('mxenv://onlyprofile mxenv:///KEY')).toEqual([])
  })
})

describe('mx-env:// 旧 scheme 拒绝（引用语法直切，无垫片）', () => {
  it('解析面命中旧 scheme 即拒绝并提示改用 mxenv://', () => {
    expect(() => findMxEnvReferences('a=mx-env://dev/KEY1')).toThrow(/请改用 `mxenv:\/\//)
    expect(() => hasMxEnvReference('a=mx-env://dev/KEY1')).toThrow(/旧引用语法/)
  })

  it('resolveText 对旧 scheme 引用硬失败，不静默兼容', async () => {
    setup(
      { 'a.env': 'MX_ALPHA=one\n' },
      {
        sources: { a: { provider: 'local', files: ['a.env'] } },
        profiles: { alpha: { sources: ['a'] } },
        defaultProfile: 'alpha',
      },
    )
    await expect(resolver().resolveText('x=mx-env://alpha/MX_ALPHA')).rejects.toThrow(/旧引用语法/)
  })

  it('值内嵌旧 scheme 在组合解析面同样被拒', async () => {
    setup(
      { 'a.env': 'MX_LEGACY=mx-env://alpha/KEY\n' },
      {
        sources: { a: { provider: 'local', files: ['a.env'] } },
        profiles: { alpha: { sources: ['a'] } },
        defaultProfile: 'alpha',
      },
    )
    await expect(resolver().resolveText('v=mxenv://alpha/MX_LEGACY')).rejects.toThrow(/旧引用语法/)
  })
})

describe('ReferenceResolver', () => {
  it('resolves a reference against the referenced profile', async () => {
    const alpha = value('alpha')
    setup(
      { 'a.env': `MX_ALPHA=${alpha}\n`, 'b.env': 'MX_BETA=beta\n' },
      {
        sources: {
          a: { provider: 'local', files: ['a.env'] },
          b: { provider: 'local', files: ['b.env'] },
        },
        profiles: { alpha: { sources: ['a'] }, beta: { sources: ['b'] } },
        defaultProfile: 'beta',
      },
    )

    const result = await resolver().resolveText('token=mxenv://alpha/MX_ALPHA')
    expect(result.missing).toEqual([])
    expect(result.text).toBe(`token=${alpha}`)
  })

  it('resolves nested references across profiles', async () => {
    const alpha = value('nested')
    setup(
      { 'a.env': `MX_ALPHA=${alpha}\n`, 'b.env': 'MX_B_REF=mxenv://alpha/MX_ALPHA\n' },
      {
        sources: {
          a: { provider: 'local', files: ['a.env'] },
          b: { provider: 'local', files: ['b.env'] },
        },
        profiles: { alpha: { sources: ['a'] }, beta: { sources: ['b'] } },
        defaultProfile: 'beta',
      },
    )

    const result = await resolver().resolveText('deep=mxenv://beta/MX_B_REF')
    expect(result.missing).toEqual([])
    expect(result.text).toBe(`deep=${alpha}`)
  })

  it('reports a missing key without substituting', async () => {
    setup(
      { 'a.env': 'MX_ALPHA=one\n' },
      {
        sources: { a: { provider: 'local', files: ['a.env'] } },
        profiles: { alpha: { sources: ['a'] } },
        defaultProfile: 'alpha',
      },
    )

    const result = await resolver().resolveText('x=mxenv://alpha/NOPE')
    expect(result.text).toBe('x=mxenv://alpha/NOPE')
    expect(result.missing).toEqual([{ profile: 'alpha', key: 'NOPE', reason: 'missing' }])
  })

  it('reports an unknown profile as missing', async () => {
    const result = await resolver().resolveText('x=mxenv://nowhere/KEY')
    expect(result.text).toBe('x=mxenv://nowhere/KEY')
    expect(result.missing).toEqual([{ profile: 'nowhere', key: 'KEY', reason: 'missing' }])
  })

  it('terminates on a reference cycle instead of recursing forever', async () => {
    setup(
      { 'g.env': 'MX_G=mxenv://delta/MX_D\n', 'd.env': 'MX_D=mxenv://gamma/MX_G\n' },
      {
        sources: {
          g: { provider: 'local', files: ['g.env'] },
          d: { provider: 'local', files: ['d.env'] },
        },
        profiles: { gamma: { sources: ['g'] }, delta: { sources: ['d'] } },
        defaultProfile: 'gamma',
      },
    )

    const result = await resolver().resolveText('q=mxenv://gamma/MX_G')
    expect(result.text).toBe('q=mxenv://gamma/MX_G')
    expect(result.missing).toEqual([{ profile: 'gamma', key: 'MX_G', reason: 'cycle' }])
  })

  it('allows a value to reference its own profile (same-profile key lookup)', async () => {
    const direct = value('self')
    setup(
      { 'a.env': `MX_DIRECT=${direct}\nMX_INDIRECT=mxenv://alpha/MX_DIRECT\n` },
      {
        sources: { a: { provider: 'local', files: ['a.env'] } },
        profiles: { alpha: { sources: ['a'] } },
        defaultProfile: 'alpha',
      },
    )

    const result = await resolver().resolveText('v=mxenv://alpha/MX_INDIRECT')
    expect(result.missing).toEqual([])
    expect(result.text).toBe(`v=${direct}`)
  })
})
