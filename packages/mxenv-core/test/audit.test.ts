import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { writeAudit } from '../src/audit'

const HOME = join(tmpdir(), `mxenv-audit-${randomUUID()}`)

afterEach(() => {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true, force: true })
})

describe('audit', () => {
  it('persists names and outcomes without accepting a value field', () => {
    writeAudit({
      timestamp: '2026-09-26T00:00:00.000Z',
      profile: 'api-dev',
      sources: ['team', 'local'],
      keys: ['MXTEST_KEY'],
      outcome: 'success',
      exitCode: 0,
      durationMs: 12,
    }, HOME)

    const content = readFileSync(join(HOME, '.mxenv', 'audit', '2026-09-26.jsonl'), 'utf8')
    expect(content).toContain('MXTEST_KEY')
    expect(content).not.toMatch(/value|secret|token/i)
  })

  it('lands in ~/.mxenv even when only the legacy dir exists (写只落新名, 0.12.1)', () => {
    // 旧目录在场（未迁移）：审计写仍必须落新名，不得回流 ~/.mx-env/audit。
    mkdirSync(join(HOME, '.mx-env'), { recursive: true })
    writeAudit({
      timestamp: '2026-11-07T00:00:00.000Z',
      profile: 'legacy-present',
      sources: ['team'],
      keys: ['MXTEST_KEY'],
      outcome: 'success',
      exitCode: 0,
      durationMs: 1,
    }, HOME)

    expect(existsSync(join(HOME, '.mxenv', 'audit', '2026-11-07.jsonl'))).toBe(true)
    expect(existsSync(join(HOME, '.mx-env', 'audit'))).toBe(false)
  })
})
