import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { startHostSession, hostStatus, type HostRuntime } from '../src/host'
import { clearHostSession, readHostSession, type SourceEntry } from '@morphixai/mxenv-core'

// 临时 HOME + local 假来源（哨兵假值）；in-process 宿主，直接打 127.0.0.1。
let HOME: string
let ROOT: string
let runtime: HostRuntime
let base: string

function value(label: string): string {
  return `mxenv_test_${label}_${randomUUID().replace(/-/g, '')}`
}

function auditEvents(): any[] {
  const dir = join(HOME, '.mxenv', 'audit')
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((f) =>
    readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
  )
}

async function api(path: string, init: { method?: string; body?: unknown; token?: string | null; panel?: boolean } = {}): Promise<{ status: number; body: any; headers: Headers }> {
  const headers: Record<string, string> = {}
  if (init.token !== null) headers.authorization = `Bearer ${init.token ?? runtime.state.token}`
  if (init.panel) headers['x-mxenv-panel'] = '1'
  if (init.body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(`${base}${path}`, { method: init.method || 'GET', headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined })
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers }
}

beforeEach(async () => {
  HOME = mkdtempSync(join(tmpdir(), 'mxenv-host-test-'))
  ROOT = mkdtempSync(join(tmpdir(), 'mxenv-host-src-'))
  writeFileSync(join(ROOT, 'a.env'), `VR_A=${value('a')}\nVR_B=${value('b')}\n`)
  const entries: SourceEntry[] = [
    { name: 'local', source: { provider: 'local', files: ['a.env'], optional: true }, baseDir: ROOT },
  ]
  const started = await startHostSession({ homeDir: HOME, cwd: ROOT, profileName: 'test', entries })
  if (!('runtime' in started)) throw new Error('fresh session expected')
  runtime = started.runtime
  base = `http://127.0.0.1:${(runtime.server.address() as { port: number }).port}`
})

afterEach(async () => {
  await runtime.close()
  rmSync(HOME, { recursive: true, force: true })
  rmSync(ROOT, { recursive: true, force: true })
})

