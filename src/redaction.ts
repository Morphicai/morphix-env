/**
 * Redacts exact in-memory values while preserving normal stream output. This is
 * deliberately not an exfiltration boundary: a child process can transform a
 * value before printing it. It prevents the common accidental direct echo.
 */
export class StreamingRedactor {
  private readonly values: string[]
  private pending = ''

  constructor(values: string[]) {
    this.values = [...new Set(values.filter(Boolean))].sort((a, b) => b.length - a.length)
  }

  write(chunk: Buffer | string): string {
    if (!this.values.length) return typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    const input = this.pending + (typeof chunk === 'string' ? chunk : chunk.toString('utf8'))
    const keep = this.incompletePrefixLength(input)
    const safe = input.slice(0, input.length - keep)
    this.pending = input.slice(input.length - keep)
    return this.redact(safe)
  }

  flush(): string {
    const output = this.redact(this.pending)
    this.pending = ''
    return output
  }

  private incompletePrefixLength(input: string): number {
    const completeEnd = this.lastCompleteMatchEnd(input)
    const limit = Math.min(input.length, Math.max(...this.values.map((value) => value.length - 1), 0))
    for (let length = limit; length > 0; length--) {
      const suffix = input.slice(-length)
      const start = input.length - length
      if (start >= completeEnd && this.values.some((value) => value.startsWith(suffix))) return length
    }
    return 0
  }

  private redact(input: string): string {
    const marks = new Array(input.length).fill(false)
    for (const value of this.values) {
      let from = 0
      while (from < input.length) {
        const index = input.indexOf(value, from)
        if (index < 0) break
        for (let i = index; i < index + value.length; i++) marks[i] = true
        from = index + 1 // retain overlapping matches
      }
    }

    let output = ''
    let inRedaction = false
    for (let i = 0; i < input.length; i++) {
      if (marks[i]) {
        if (!inRedaction) output += '[REDACTED]'
        inRedaction = true
      } else {
        output += input[i]
        inRedaction = false
      }
    }
    return output
  }

  private lastCompleteMatchEnd(input: string): number {
    let lastEnd = 0
    for (const value of this.values) {
      let from = 0
      while (from < input.length) {
        const index = input.indexOf(value, from)
        if (index < 0) break
        lastEnd = Math.max(lastEnd, index + value.length)
        from = index + 1
      }
    }
    return lastEnd
  }
}
