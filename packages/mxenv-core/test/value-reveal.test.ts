import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import {
  readStoredValueFromSource,
  readStoredValue,
  revealSingle,
  RevealError,
  __residentSlotCountForTests,
  __setKeytarLoaderForTests,
  type SourceEntry,
} from '../src/index'

vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  execFileSync: vi.fn(() => {
    throw Object.assign(new Error('decrypt blew up with sentinel-inside-error'), { code: 'ESECRET' })
  }),
}))

const ROOT = mkdtempSync(join(tmpdir(), 'mxenv-value-reveal-'))
const value = (label: string) => `mxenv_test_${label}_${randomUUID().replace(/-/g, '')}`

function entry(name: string, source: SourceEntry['source'], baseDir = ROOT): SourceEntry {
  return { name, source, baseDir }
}

function localEntry(name: string, file: string): SourceEntry {
  return entry(name, { provider: 'local', files: [file], optional: true })
}

beforeEach(() => {
  mkdirSync(ROOT, { recursive: true })
})

afterEach(() => {
  vi.useRealTimers()
})

// ─── 1.1 单键存储值读取 ─────────────────────────────────────────

describe('readStoredValueFromSource / readStoredValue', () => {
  it('returns the stored value even when the outer environment carries a different same-name value', async () => {
    const sentinel = value('stored')
    writeFileSync(join(ROOT, 'a.env'), `VR_KEY_A=${sentinel}\n`)
    process.env.VR_KEY_A = value('outer')

    const found = await readStoredValueFromSource(localEntry('a', 'a.env'), 'VR_KEY_A')

    expect(found?.value).toBe(sentinel)
    expect(found?.source).toBe('a')
    expect(found?.provider).toBe('local')
  })

  it('returns null for a key the source does not hold', async () => {
    writeFileSync(join(ROOT, 'b.env'), `VR_OTHER=${value('x')}\n`)
    expect(await readStoredValueFromSource(localEntry('b', 'b.env'), 'VR_MISSING')).toBeNull()
  })

  it('resolves the winning source (later entry wins), matching compose precedence', async () => {
    const first = value('first')
    const winner = value('winner')
    writeFileSync(join(ROOT, 'c1.env'), `VR_WIN=${first}\n`)
    writeFileSync(join(ROOT, 'c2.env'), `VR_WIN=${winner}\n`)

    const found = await readStoredValue('VR_WIN', [localEntry('c1', 'c1.env'), localEntry('c2', 'c2.env')])

    expect(found?.value).toBe(winner)
    expect(found?.source).toBe('c2')
  })
})

// ─── 1.2 revealSingle：授权校验 / 键定位 / 单值驻留 ───────────────

describe('revealSingle', () => {
  it('rejects in the default locked state (no authorization context)', async () => {
    const sentinel = value('locked')
    writeFileSync(join(ROOT, 'd.env'), `VR_LOCK=${sentinel}\n`)

    await expect(revealSingle({ key: 'VR_LOCK', entry: localEntry('d', 'd.env'), subject: 'editor', slotId: 's-lock' }))
      .rejects.toMatchObject({ name: 'RevealError', code: 'locked' })
  })

  it('reveals one stored value under an authorized context and releases idempotently', async () => {
    const sentinel = value('reveal')
    writeFileSync(join(ROOT, 'e.env'), `VR_ONE=${sentinel}\n`)

    const result = await revealSingle({ key: 'VR_ONE', entry: localEntry('e', 'e.env'), subject: 'editor', slotId: 's-one', authorized: true })

    expect(result.value).toBe(sentinel)
    expect(result.source).toBe('e')
    result.release()
    result.release() // 幂等
  })

  it('keeps one resident value per slot: revealing a new key evicts the previous resident', async () => {
    writeFileSync(join(ROOT, 'f.env'), `VR_A=${value('a')}\nVR_B=${value('b')}\n`)
    const e = localEntry('f', 'f.env')

    const first = await revealSingle({ key: 'VR_A', entry: e, subject: 'editor', slotId: 's-mux', authorized: true })
    expect(__residentSlotCountForTests()).toBe(1)

    const second = await revealSingle({ key: 'VR_B', entry: e, subject: 'editor', slotId: 's-mux', authorized: true })
    expect(__residentSlotCountForTests()).toBe(1) // 同槽换值：旧驻留被清

    // 旧 release 闭包不得误清新驻留
    first.release()
    expect(__residentSlotCountForTests()).toBe(1)

    second.release()
    expect(__residentSlotCountForTests()).toBe(0)
  })

  it('auto-evicts the resident value after the residence TTL', async () => {
    vi.useFakeTimers()
    writeFileSync(join(ROOT, 'g.env'), `VR_TTL=${value('ttl')}\n`)

    await revealSingle({ key: 'VR_TTL', entry: localEntry('g', 'g.env'), subject: 'cli', slotId: 's-ttl', authorized: true })
    expect(__residentSlotCountForTests()).toBe(1)

    vi.advanceTimersByTime(5 * 60_000 + 1)
    expect(__residentSlotCountForTests()).toBe(0)
  })

  it('throws not-found (without any value) when the key has no stored value', async () => {
    writeFileSync(join(ROOT, 'h.env'), `VR_HAVE=${value('have')}\n`)

    await expect(revealSingle({ key: 'VR_NOPE', entry: localEntry('h', 'h.env'), subject: 'editor', slotId: 's-nf', authorized: true }))
      .rejects.toMatchObject({ name: 'RevealError', code: 'not-found' })
  })
})

