import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync, chmodSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { startHostSession, type HostRuntime } from '../src/host'
import type { SourceEntry } from '@morphixai/mxenv-core'

let HOME: string
let ROOT: string
let runtime: HostRuntime
let base: string
let sentinel: string
let savedEnv: Record<string, string | undefined>

async function api(path: string, init: { method?: string; body?: unknown; panel?: boolean } = {}) {
  const headers: Record<string, string> = { authorization: `Bearer ${runtime.state.token}` }
  if (init.panel) headers['x-mxenv-panel'] = '1'
  if (init.body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`${base}${path}`, {
    method: init.method || 'GET', headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  return { status: response.status, body: await response.json() as any, headers: response.headers }
}

function auditEvents(): any[] {
  const dir = join(HOME, '.mxenv', 'audit')
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((file) =>
    readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)),
  )
}

beforeEach(async () => {
  HOME = mkdtempSync(join(tmpdir(), 'mxenv-remote-panel-home-'))
  ROOT = mkdtempSync(join(tmpdir(), 'mxenv-remote-panel-project-'))
  sentinel = `mxenv_test_remote_${randomUUID().replace(/-/g, '')}`
  savedEnv = Object.fromEntries([
    'PATH', 'INFISICAL_CLIENT_ID', 'INFISICAL_CLIENT_SECRET', 'INFISICAL_PROJECT_ID',
    'MXENV_TEST_INFISICAL_EXPORT', 'MXENV_TEST_INFISICAL_FAIL',
  ].map((key) => [key, process.env[key]]))
  const bin = join(HOME, 'bin')
  mkdirSync(bin)
  const executable = join(bin, 'infisical')
  writeFileSync(executable, `#!/usr/bin/env node
if (process.argv.includes('--version') || process.argv[2] === 'user') process.exit(0)
if (process.argv[2] === 'export') {
  if (process.env.MXENV_TEST_INFISICAL_FAIL) {
    process.stderr.write('fake upstream unavailable')
    process.exit(1)
  }
  process.stdout.write(process.env.MXENV_TEST_INFISICAL_EXPORT || '')
  process.exit(0)
}
process.exit(1)
`, { mode: 0o700 })
  chmodSync(executable, 0o700)
  process.env.PATH = `${bin}:${process.env.PATH || ''}`
  delete process.env.INFISICAL_CLIENT_ID
  delete process.env.INFISICAL_CLIENT_SECRET
  delete process.env.INFISICAL_PROJECT_ID
  delete process.env.MXENV_TEST_INFISICAL_FAIL
  process.env.MXENV_TEST_INFISICAL_EXPORT = `REMOTE_ONLY=${sentinel}\nSHARED_REMOTE=mxenv_test_shared_${randomUUID()}\n`
  writeFileSync(join(ROOT, 'local.env'), 'LOCAL_ONLY=mxenv_test_local\n')
  const entries: SourceEntry[] = [
    { name: 'remote', source: { provider: 'infisical', paths: ['/ai'], env: 'dev' }, baseDir: ROOT },
    { name: 'local', source: { provider: 'local', files: ['local.env'] }, baseDir: ROOT },
  ]
  const started = await startHostSession({ homeDir: HOME, cwd: ROOT, profileName: 'default', entries })
  if (!('runtime' in started)) throw new Error('fresh session expected')
  runtime = started.runtime
  base = `http://127.0.0.1:${(runtime.server.address() as { port: number }).port}`
})

afterEach(async () => {
  await runtime.close()
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(HOME, { recursive: true, force: true })
  rmSync(ROOT, { recursive: true, force: true })
})

describe('remote provider key names and reveal', () => {
  it('enumerates Infisical names with provider metadata and no values', async () => {
    const response = await api('/keys')
    expect(response.status).toBe(200)
    expect(response.body.keys).toEqual(expect.arrayContaining([
      { key: 'REMOTE_ONLY', source: 'remote', provider: 'infisical', status: 'present' },
      { key: 'SHARED_REMOTE', source: 'remote', provider: 'infisical', status: 'present' },
      { key: 'LOCAL_ONLY', source: 'local', provider: 'local', status: 'present' },
    ]))
    expect(JSON.stringify(response.body)).not.toContain(sentinel)
    expect(JSON.stringify(response.body)).not.toContain('mxenv_test_local')
  })

  it('reveals one remote value only after unlock, audits without values, and never enables remote writes', async () => {
    expect((await api('/reveal', {
      method: 'POST', panel: true, body: { key: 'REMOTE_ONLY', source: 'remote' },
    })).status).toBe(423)
    await api('/unlock', { method: 'POST', panel: true })
    const revealed = await api('/reveal', {
      method: 'POST', panel: true, body: { key: 'REMOTE_ONLY', source: 'remote' },
    })
    expect(revealed.status).toBe(200)
    expect(revealed.body).toMatchObject({ key: 'REMOTE_ONLY', source: 'remote', value: sentinel })
    expect(revealed.headers.get('cache-control')).toBe('no-store')
    expect((await api('/set', {
      method: 'POST', panel: true, body: { key: 'REMOTE_ONLY', source: 'remote', value: 'must-not-write' },
    })).status).toBe(400)
    expect((await api('/delete', {
      method: 'POST', panel: true, body: { key: 'REMOTE_ONLY', source: 'remote' },
    })).status).toBe(400)
    const reveal = auditEvents().find((event) => event.action === 'reveal' && event.outcome === 'success')
    expect(reveal).toMatchObject({ sources: ['remote'], keys: ['REMOTE_ONLY'], via: 'host' })
    expect(JSON.stringify(auditEvents())).not.toContain(sentinel)
  })

  it('isolates an unavailable remote source without hiding local keys', async () => {
    process.env.MXENV_TEST_INFISICAL_FAIL = '1'
    const keys = await api('/keys')
    expect(keys.status).toBe(200)
    expect(keys.body.keys.map((row: any) => row.key)).toEqual(['LOCAL_ONLY'])
    expect(JSON.stringify(keys.body)).not.toContain(sentinel)
    const wiring = await api('/wiring')
    expect(wiring.body.sources.find((source: any) => source.name === 'remote')).toMatchObject({ provider: 'infisical', status: 'error', keyCount: 0 })
    expect(wiring.body.sources.find((source: any) => source.name === 'local')).toMatchObject({ provider: 'local', status: 'loaded', keyCount: 1 })
  })
})
