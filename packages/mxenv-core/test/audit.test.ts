import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { writeAudit } from '../src/audit'

const HOME = join(tmpdir(), `mx-env-audit-${randomUUID()}`)

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

    const content = readFileSync(join(HOME, '.mx-env', 'audit', '2026-09-26.jsonl'), 'utf8')
    expect(content).toContain('MXTEST_KEY')
    expect(content).not.toMatch(/value|secret|token/i)
  })
})
