import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 分层边界断言（package-split 2.3）：产品包（mxenv L2 / mxenv-cli L3）不得出现
// 第二套值解密/揭示实现——keytar/dotenvx 等解密依赖不出现在依赖面与源码 import；
// 值能力 compose（=composeEnvironment）唯一实现留在 mxenv-core。

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PRODUCT_PACKAGES = ['mxenv', 'mxenv-cli'] as const

/** 解密/密钥材料依赖：出现即意味着产品包在自建第二套揭示能力。 */
const FORBIDDEN_DEPS = ['keytar', '@dotenvx/dotenvx', 'dotenvx']
// 子路径同禁（keytar/run、dotenvx/dist/… 这类规避型导入不得漏检）。
const FORBIDDEN_SPECIFIER = /^(keytar(\/|$)|@dotenvx\/|dotenvx(\/|$))/
const DEP_SECTIONS = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'] as const

const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'generated'])

function walkSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) walkSources(full, out)
    } else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry.name)) out.push(full)
  }
  return out
}

function importSpecifiers(code: string): string[] {
  const found: string[] = []
  const patterns = [
    /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
  ]
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) found.push(match[1])
  }
  return found
}

describe('产品包分层边界（2.3 值能力窄暴露收口）', () => {
  for (const pkg of PRODUCT_PACKAGES) {
    it(`${pkg} 依赖面无 keytar/dotenvx 解密依赖`, () => {
      const manifest = JSON.parse(
        readFileSync(path.join(repoRoot, 'packages', pkg, 'package.json'), 'utf8'),
      ) as Record<string, Record<string, string> | undefined>
      for (const section of DEP_SECTIONS) {
        const deps = Object.keys(manifest[section] || {})
        const offenders = deps.filter((name) => FORBIDDEN_DEPS.includes(name))
        expect(offenders, `${pkg} ${section} 出现解密依赖`).toEqual([])
      }
    })

    it(`${pkg} 源码 import 面无 keytar/dotenvx 第二套解密实现`, () => {
      // 扫描面是包内全部脚本面（src/test/scripts/配置），防揭示助手外挂逃逸；
      // 已知盲区：execFileSync('dotenvx', …) 子进程外挂解密 CLI（无 import 可查）。
      const srcDir = path.join(repoRoot, 'packages', pkg)
      const offenders: string[] = []
      for (const file of walkSources(srcDir)) {
        for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
          if (FORBIDDEN_SPECIFIER.test(specifier)) {
            offenders.push(`${path.relative(repoRoot, file)} → ${specifier}`)
          }
        }
      }
      expect(offenders).toEqual([])
    })
  }

  it('产品包零互依：mxenv ↔ mxenv-cli 依赖面与源码 import 面互不指向（包自引用合法）', () => {
    for (const pkg of PRODUCT_PACKAGES) {
      const other = pkg === 'mxenv' ? 'mxenv-cli' : 'mxenv'
      const manifest = JSON.parse(
        readFileSync(path.join(repoRoot, 'packages', pkg, 'package.json'), 'utf8'),
      ) as Record<string, Record<string, string> | undefined>
      for (const section of DEP_SECTIONS) {
        const deps = Object.keys(manifest[section] || {})
        expect(deps, `${pkg} ${section} 出现 ${other} 依赖（产品包零互依）`).not.toContain(other)
      }
      const offenders: string[] = []
      for (const file of walkSources(path.join(repoRoot, 'packages', pkg))) {
        for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
          if (specifier === other || specifier.startsWith(`${other}/`)) {
            offenders.push(`${path.relative(repoRoot, file)} → ${specifier}`)
          }
        }
      }
      expect(offenders, `${pkg} 源码 import 不得指向 ${other}`).toEqual([])
    }
  })

  it('compose（=composeEnvironment）唯一实现位于 mxenv-core', () => {
    const scanRoots = [
      path.join(repoRoot, 'src'),
      path.join(repoRoot, 'packages', 'mxenv-core', 'src'),
      path.join(repoRoot, 'packages', 'mxenv', 'src'),
      path.join(repoRoot, 'packages', 'mxenv-cli', 'src'),
    ].filter((dir) => {
      try {
        return readdirSync(dir).length >= 0
      } catch {
        return false
      }
    })

    const definitions: string[] = []
    for (const root of scanRoots) {
      for (const file of walkSources(root)) {
        if (/(?:function|const|let|var)\s+composeEnvironment\b/.test(readFileSync(file, 'utf8'))) {
          definitions.push(path.relative(repoRoot, file))
        }
      }
    }
    expect(definitions).toEqual([path.join('packages', 'mxenv-core', 'src', 'composition.ts')])
  })
})
