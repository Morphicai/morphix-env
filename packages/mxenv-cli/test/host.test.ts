import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, chmodSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { startHostSession, hostStatus, type HostRuntime } from '../src/host'
import { clearHostSession, readHostSession, registerProject, type SourceEntry } from '@morphixai/mxenv-core'
import { panelBundleHash, panelCss, panelJs, panelJsIntegrity } from '../src/panel-ui/generated/clientAssets'

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
    expect(keys.every((k: any) => k.provider === 'local')).toBe(true)
    expect(JSON.stringify(res.body)).not.toContain('mxenv_test_')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('multi-scope names-only reads', () => {
  function registerCurrentProject(): string {
    writeFileSync(join(ROOT, 'mxenv.config.json'), JSON.stringify({
      sources: { local: { provider: 'local', files: ['project.env'] } },
      profiles: { default: ['local'] },
      defaultProfile: 'default',
    }))
    registerProject(ROOT, HOME)
    return ROOT.split('/').pop() as string
  }

  it('lists global plus registered projects, without values', async () => {
    const name = registerCurrentProject()
    const res = await api('/scopes')
    expect(res.status).toBe(200)
    expect(res.body.scopes.map((s: any) => s.id)).toEqual(['global', `project:${name}`])
    expect(res.body.remotes).toEqual([])
    expect(JSON.stringify(res.body)).not.toContain('mxenv_test_')
  })

  it('isolates global and project key lists and rejects arbitrary/unregistered scopes', async () => {
    const name = registerCurrentProject()
    const projectValue = value('project-scope')
    writeFileSync(join(ROOT, 'project.env'), `PROJECT_ONLY=${projectValue}\n`)
    mkdirSync(join(HOME, '.mxenv'), { recursive: true })
    writeFileSync(join(HOME, '.mxenv', '.env'), `GLOBAL_ONLY=${value('global-scope')}\n`, { mode: 0o600 })
    chmodSync(join(HOME, '.mxenv', '.env'), 0o600)

    const global = await api('/keys?scope=global')
    expect(global.status).toBe(200)
    expect(global.body.keys.map((k: any) => k.key)).toEqual(['GLOBAL_ONLY'])
    expect(global.body.profile).toBe('legacy')

    const project = await api(`/keys?scope=project:${encodeURIComponent(name)}`)
    expect(project.status).toBe(200)
    // 项目范围反映真实组合：全局基线 + 项目来源，但不混入会话默认来源 VR_A/VR_B。
    expect(project.body.keys.map((k: any) => k.key)).toEqual(['GLOBAL_ONLY', 'PROJECT_ONLY'])
    expect(project.body.keys.find((k: any) => k.key === 'GLOBAL_ONLY')).toMatchObject({ provider: 'local', inherited: true })
    expect(project.body.keys.find((k: any) => k.key === 'PROJECT_ONLY')).toMatchObject({ provider: 'local' })
    expect(project.body.keys.find((k: any) => k.key === 'PROJECT_ONLY').inherited).toBeUndefined()
    expect(project.body.profile).toBe('default')
    expect(JSON.stringify(project.body)).not.toContain(projectValue)

    expect((await api('/keys?scope=project:unregistered')).status).toBe(404)
    expect((await api(`/keys?scope=${encodeURIComponent(ROOT)}`)).status).toBe(404)
  })

  it('reports provider wiring and health as names/status only', async () => {
    const name = registerCurrentProject()
    const sentinel = value('wiring')
    writeFileSync(join(ROOT, 'project.env'), `PROJECT_ONLY=${sentinel}\n`)
    mkdirSync(join(HOME, '.mxenv'), { recursive: true })
    writeFileSync(join(HOME, '.mxenv', '.env'), `GLOBAL_ONLY=${value('wiring-global')}\n`, { mode: 0o600 })
    chmodSync(join(HOME, '.mxenv', '.env'), 0o600)

    const project = await api(`/wiring?scope=project:${encodeURIComponent(name)}`)
    expect(project.status).toBe(200)
    expect(project.body.sources).toHaveLength(2) // 全局基线 + 项目 local
    expect(project.body.sources[1]).toMatchObject({
      name: 'local', provider: 'local', status: 'loaded', keyCount: 1, order: 1,
      details: { files: [{ file: 'project.env', exists: true, encrypted: false }] },
    })
    expect(JSON.stringify(project.body)).not.toContain(sentinel)

    const global = await api('/wiring?scope=global')
    expect(global.body.sources).toHaveLength(1) // 同一个 .env 不得作为项目 legacy 尾重复出现
    expect(global.body.sources[0].name).toBe('__mx_global_dotenv')
    expect((await api('/wiring?scope=project:nope')).status).toBe(404)
  })

  it('scopes reveal and its audit to the selected registered project', async () => {
    const name = registerCurrentProject()
    const sentinel = value('scoped-reveal')
    writeFileSync(join(ROOT, 'project.env'), `PROJECT_ONLY=${sentinel}\n`)
    expect((await api('/unlock', { method: 'POST', panel: true })).status).toBe(200)

    const revealed = await api('/reveal', {
      method: 'POST', panel: true,
      body: { key: 'PROJECT_ONLY', source: 'local', scope: `project:${name}` },
    })
    expect(revealed.status).toBe(200)
    expect(revealed.body.value).toBe(sentinel)
    expect(revealed.headers.get('cache-control')).toBe('no-store')

    // 同一个源名不能跨 scope 偷读：全局范围里没有这个声明。
    const wrongScope = await api('/reveal', {
      method: 'POST', panel: true,
      body: { key: 'PROJECT_ONLY', source: 'local', scope: 'global' },
    })
    expect(wrongScope.status).toBe(404)
    const revealEvent = auditEvents().find((e) => e.action === 'reveal' && e.outcome === 'success')
    expect(revealEvent.profile).toBe('default')
    expect(revealEvent.configPath).toBe(join(ROOT, 'mxenv.config.json'))
    expect(JSON.stringify(auditEvents())).not.toContain(sentinel)
  })
})

