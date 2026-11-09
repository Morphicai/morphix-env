#!/usr/bin/env node
/**
 * 发布顺序护栏（naming-cutover 4.1）：发布前校验本包 manifest 里声明的
 * `@morphixai/mxenv*` 依赖已在 registry 按语义版本可解析；未发布即拒绝并给按序修复指引。
 * 由各包 prepublishOnly 调起（cwd=包目录）；npm view 用 argv 传递，不拼 shell。
 *
 * 发布链容错（0.14.0 事故 followup）：registry CDN 读副本有复制延迟——前一包刚发布
 * 成功、本包校验时可能仍解析不到（run 42551081396 实锤）。故解析校验带重试预算
 * （默认 30 次 × 10s = 5min，可用 MXENV_GUARD_ATTEMPTS / MXENV_GUARD_INTERVAL_MS
 * 覆盖，供测试与人工兜底）；`npm view` 带 --prefer-online 强制重校元数据，防
 * CLI 缓存叠加假阴性。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const attempts = Math.max(1, Number.parseInt(process.env.MXENV_GUARD_ATTEMPTS ?? '30', 10) || 30)
const intervalMs = Math.max(0, Number.parseInt(process.env.MXENV_GUARD_INTERVAL_MS ?? '10000', 10) || 10000)

const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const deps = { ...(manifest.dependencies || {}), ...(manifest.peerDependencies || {}) }
const gates = Object.entries(deps).filter(([name]) => name.startsWith('@morphixai/mxenv'))

if (gates.length === 0) {
  console.log(`[prepublish-guard] ${manifest.name}@${manifest.version} 无 @morphixai/mxenv* 依赖门槛（发布序列首包）。`)
  process.exit(0)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let failed = false
for (const [name, range] of gates) {
  let resolved = false
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      execFileSync('npm', ['view', `${name}@${range}`, 'version', '--prefer-online'], { stdio: 'pipe' })
      console.log(
        attempt === 1
          ? `[prepublish-guard] ${name}@${range} registry 可解析 ✓`
          : `[prepublish-guard] ${name}@${range} registry 可解析 ✓（第 ${attempt} 次尝试，CDN 读延迟后恢复）`,
      )
      resolved = true
      break
    } catch {
      if (attempt < attempts) await sleep(intervalMs)
    }
  }
  if (!resolved) {
    console.error(
      `[prepublish-guard] 拒绝发布 ${manifest.name}@${manifest.version}：依赖 ${name}@${range} 在 ${attempts} 次尝试（约 ${Math.round((attempts * intervalMs) / 1000)}s）后仍未在 registry 可解析。`,
    )
    console.error(
      `[prepublish-guard] 修复：按发布顺序先发 ${name}（@morphixai/mxenv-core 必须最先），确认 \`npm view ${name}@${range} version --prefer-online\` 有输出后重试。`,
    )
    console.error(
      `[prepublish-guard] 若 ${name} 刚发布成功：多为 registry CDN 读延迟，稍候重跑发布即可——release.yml 发布步对已上线版本自动跳过，链路可续跑。`,
    )
    failed = true
  }
}
process.exit(failed ? 1 : 0)
