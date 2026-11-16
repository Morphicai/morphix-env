import { describe, expect, it } from 'vitest'
import { randomUUID } from 'crypto'
import { StreamingRedactor } from '../src/redaction'

const value = () => `mxenv_test_redaction_${randomUUID().replace(/-/g, '')}`

describe('StreamingRedactor', () => {
  it('redacts an exact value within one output chunk', () => {
    const secret = value()
    const redactor = new StreamingRedactor([secret])
    expect(redactor.write(`before ${secret} after`)).toBe('before [REDACTED] after')
  })

  it('redacts an exact value split across output chunks', () => {
    const secret = value()
    const redactor = new StreamingRedactor([secret])
    const split = Math.floor(secret.length / 2)
    const output = redactor.write(`before ${secret.slice(0, split)}`)
      + redactor.write(`${secret.slice(split)} after`)
      + redactor.flush()
    expect(output).toBe('before [REDACTED] after')
    expect(output).not.toContain(secret)
  })

  it('does not leak a completed value that ends with one of its own prefixes', () => {
    const secret = 'ababa'
    const redactor = new StreamingRedactor([secret])
    const output = redactor.write(secret) + redactor.flush()
    expect(output).toBe('[REDACTED]')
  })

  it('preserves unrelated output', () => {
    const redactor = new StreamingRedactor([value()])
    expect(redactor.write('ordinary diagnostic\n') + redactor.flush()).toBe('ordinary diagnostic\n')
  })

  it('exempts 1–2 char values: a "1" secret must not scrub every digit (issue #31)', () => {
    const redactor = new StreamingRedactor(['1', 'ab', 'probe-secret-value'])
    expect(redactor.write('probe-111-ab-2026 ok probe-secret-value end') + redactor.flush())
      .toBe('probe-111-ab-2026 ok [REDACTED] end')
  })

  it('still redacts 3-char values (the floor, not a heuristic)', () => {
    const redactor = new StreamingRedactor(['xyz'])
    expect(redactor.write('a xyz b') + redactor.flush()).toBe('a [REDACTED] b')
  })

  it('exempt short values cause no cross-chunk holdback', () => {
    const redactor = new StreamingRedactor(['ab'])
    const output = redactor.write('1a') + redactor.write('b2') + redactor.flush()
    expect(output).toBe('1ab2')
  })
})
