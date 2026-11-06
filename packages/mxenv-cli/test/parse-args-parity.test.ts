import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Wave A 两包各有 bin，parseArgs 保持双份拷贝（D6 折衷；统一入口归 Wave B）。
// 源码级 parity：提取两处函数体、归一化（去注释/空白）后必须逐字节一致——
// 否则同一 flag 一 face 静默接受、另一 face 落 unknownFlags 报错，静默漂移。

function extractFn(path: string, name: string): string {
  const src = readFileSync(path, 'utf8')
  const start = src.indexOf(`function ${name}(`)
  expect(start, `${name} 未在 ${path} 找到`).toBeGreaterThanOrEqual(0)
  // parseArgs 函数体内无字符串内花括号/正则，朴素括号配平安全（已核对）。
  let i = src.indexOf('{', start)
  let depth = 0
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) break
    }
  }
  return src.slice(start, i + 1)
}

function normalize(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

describe('parseArgs parity（L2/L3 双份拷贝）', () => {
  it('mxenv 与 mxenv-cli 的 parseArgs 函数体归一化后逐字节一致', () => {
    const l2 = normalize(extractFn(join(__dirname, '..', '..', 'mxenv', 'src', 'cli.ts'), 'parseArgs'))
    const l3 = normalize(extractFn(join(__dirname, '..', 'src', 'cli.ts'), 'parseArgs'))
    expect(l3).toBe(l2)
    // 防提取失手拿到残片也判绿。
    expect(l2.length).toBeGreaterThan(500)
  })
})
