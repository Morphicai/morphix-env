#!/usr/bin/env node
/**
 * 发布顺序护栏（naming-cutover 4.1）：发布前校验本包 manifest 里声明的
 * `@morphixai/mxenv*` 依赖已在 registry 按语义版本可解析；未发布即拒绝并给按序修复指引。
 * 由各包 prepublishOnly 调起（cwd=包目录）；npm view 用 argv 传递，不拼 shell。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const deps = { ...(manifest.dependencies || {}), ...(manifest.peerDependencies || {}) }
const gates = Object.entries(deps).filter(([name]) => name.startsWith('@morphixai/mxenv'))

if (gates.length === 0) {
  console.log(`[prepublish-guard] ${manifest.name}@${manifest.version} 无 @morphixai/mxenv* 依赖门槛（发布序列首包）。`)
  process.exit(0)
}

let failed = false
for (const [name, range] of gates) {
  try {
    execFileSync('npm', ['view', `${name}@${range}`, 'version'], { stdio: 'pipe' })
    console.log(`[prepublish-guard] ${name}@${range} registry 可解析 ✓`)
  } catch {
    console.error(
      `[prepublish-guard] 拒绝发布 ${manifest.name}@${manifest.version}：依赖 ${name}@${range} 未在 registry 可解析。`,
    )
    console.error(
      `[prepublish-guard] 修复：按发布顺序先发 ${name}（@morphixai/mxenv-core 必须最先），确认 \`npm view ${name}@${range} version\` 有输出后重试。`,
    )
    failed = true
  }
}
process.exit(failed ? 1 : 0)
