import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, statSync, existsSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  writeHostSession,
  readHostSession,
  clearHostSession,
  acquireHostLock,
  releaseHostLock,
  type HostRuntimeSession,
} from '../src/index'

let HOME: string

beforeEach(() => {
  HOME = mkdtempSync(join(tmpdir(), 'mxenv-host-runtime-'))
})

afterEach(() => {
  rmSync(HOME, { recursive: true, force: true })
})

const session = (over: Partial<HostRuntimeSession> = {}): HostRuntimeSession => ({
  port: 41234,
  pid: 4242,
  token: 'test-token-not-a-secret',
  startedAt: '2026-11-09T00:00:00.000Z',
  ...over,
})

describe('host-runtime session file', () => {
  it('writes 0600 runtime.json under a 0700 host dir and reads it back', () => {
    writeHostSession(session(), HOME)

    const dir = join(HOME, '.mxenv', 'host')
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(statSync(join(dir, 'runtime.json')).mode & 0o777).toBe(0o600)
    expect(readHostSession(HOME)).toEqual(session())
  })

  it('overwrites stale files and tolerates missing/corrupt ones', () => {
    writeHostSession(session({ port: 1 }), HOME)
    writeHostSession(session({ port: 2 }), HOME)
    expect(readHostSession(HOME)?.port).toBe(2)

    clearHostSession(HOME)
    expect(readHostSession(HOME)).toBeNull()
    clearHostSession(HOME) // 幂等

    writeHostSession(session(), HOME)
    // 结构不合法（缺 token）视为无效
    const path = join(HOME, '.mxenv', 'host', 'runtime.json')
    writeFileSync(path, '{"port":1,"pid":2}')
    expect(readHostSession(HOME)).toBeNull()
  })

  it('clears the session file on termination (idempotent)', () => {
    writeHostSession(session(), HOME)
    clearHostSession(HOME)
    expect(existsSync(join(HOME, '.mxenv', 'host', 'runtime.json'))).toBe(false)
    expect(readHostSession(HOME)).toBeNull()
  })
})

describe('host start lock (O_EXCL)', () => {
  it('grants one holder and refuses a second acquire until released', () => {
    expect(acquireHostLock(HOME)).toBe(true)
    expect(acquireHostLock(HOME)).toBe(false)

    releaseHostLock(HOME)
    expect(acquireHostLock(HOME)).toBe(true)
    releaseHostLock(HOME)
    releaseHostLock(HOME) // 幂等
  })

  it('keeps lock and session artefacts inside the host dir', () => {
    acquireHostLock(HOME)
    writeHostSession(session(), HOME)
    releaseHostLock(HOME)
    const entries = readdirSync(join(HOME, '.mxenv', 'host')).sort()
    expect(entries).toEqual(['runtime.json'])
  })
})