// ─── 1.3 值无关审计（成功/拒绝/失败三路记账） ────────────────────

describe('reveal audit', () => {
  function auditLines(homeDir: string): any[] {
    const dir = join(homeDir, '.mxenv', 'audit')
    if (!existsSync(dir)) return []
    return readdirSync(dir).flatMap((f) =>
      readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    )
  }

  it('records value-free reveal events for success, locked and not-found outcomes', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'mxenv-reveal-audit-'))
    const sentinel = value('audited')
    writeFileSync(join(ROOT, 'i.env'), `VR_AUD=${sentinel}\n`)
    const e = localEntry('i', 'i.env')
    const opts = { homeDir }

    const ok = await revealSingle({ key: 'VR_AUD', entry: e, subject: 'editor', slotId: 's-a1', authorized: true, profileName: 'test-profile', options: opts })
    ok.release()
    await revealSingle({ key: 'VR_AUD', entry: e, subject: 'editor', slotId: 's-a2', options: opts }).catch(() => undefined)
    await revealSingle({ key: 'VR_GONE', entry: e, subject: 'cli', slotId: 's-a3', authorized: true, options: opts }).catch(() => undefined)

    const events = auditLines(homeDir)
    expect(events).toHaveLength(3)
    expect(events.map((ev) => ev.outcome)).toEqual(['success', 'failure', 'failure'])
    expect(events.every((ev) => ev.action === 'reveal')).toBe(true)
    expect(events[0].keys).toEqual(['VR_AUD'])
    expect(events[0].profile).toBe('test-profile')
    // 红线：审计文本永不含值
    const raw = JSON.stringify(events)
    expect(raw).not.toContain(sentinel)
    rmSync(homeDir, { recursive: true, force: true })
  })

  it('records via: host for panel-host sessions (locked and success)', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'mxenv-reveal-hostvia-'))
    const sentinel = value('hostvia')
    writeFileSync(join(ROOT, 'k.env'), `VR_HOST=${sentinel}\n`)
    const e = localEntry('k', 'k.env')
    const opts = { homeDir }

    const ok = await revealSingle({ key: 'VR_HOST', entry: e, subject: 'host', slotId: 's-h1', authorized: true, options: opts })
    ok.release()
    await revealSingle({ key: 'VR_HOST', entry: e, subject: 'host', slotId: 's-h2', options: opts }).catch(() => undefined)

    const events = auditLines(homeDir)
    expect(events.map((ev) => ev.via)).toEqual(['host', 'host'])
    expect(events.map((ev) => ev.outcome)).toEqual(['success', 'failure'])
    expect(events.every((ev) => ev.configPath === '-')).toBe(true) // 无配置口径='-'，非幻影路径
    expect(JSON.stringify(events)).not.toContain(sentinel)
    rmSync(homeDir, { recursive: true, force: true })
  })
})

// ─── 1.4 暴露面红线：错误信息不含值 ─────────────────────────────

describe('exposure red lines', () => {
  it('never puts values into error messages', async () => {
    const sentinel = value('secretive')
    writeFileSync(join(ROOT, 'j.env'), `VR_ERR=${sentinel}\n`)
    const e = localEntry('j', 'j.env')

    const locked = await revealSingle({ key: 'VR_ERR', entry: e, subject: 'editor', slotId: 's-e1' }).catch((err: Error) => err)
    const missing = await revealSingle({ key: 'VR_ERR_X', entry: e, subject: 'editor', slotId: 's-e2', authorized: true }).catch((err: Error) => err)

    expect(locked).toBeInstanceOf(RevealError)
    expect(missing).toBeInstanceOf(RevealError)
    expect((locked as Error).message).not.toContain(sentinel)
    expect((missing as Error).message).not.toContain(sentinel)
  })
})

// ─── 修复验证：文件作用域 / 读取失败审计 / console 静默 ─────────

