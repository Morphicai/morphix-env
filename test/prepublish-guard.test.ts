import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 发布链容错（0.14.0 事故 followup）：prepublish-guard 的解析校验带重试预算，
// 吸收 registry CDN 读复制延迟；预算耗尽才拒绝（勿假绿）。
// 测试用 MXENV_GUARD_ATTEMPTS / MXENV_GUARD_INTERVAL_MS 压小重试预算，
// 不依赖"registry 延迟"这一外部时序。

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GUARD = path.join(repoRoot, 'scripts', 'prepublish-guard.mjs')

function runGuard(manifest: object): { status: number; stdout: string; stderr: string } {
  const cwd = mkdtempSync(path.join(tmpdir(), 'mxenv-guard-'))
  writeFileSync(path.join(cwd, 'package.json'), JSON.stringify(manifest))
  try {
    execFileSync(process.execPath, [GUARD], {
      cwd,
      env: {
        ...process.env,
        MXENV_GUARD_ATTEMPTS: '3',
        MXENV_GUARD_INTERVAL_MS: '20',
      },
      stdio: 'pipe',
    })
    return { status: 0, stdout: '', stderr: '' }
  } catch (err) {
    const e = err as { status: number; stdout: Buffer; stderr: Buffer }
    return { status: e.status, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' }
  }
}

describe('prepublish-guard', () => {
  it('无 @morphixai/mxenv* 依赖门槛时放行（发布序列首包）', () => {
    const r = runGuard({ name: 'guard-t-no-gates', version: '0.0.0' })
    expect(r.status).toBe(0)
  })

  it('依赖不可解析时重试预算耗尽后拒绝，报文含修复指引与续跑提示', () => {
    const r = runGuard({
      name: 'guard-t-unresolvable',
      version: '0.0.0',
      dependencies: { '@morphixai/mxenv-core': '^99.99.99' },
    })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('拒绝发布')
    expect(r.stderr).toContain('3 次尝试') // 重试预算真实消耗（非一次即拒）
    expect(r.stderr).toContain('链路可续跑')
  })
})