describe('scoped set/delete writes', () => {
  it('requires both the panel marker and an active unlock window', async () => {
    const original = readFileSync(join(ROOT, 'a.env'), 'utf8')
    const locked = await api('/set', {
      method: 'POST', panel: true,
      body: { key: 'VR_A', value: value('locked-write'), source: 'local' },
    })
    expect(locked.status).toBe(423)
    const machine = await api('/set', {
      method: 'POST',
      body: { key: 'VR_A', value: value('machine-write'), source: 'local', scope: 'global' },
    })
    expect(machine.status).toBe(403)
    expect(readFileSync(join(ROOT, 'a.env'), 'utf8')).toBe(original)
    expect(auditEvents().some((e) => e.reason === 'consumer-boundary')).toBe(true)
    expect(auditEvents().some((e) => e.reason === 'locked')).toBe(true)
  })

  it('sets and deletes local keys without returning or auditing values', async () => {
    const sentinel = value('panel-set')
    expect((await api('/unlock', { method: 'POST', panel: true })).status).toBe(200)
    const before = runtime.state.lastActionAt
    const set = await api('/set', {
      method: 'POST', panel: true,
      body: { key: 'VR_A', value: sentinel, source: 'local', fileIndex: 0 },
    })
    expect(set.status).toBe(200)
    expect(set.body).toEqual({ action: 'set', key: 'VR_A', source: 'local', provider: 'local', fileIndex: 0 })
    expect(JSON.stringify(set.body)).not.toContain(sentinel)
    expect(runtime.state.lastActionAt).toBeGreaterThanOrEqual(before)
    expect(readFileSync(join(ROOT, 'a.env'), 'utf8')).toContain(`VR_A=${JSON.stringify(sentinel)}`)

    const added = await api('/set', {
      method: 'POST', panel: true,
      body: { key: 'VR_C', value: value('panel-add'), source: 'local' },
    })
    expect(added.status).toBe(200)
    expect((await api('/keys')).body.keys.map((k: any) => k.key)).toContain('VR_C')

    const deleted = await api('/delete', {
      method: 'POST', panel: true,
      body: { key: 'VR_B', source: 'local' },
    })
    expect(deleted.status).toBe(200)
    expect(deleted.body.action).toBe('delete')
    expect(readFileSync(join(ROOT, 'a.env'), 'utf8')).not.toContain('VR_B=')
    const events = auditEvents().filter((e) => e.action === 'set' || e.action === 'delete')
    expect(events).toHaveLength(3)
    expect(events.every((e) => e.via === 'host' && e.outcome === 'success')).toBe(true)
    expect(JSON.stringify(events)).not.toContain('mxenv_test_')
  })

  it('writes only inside the selected project scope', async () => {
    writeFileSync(join(ROOT, 'mxenv.config.json'), JSON.stringify({
      sources: { local: { provider: 'local', files: ['project.env'] } },
      profiles: { default: ['local'] }, defaultProfile: 'default',
    }))
    registerProject(ROOT, HOME)
    const name = ROOT.split('/').pop() as string
    const projectSentinel = value('project-write')
    const globalSentinel = value('global-write')
    await api('/unlock', { method: 'POST', panel: true })
    const scoped = await api('/set', {
      method: 'POST', panel: true,
      body: { key: 'SCOPED', value: projectSentinel, source: 'local', scope: `project:${name}` },
    })
    expect(scoped.status).toBe(200)
    expect(readFileSync(join(ROOT, 'project.env'), 'utf8')).toContain(`SCOPED=${JSON.stringify(projectSentinel)}`)
    expect(readFileSync(join(ROOT, 'a.env'), 'utf8')).not.toContain('SCOPED=')
    expect((await api('/set', {
      method: 'POST', panel: true,
      body: { key: 'SCOPED', value: globalSentinel, source: 'local', scope: 'project:missing' },
    })).status).toBe(404)
    const event = auditEvents().find((e) => e.action === 'set' && e.outcome === 'success')
    expect(event.configPath).toBe(join(ROOT, 'mxenv.config.json'))
    expect(JSON.stringify(auditEvents())).not.toContain(projectSentinel)
  })

  it('fails closed for remote providers and invalid requests', async () => {
    runtime.entries.push({ name: 'remote', source: { provider: 'infisical', paths: ['/'], env: 'dev' }, baseDir: ROOT })
    await api('/unlock', { method: 'POST', panel: true })
    const remote = await api('/set', {
      method: 'POST', panel: true,
      body: { key: 'REMOTE', value: value('remote-write'), source: 'remote' },
    })
    expect(remote.status).toBe(400)
    expect(remote.body.code).toBe('unsupported-provider')
    expect((await api('/set', {
      method: 'POST', panel: true,
      body: { key: 'VR_A', value: value('bad-index'), source: 'local', fileIndex: 99 },
    })).status).toBe(400)
    const res = await fetch(`${base}/set`, {
      method: 'POST', headers: { authorization: `Bearer ${runtime.state.token}`, 'x-mxenv-panel': '1', 'content-type': 'application/json' }, body: '{',
    })
    expect(res.status).toBe(400)
    expect(auditEvents().some((e) => e.reason === 'invalid-request')).toBe(true)
  })
})