describe('auth and names-only surface', () => {
  it('rejects requests without a valid token and audits without logging the token', async () => {
    const bad = await api('/keys', { token: 'wrong' })
    expect(bad.status).toBe(401)

    const events = auditEvents()
    expect(events.filter((e) => e.reason === 'auth')).toHaveLength(1)
    expect(JSON.stringify(events)).not.toContain(runtime.state.token)
  })

  it('serves keys names-only (values never in the response)', async () => {
    const res = await api('/keys')
    expect(res.status).toBe(200)
    const keys = res.body.keys as Array<{ key: string; status: string }>
    expect(keys.map((k) => k.key).sort()).toEqual(['VR_A', 'VR_B'])
    expect(keys.every((k) => k.status === 'present')).toBe(true)
    expect(JSON.stringify(res.body)).not.toContain('mxenv_test_')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('consumer boundary (reveal/unlock are panel-session only)', () => {
  it('rejects reveal and unlock without the panel marker and audits consumer-boundary', async () => {
    const unlock = await api('/unlock', { method: 'POST' })
    expect(unlock.status).toBe(403)
    const reveal = await api('/reveal', { method: 'POST', body: { key: 'VR_A', source: 'local' } })
    expect(reveal.status).toBe(403)

    const events = auditEvents()
    expect(events.filter((e) => e.reason === 'consumer-boundary')).toHaveLength(2)
    expect(JSON.stringify(events)).not.toContain('mxenv_test_')
  })
})

describe('lock window and reveal via revealSingle', () => {
  it('locks by default, unlocks within a window, and reveals one resident value at a time', async () => {
    const sentinelA = value('reveal-a')
    writeFileSync(join(ROOT, 'a.env'), `VR_A=${sentinelA}\nVR_B=${value('reveal-b')}\n`)

    // 默认锁定
    const locked = await api('/reveal', { method: 'POST', panel: true, body: { key: 'VR_A', source: 'local' } })
    expect(locked.status).toBe(423)

    // 解锁 → 逐键揭示 → 驻留互斥由 core 钉（此处钉值出口与 no-store）
    expect((await api('/unlock', { method: 'POST', panel: true })).status).toBe(200)
    const first = await api('/reveal', { method: 'POST', panel: true, body: { key: 'VR_A', source: 'local' } })
    expect(first.status).toBe(200)
    expect(first.body.value).toBe(sentinelA)
    expect(first.headers.get('cache-control')).toBe('no-store')

    const second = await api('/reveal', { method: 'POST', panel: true, body: { key: 'VR_B', source: 'local' } })
    expect(second.status).toBe(200)
    expect(second.body.key).toBe('VR_B')
  })

  it('locks again when the wall-clock window expires (timer-freezing safe)', async () => {
    expect((await api('/unlock', { method: 'POST', panel: true })).status).toBe(200)
    // 墙钟回拨模拟睡眠过窗：判定基于时间戳而非 setTimeout
    runtime.state.unlockAt = Date.now() - 16 * 60_000
    const expired = await api('/reveal', { method: 'POST', panel: true, body: { key: 'VR_A', source: 'local' } })
    expect(expired.status).toBe(423)
  })

  it('does not let names-only polling extend the idle lock', async () => {
    expect((await api('/unlock', { method: 'POST', panel: true })).status).toBe(200)
    // 显式动作回拨到 6 分钟前（超过 5min 空闲窗）；随后只做 names-only 轮询
    runtime.state.lastActionAt = Date.now() - 6 * 60_000
    runtime.state.unlockAt = Date.now() - 6 * 60_000
    await api('/keys')
    await api('/keys')
    const revealed = await api('/reveal', { method: 'POST', panel: true, body: { key: 'VR_A', source: 'local' } })
    expect(revealed.status).toBe(423) // 轮询不续命，空闲锁已生效
  })
})

describe('audit scope and session lifecycle', () => {
  it('audits exactly unlock+reveal (queries stay silent), value-free', async () => {
    const sentinel = value('audited')
    writeFileSync(join(ROOT, 'a.env'), `VR_A=${sentinel}\n`)
    await api('/keys')
    await api('/keys')
    await api('/unlock', { method: 'POST', panel: true })
    await api('/reveal', { method: 'POST', panel: true, body: { key: 'VR_A', source: 'local' } })
    await api('/keys')

    const events = auditEvents()
    expect(events.map((e) => e.action)).toEqual(['unlock', 'reveal'])
    expect(events.every((e) => e.via === 'host')).toBe(true)
    expect(events.every((e) => typeof e.configPath === 'string')).toBe(true)
    expect(JSON.stringify(events)).not.toContain(sentinel)
  })

  it('shutdown clears runtime file; status reflects lifecycle', async () => {
    expect(hostStatus(HOME).running).toBe(true)
    expect(readHostSession(HOME)?.port).toBe((runtime.server.address() as { port: number }).port)

    const down = await api('/shutdown', { method: 'POST' })
    expect(down.status).toBe(200)
    expect(readHostSession(HOME)).toBeNull()
    expect(hostStatus(HOME).running).toBe(false)
  })

  it('second start attaches instead of spawning a second session', async () => {
    const again = await startHostSession({ homeDir: HOME, cwd: ROOT, entries: [] })
    expect('runtime' in again).toBe(false)
    expect((again as { alreadyRunning: true }).alreadyRunning).toBe(true)
  })
})

describe('shutdown cleanup', () => {
  it('close() clears the runtime file (idempotent)', async () => {
    await runtime.close()
    expect(existsSync(join(HOME, '.mxenv', 'host', 'runtime.json'))).toBe(false)
    clearHostSession(HOME) // 幂等
  })
})