describe('file scope and read-failure paths', () => {
  it('scopes reveal to the file under fileIndex when a source holds multiple files', async () => {
    const v0 = value('file0')
    const v1 = value('file1')
    writeFileSync(join(ROOT, 'm0.env'), `VR_MULTI=${v0}\n`)
    writeFileSync(join(ROOT, 'm1.env'), `VR_MULTI=${v1}\n`)
    const e = entry('multi', { provider: 'local', files: ['m0.env', 'm1.env'], optional: true })

    const r0 = await revealSingle({ key: 'VR_MULTI', entry: e, fileIndex: 0, subject: 'editor', slotId: 's-f0', authorized: true })
    const r1 = await revealSingle({ key: 'VR_MULTI', entry: e, fileIndex: 1, subject: 'editor', slotId: 's-f1', authorized: true })

    expect(r0.value).toBe(v0)
    expect(r1.value).toBe(v1)
    r0.release()
    r1.release()
  })

  it('audits read errors as value-free failure with reason read-error, and rethrows with an audited mark', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'mxenv-reveal-readerr-'))
    // 文件存在且带加密形态标记：走到 dotenvx 解密（execFileSync mock 抛错）
    writeFileSync(join(ROOT, 'never-mind.env'), 'DOTENV_PUBLIC_KEY=0xdeadbeef\nVR_X=encrypted:deadbeef\n')
    const e = entry('broken', { provider: 'dotenvx', files: ['never-mind.env'], optional: true })

    const error = await revealSingle({ key: 'VR_X', entry: e, subject: 'editor', slotId: 's-re', authorized: true, options: { homeDir } })
      .catch((err: Error & { audited?: boolean }) => err)

    expect((error as Error).message).not.toContain('sentinel-inside-error')
    expect((error as { audited?: boolean }).audited).toBe(true)
    const dir = join(homeDir, '.mxenv', 'audit')
    const lines = readdirSync(dir).flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean))
    expect(lines).toHaveLength(1)
    const event = JSON.parse(lines[0])
    expect(event.action).toBe('reveal')
    expect(event.outcome).toBe('failure')
    expect(event.reason).toBe('read-error')
    expect(lines[0]).not.toContain('sentinel-inside-error')
    rmSync(homeDir, { recursive: true, force: true })
  })

  it('never prints to stdout/stderr during reveal', async () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) => vi.spyOn(console, m as 'log'))
    writeFileSync(join(ROOT, 'quiet.env'), `VR_QUIET=${value('quiet')}\n`)
    const e = localEntry('quiet', 'quiet.env')

    const r = await revealSingle({ key: 'VR_QUIET', entry: e, subject: 'cli', slotId: 's-q', authorized: true })
    r.release()
    await revealSingle({ key: 'VR_QUIET', entry: e, subject: 'cli', slotId: 's-q' }).catch(() => undefined)

    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    spies.forEach((s) => s.mockRestore())
  })
})

// ─── keychain 平台守卫 vs 测试替身（CI Linux 回归钉） ─────────────
// PR #25 把编辑器 keychain 揭示收敛到 revealSingle 后，揭示首次经过
// resolveKeychain 的"仅 macOS"守卫——Linux CI 上被拦（本地 macOS 看不见）。
// 语义钉死：测试替身接管通道（非 null loader）时守卫放行；无替身时守卫照拦。

describe('keychain platform guard vs test double', () => {
  const kcEntry: SourceEntry = { name: 'kc', source: { provider: 'os-keychain', platform: 'macos', service: 'mxenv-test-svc' }, baseDir: ROOT }

  async function revealUnderPlatform(platform: string): Promise<Error | { value: string }> {
    const real = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: platform })
    try {
      return await revealSingle({ key: 'KC_GUARD', entry: kcEntry, subject: 'editor', slotId: 's-kc', authorized: true })
        .catch((err: Error) => err)
    } finally {
      if (real) Object.defineProperty(process, 'platform', real)
    }
  }

  afterEach(() => {
    __setKeytarLoaderForTests(null)
  })

  it('lets a test double reveal through the guard on a non-darwin platform', async () => {
    const sentinel = value('kc-double')
    __setKeytarLoaderForTests(async () => ({
      findCredentials: async () => [{ account: 'KC_GUARD', password: sentinel }],
      setPassword: async () => undefined,
      deletePassword: async () => true,
    } as never))

    const result = await revealUnderPlatform('linux')

    expect((result as { value?: string }).value).toBe(sentinel)
    ;(result as { release?: () => void }).release?.()
  })

  it('still blocks keychain reveal on a non-darwin platform without a test double', async () => {
    __setKeytarLoaderForTests(null)

    const result = await revealUnderPlatform('linux')

    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain('macOS')
  })
})
