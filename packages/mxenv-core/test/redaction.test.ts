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
})