describe('panel page (token-in-path)', () => {
  it('serves the panel HTML at the session token path without a Bearer header', async () => {
    const res = await fetch(`${base}/${runtime.state.token}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const html = await res.text()
    expect(html).toContain('mxenv') // 品牌 wordmark
    expect(html).toContain('id="root"') // React 挂载点
    expect(html).toContain(`panel-${panelBundleHash}.js`)
    expect(html).toContain(`panel-${panelBundleHash}.css`)
    expect(html).toContain(`integrity="${panelJsIntegrity}"`)
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self'")
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(html).not.toContain(runtime.state.token) // token 不内嵌页面（取自 URL）
    expect(html).not.toContain('VR_A') // 初始 HTML 不序列化键名
  })

  it('serves only the current hashed React assets inside the session path', async () => {
    const js = await fetch(`${base}/${runtime.state.token}/panel-${panelBundleHash}.js`)
    expect(js.status).toBe(200)
    expect(js.headers.get('content-type')).toContain('text/javascript')
    expect(js.headers.get('cache-control')).toBe('private, max-age=3600')
    const jsBody = await js.text()
    expect(jsBody).toBe(panelJs)
    expect(jsBody).toContain('/scopes')
    expect(jsBody).toContain('/wiring')
    expect(jsBody).toContain('/set')
    expect(jsBody).toContain('/delete')
    expect(jsBody).not.toContain(runtime.state.token)

    const css = await fetch(`${base}/${runtime.state.token}/panel-${panelBundleHash}.css`)
    expect(css.status).toBe(200)
    expect(css.headers.get('content-type')).toContain('text/css')
    expect(await css.text()).toBe(panelCss)

    expect((await fetch(`${base}/${runtime.state.token}/panel-000000000000000000000000.js`)).status).toBe(404)
    expect((await fetch(`${base}/wrong-token/panel-${panelBundleHash}.js`)).status).toBe(404)
    expect((await fetch(`${base}/${runtime.state.token}/panel-${panelBundleHash}.js`, { method: 'POST' })).status).toBe(401)
  })

  it('serves the same page with a trailing slash', async () => {
    const redirect = await fetch(`${base}/${runtime.state.token}`, { redirect: 'manual' })
    expect(redirect.status).toBe(308)
    expect(redirect.headers.get('location')).toBe(`/${runtime.state.token}/`)
    const res = await fetch(`${base}/${runtime.state.token}/`)
    expect(res.status).toBe(200)
  })

  it('a wrong token path is indistinguishable from a missing page (404)', async () => {
    const res = await fetch(`${base}/not-the-token`)
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ error: 'not found' })
  })

  it('bare / serves the static landing page with no session info', async () => {
    const res = await fetch(`${base}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain('mxenv gui') // 指路命令
    expect(html).not.toContain(runtime.state.token) // 不泄露当前 token
    expect(html).not.toContain('VR_A') // 不泄露键名
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
    expect(events.map((e) => e.action)).toEqual(['start', 'unlock', 'reveal'])
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

  it('after shutdown the old token is dead: further requests are refused (closing gate + connections cut)', async () => {
    await api('/shutdown', { method: 'POST' })
    // 终止即失效：closing 闸 + closeAllConnections——同一 fetch 客户端再请求须落空（拒绝或 503）
    const after = await api('/keys').then(
      (r) => r.status,
      () => 'refused' as const,
    )
    expect(after === 'refused' || after === 503).toBe(true)
  })

  it('concurrent starts produce exactly one session (O_EXCL lock)', async () => {
    await runtime.close() // 清场，让两个 start 真竞争
    const [a, b] = await Promise.all([
      startHostSession({ homeDir: HOME, cwd: ROOT, entries: [] }),
      startHostSession({ homeDir: HOME, cwd: ROOT, entries: [] }),
    ])
    const started = [a, b].filter((r) => 'runtime' in r)
    const attached = [a, b].filter((r) => !('runtime' in r))
    expect(started).toHaveLength(1)
    expect(attached).toHaveLength(1)
    if ('runtime' in (started[0] as object & { runtime?: unknown })) {
      await (started[0] as { runtime: HostRuntime }).runtime.close()
    }
  })
})

describe('project wiring preview and confirmed writes', () => {
  function registerModernProject(): string {
    writeFileSync(join(ROOT, 'mxenv.config.json'), JSON.stringify({
      sources: { local: { provider: 'local', files: ['project.env'], optional: true } },
      profiles: { default: ['local'] }, defaultProfile: 'default',
    }))
    registerProject(ROOT, HOME)
    return ROOT.split('/').pop() as string
  }

  const addSource = {
    type: 'add-source', name: 'dotenvx',
    source: { provider: 'dotenvx', files: ['.env'], optional: true, override: true },
  }

  it('enforces the human boundary, unlock window and explicit project scope', async () => {
    const name = registerModernProject()
    const body = { scope: `project:${name}`, action: addSource, fingerprint: '0'.repeat(64) }
    expect((await api('/wiring-preview', { method: 'POST', body })).status).toBe(403)
    expect((await api('/wiring-preview', { method: 'POST', body, panel: true })).status).toBe(423)
    await api('/unlock', { method: 'POST', panel: true })
    expect((await api('/wiring-preview', { method: 'POST', body: { action: addSource }, panel: true })).status).toBe(400)
    expect((await api('/wiring-preview', { method: 'POST', body: { ...body, scope: 'global' }, panel: true })).status).toBe(400)
    expect((await api('/wiring-preview', { method: 'POST', body: { ...body, scope: 'project:missing' }, panel: true })).status).toBe(404)
  })

  it('previews without writing and commits only with the matching fingerprint', async () => {
    const name = registerModernProject()
    const configPath = join(ROOT, 'mxenv.config.json')
    const original = readFileSync(configPath, 'utf8')
    await api('/unlock', { method: 'POST', panel: true })
    const preview = await api('/wiring-preview', {
      method: 'POST', panel: true, body: { scope: `project:${name}`, action: addSource },
    })
    expect(preview.status).toBe(200)
    expect(preview.body.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(preview.body.after.map((source: any) => source.name)).toEqual(['local', 'dotenvx'])
    expect(readFileSync(configPath, 'utf8')).toBe(original)

    const missing = await api('/wiring-write', {
      method: 'POST', panel: true, body: { scope: `project:${name}`, action: addSource },
    })
    expect(missing.status).toBe(400)
    const committed = await api('/wiring-write', {
      method: 'POST', panel: true,
      body: { scope: `project:${name}`, action: addSource, fingerprint: preview.body.fingerprint },
    })
    expect(committed.status).toBe(200)
    expect(committed.body.backupPath).toBe(`${configPath}.bak`)
    expect(readFileSync(`${configPath}.bak`, 'utf8')).toBe(original)
    const written = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(written.sources.dotenvx.provider).toBe('dotenvx')
    expect(written.profiles.default).toEqual(['local', 'dotenvx'])
    const events = auditEvents().filter((event) => event.action === 'wiring-write')
    expect(events.some((event) => event.outcome === 'success' && event.sources[0] === 'dotenvx')).toBe(true)
    expect(JSON.stringify(committed.body)).not.toContain('mxenv_test_')
  })

  it('returns 409 and preserves concurrent edits when the preview is stale', async () => {
    const name = registerModernProject()
    const configPath = join(ROOT, 'mxenv.config.json')
    await api('/unlock', { method: 'POST', panel: true })
    const preview = await api('/wiring-preview', {
      method: 'POST', panel: true, body: { scope: `project:${name}`, action: addSource },
    })
    const concurrent = JSON.stringify({
      sources: { local: { provider: 'local', files: ['concurrent.env'], optional: true } },
      profiles: { default: ['local'] }, defaultProfile: 'default',
    })
    writeFileSync(configPath, concurrent)
    const stale = await api('/wiring-write', {
      method: 'POST', panel: true,
      body: { scope: `project:${name}`, action: addSource, fingerprint: preview.body.fingerprint },
    })
    expect(stale.status).toBe(409)
    expect(stale.body.code).toBe('stale-fingerprint')
    expect(readFileSync(configPath, 'utf8')).toBe(concurrent)
  })

  it('runs a names-only doctor check for one source without exposing values', async () => {
    const name = registerModernProject()
    writeFileSync(join(ROOT, 'project.env'), `PROJECT_ONLY=${value('project')}\n`, { mode: 0o600 })
    const result = await api(`/doctor?scope=project:${name}&source=local`)
    expect(result.status, JSON.stringify(result.body)).toBe(200)
    expect(result.body).toMatchObject({ source: 'local', provider: 'local', status: 'loaded', keyCount: 1 })
    expect(result.body.value).toBeUndefined()
    expect(JSON.stringify(result.body)).not.toContain(value('project'))
    expect((await api(`/doctor?scope=project:${name}&source=missing`)).status).toBe(404)
    expect((await api(`/doctor?scope=project:${name}`)).status).toBe(400)
  })

  it('previews and commits actual legacy migration through the same guarded API', async () => {
    writeFileSync(join(ROOT, 'mxenv.config.json'), JSON.stringify({
      infisical: { paths: ['/ai'], env: 'dev' }, envFiles: ['.env.local'],
    }))
    registerProject(ROOT, HOME)
    const name = ROOT.split('/').pop() as string
    await api('/unlock', { method: 'POST', panel: true })
    const action = { type: 'migrate-legacy' }
    const preview = await api('/wiring-preview', {
      method: 'POST', panel: true, body: { scope: `project:${name}`, action },
    })
    expect(preview.status).toBe(200)
    expect(preview.body.before).toEqual([])
    expect(preview.body.after.map((source: any) => source.name)).toEqual(['infisical', 'local'])
    const committed = await api('/wiring-write', {
      method: 'POST', panel: true,
      body: { scope: `project:${name}`, action, fingerprint: preview.body.fingerprint },
    })
    expect(committed.status).toBe(200)
    const written = JSON.parse(readFileSync(join(ROOT, 'mxenv.config.json'), 'utf8'))
    expect(written.sources.infisical.env).toBe('dev')
    expect(written.envFiles).toBeUndefined()
  })
})

describe('shutdown cleanup', () => {
  it('close() clears the runtime file (idempotent)', async () => {
    await runtime.close()
    expect(existsSync(join(HOME, '.mxenv', 'host', 'runtime.json'))).toBe(false)
    clearHostSession(HOME) // 幂等
  })
})
