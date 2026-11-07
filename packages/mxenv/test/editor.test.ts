import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { createEditorServer, type RunningEditor } from '../src/editor'
import { revealedValue, stateOnPage } from './support/editorPage'

// Keychain editing is exercised against a keytar test double so the suite has
// no native-module dependency; dotenvx paths run against the real CLI.
const keychainStore = vi.hoisted(() => ({ entries: new Map<string, string>() }))

vi.mock('@morphixai/mxenv-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@morphixai/mxenv-core')>()
  return {
    ...actual,
    loadKeytar: async () => ({
      findCredentials: async () => [...keychainStore.entries].map(([account, password]) => ({ account, password })),
      setPassword: async (_service: string, account: string, value: string) => { keychainStore.entries.set(account, value) },
      deletePassword: async (_service: string, account: string) => { keychainStore.entries.delete(account); return true },
    }),
  }
})

const ROOT = join(tmpdir(), `mxenv-editor-${randomUUID()}`)
const HOME = join(ROOT, 'home')
const TOKEN = 'testtoken'
// The dotenvx CLI is shared test tooling held at the workspace root (product
// packages must not declare decryption tooling — see test/product-boundary).
// pnpm isolates each package's .bin, so walk up from this file to find it
// (same anchor as migrate.test.ts — cwd-based lookup breaks under odd roots).
function findDotenvxBin(): string {
  let dir = join(__dirname, '..')
  for (;;) {
    const candidate = join(dir, 'node_modules', '.bin', 'dotenvx')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) throw new Error('dotenvx test tooling not found under any node_modules/.bin — run pnpm install')
    dir = parent
  }
}
const dotenvxBin = findDotenvxBin()

let running: RunningEditor | null = null

afterEach(async () => {
  running?.server.close()
  running = null
  delete process.env.MXTEST_ESHADOW
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true })
})

function seed(file: string, key: string, value: string): void {
  execFileSync(dotenvxBin, ['set', key, value, '-f', file], {
    cwd: ROOT,
    stdio: 'ignore',
    env: { ...process.env, DOTENVX_NO_NATIVE: 'true' },
  })
}

interface StateOverrides {
  selectedSource?: string
}

async function openEditor(overrides: StateOverrides = {}): Promise<RunningEditor> {
  mkdirSync(ROOT, { recursive: true })
  const state = {
    token: TOKEN,
    profileName: 'test',
    selectedSource: overrides.selectedSource,
    sourceStatuses: [
      { name: 'enc', provider: 'dotenvx', availability: 'ok', keyCount: 0 },
      { name: 'kc', provider: 'os-keychain', availability: 'ok', keyCount: 0 },
    ],
    provenance: {},
    sourceEntries: [
      { name: 'enc', source: { provider: 'dotenvx', files: ['enc.env'] }, baseDir: ROOT },
      { name: 'kc', source: { provider: 'os-keychain', platform: 'macos', service: 'mxenv-editor-test' }, baseDir: ROOT },
    ],
    homeDir: HOME,
  }
  const encoded = Buffer.from(JSON.stringify(state)).toString('base64url')
  running = await createEditorServer(encoded)
  return running
}

function post(path: string, params: Record<string, string>): Promise<string> {
  return fetch(`http://127.0.0.1:${new URL(running!.url).port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  }).then((response) => response.text())
}

function get(path: string): Promise<string> {
  return fetch(`http://127.0.0.1:${new URL(running!.url).port}${path}`).then((response) => response.text())
}

function sourceRoot(name: string): string {
  return `/${TOKEN}/source/${name}`
}

function auditEvents(): Array<Record<string, unknown>> {
  const dir = join(HOME, '.mxenv', 'audit')
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((file) =>
    readFileSync(join(dir, file), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)),
  )
}

describe('visual editor', () => {
  it('index is always reachable; --source lands the browser on the source page', async () => {
    await openEditor({ selectedSource: 'enc' })
    expect(running!.landingUrl).toBe(`${running!.url}/source/enc`)

    const index = await get(`/${TOKEN}`)
    // Page identity lives in <title> (server-side literal); component copy is
    // also present in every page's inlined client bundle and cannot be used
    // for presence/absence assertions.
    expect(index).toContain('<title>mxenv editor</title>')

    const sourcePage = await get(`${sourceRoot('enc')}?fileIndex=0`)
    expect(sourcePage).toContain('<title>Edit dotenvx source</title>')
  }, 15_000)

  it('lists dotenvx key names without decrypting values', async () => {
    await openEditor()
    const file = join(ROOT, 'enc.env')
    seed(file, 'MXTEST_LIST_A', 'sentinel-list-a')
    seed(file, 'MXTEST_LIST_B', 'sentinel-list-b')

    const page = await get(`${sourceRoot('enc')}?fileIndex=0`)
    expect(page).toContain('MXTEST_LIST_A')
    expect(page).toContain('MXTEST_LIST_B')
    expect(page).not.toContain('sentinel-list-a')
    expect(page).not.toContain('sentinel-list-b')
  }, 15_000)

  it('reveal returns the file value even when the parent env shadows it', async () => {
    await openEditor()
    const file = join(ROOT, 'enc.env')
    seed(file, 'MXTEST_ESHADOW', 'sentinel-from-file')
    process.env.MXTEST_ESHADOW = 'sentinel-from-env'

    const page = await post(`${sourceRoot('enc')}/dotenvx`, { action: 'reveal', key: 'MXTEST_ESHADOW', fileIndex: '0' })
    expect(page).toContain('sentinel-from-file')
    expect(page).not.toContain('sentinel-from-env')
  }, 15_000)

  it('keeps a single revealed value resident at a time', async () => {
    await openEditor()
    const file = join(ROOT, 'enc.env')
    seed(file, 'MXTEST_RES_A', 'sentinel-res-a')
    seed(file, 'MXTEST_RES_B', 'sentinel-res-b')

    const first = await post(`${sourceRoot('enc')}/dotenvx`, { action: 'reveal', key: 'MXTEST_RES_A', fileIndex: '0' })
    expect(first).toContain('sentinel-res-a')

    const second = await post(`${sourceRoot('enc')}/dotenvx`, { action: 'reveal', key: 'MXTEST_RES_B', fileIndex: '0' })
    expect(second).toContain('sentinel-res-b')
    expect(second).not.toContain('sentinel-res-a')
  }, 15_000)

  it('set rewrites only the submitted key and the session stays open', async () => {
    await openEditor()
    const file = join(ROOT, 'enc.env')
    seed(file, 'MXTEST_SET_A', 'sentinel-set-a-old')
    seed(file, 'MXTEST_SET_B', 'sentinel-set-b')

    const saved = await post(`${sourceRoot('enc')}/dotenvx`, { action: 'set', key: 'MXTEST_SET_A', value: 'sentinel-set-a-new', fileIndex: '0' })
    expect(saved).toContain('<title>Saved</title>')

    // The session survives a save (multi-step maintenance)…
    const revealB = await post(`${sourceRoot('enc')}/dotenvx`, { action: 'reveal', key: 'MXTEST_SET_B', fileIndex: '0' })
    expect(revealB).toContain('sentinel-set-b')
    const revealA = await post(`${sourceRoot('enc')}/dotenvx`, { action: 'reveal', key: 'MXTEST_SET_A', fileIndex: '0' })
    expect(revealA).toContain('sentinel-set-a-new')
  }, 15_000)

  it('delete removes the key from the file and the listing', async () => {
    await openEditor()
    const file = join(ROOT, 'enc.env')
    seed(file, 'MXTEST_DEL_KEEP', 'sentinel-del-keep')
    seed(file, 'MXTEST_DEL_GONE', 'sentinel-del-gone')

    const saved = await post(`${sourceRoot('enc')}/dotenvx`, { action: 'delete', key: 'MXTEST_DEL_GONE', fileIndex: '0' })
    expect(saved).toContain('<title>Saved</title>')

    const page = await get(`${sourceRoot('enc')}?fileIndex=0`)
    expect(page).toContain('MXTEST_DEL_KEEP')
    expect(page).not.toContain('MXTEST_DEL_GONE')
    expect(readFileSync(file, 'utf8')).not.toContain('MXTEST_DEL_GONE=')

    const failedReveal = await post(`${sourceRoot('enc')}/dotenvx`, { action: 'reveal', key: 'MXTEST_DEL_GONE', fileIndex: '0' })
    expect(failedReveal).toContain('Unable to read this value')
  }, 15_000)

  it('close ends the session explicitly', async () => {
    await openEditor()
    const closed = await post(`/${TOKEN}`, { action: 'close' })
    expect(closed).toContain('<title>Session ended</title>')
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(running!.server.listening).toBe(false)
  }, 15_000)

  it('rejects invalid key names without touching the file', async () => {
    await openEditor()
    const file = join(ROOT, 'enc.env')
    seed(file, 'MXTEST_VALID', 'sentinel-valid')

    const rejected = await post(`${sourceRoot('enc')}/dotenvx`, { action: 'set', key: 'bad key!', value: 'sentinel-rejected', fileIndex: '0' })
    expect(rejected).toContain('Invalid key name')
    expect(readFileSync(file, 'utf8')).not.toContain('sentinel-rejected')
  }, 15_000)

  it('audits editor actions with key names and actions but never values', async () => {
    await openEditor()
    const file = join(ROOT, 'enc.env')
    seed(file, 'MXTEST_AUD_A', 'sentinel-aud-old')

    await post(`${sourceRoot('enc')}/dotenvx`, { action: 'set', key: 'MXTEST_AUD_A', value: 'sentinel-aud-new', fileIndex: '0' })
    await post(`${sourceRoot('enc')}/dotenvx`, { action: 'reveal', key: 'MXTEST_AUD_A', fileIndex: '0' })
    await post(`${sourceRoot('enc')}/dotenvx`, { action: 'delete', key: 'MXTEST_AUD_A', fileIndex: '0' })

    const events = auditEvents().filter((event) => event.via === 'editor')
    const actions = events.map((event) => event.action)
    expect(actions).toContain('set')
    expect(actions).toContain('reveal')
    expect(actions).toContain('delete')
    for (const event of events) {
      expect(event.keys).toContain('MXTEST_AUD_A')
      expect(event.sources).toEqual(['enc'])
    }
    const serialized = JSON.stringify(events)
    expect(serialized).not.toContain('sentinel-aud-new')
    expect(serialized).not.toContain('sentinel-aud-old')
    expect(serialized).not.toContain('sentinel-from-file')
  }, 15_000)

  it('prefills the key form from a query parameter', async () => {
    await openEditor()
    const file = join(ROOT, 'enc.env')
    seed(file, 'MXTEST_PREFILL', 'sentinel-prefill')

    const page = await get(`${sourceRoot('enc')}?fileIndex=0&key=MXTEST_PREFILL`)
    // CSR 形态（去 SSR 后）：prefill 落在 state JSON 的 formKey 字段，input
    // 预填由浏览器端渲染——提取 state JSON 解析后断言字段（不受转义形态影响）。
    expect(stateOnPage(page, 'dotenvx').formKey).toBe('MXTEST_PREFILL')
  }, 15_000)

  it('keychain page lists accounts and reveals one value at a time', async () => {
    keychainStore.entries.set('KC_A', 'sentinel-kc-a')
    keychainStore.entries.set('KC_B', 'sentinel-kc-b')
    await openEditor()

    const page = await get(`${sourceRoot('kc')}`)
    expect(page).toContain('KC_A')
    expect(page).toContain('KC_B')
    expect(page).not.toContain('sentinel-kc-a')
    expect(page).not.toContain('sentinel-kc-b')

    const revealA = await post(`${sourceRoot('kc')}/keychain`, { action: 'reveal', account: 'KC_A' })
    expect(revealA).toContain('sentinel-kc-a')
    expect(revealA).not.toContain('sentinel-kc-b')

    const revealB = await post(`${sourceRoot('kc')}/keychain`, { action: 'reveal', account: 'KC_B' })
    expect(revealB).toContain('sentinel-kc-b')
    expect(revealB).not.toContain('sentinel-kc-a')
    keychainStore.entries.clear()
  }, 15_000)

  it('manages keychain entries with arbitrary account names', async () => {
    keychainStore.entries.set('user@example.com', 'sentinel-kc-email')
    await openEditor()

    const reveal = await post(`${sourceRoot('kc')}/keychain`, { action: 'reveal', account: 'user@example.com' })
    expect(reveal).toContain('sentinel-kc-email')

    const deleted = await post(`${sourceRoot('kc')}/keychain`, { action: 'delete', account: 'user@example.com' })
    expect(deleted).toContain('<title>Saved</title>')
    expect(keychainStore.entries.has('user@example.com')).toBe(false)
    keychainStore.entries.clear()
  }, 15_000)

  it('creates key material beside a fresh file, never in the launch cwd', async () => {
    await openEditor()
    const saved = await post(`${sourceRoot('enc')}/dotenvx`, { action: 'set', key: 'MXTEST_FRESH', value: 'sentinel-fresh', fileIndex: '0' })
    expect(saved).toContain('<title>Saved</title>')
    // dotenvx resolves .env.keys relative to cwd for key creation — the editor
    // must pin cwd to the file's directory so key material lands beside it.
    expect(existsSync(join(ROOT, '.env.keys'))).toBe(true)

    const reveal = await post(`${sourceRoot('enc')}/dotenvx`, { action: 'reveal', key: 'MXTEST_FRESH', fileIndex: '0' })
    expect(reveal).toContain('sentinel-fresh')
  }, 15_000)

  it('reveals values that contain their own key prefix verbatim', async () => {
    await openEditor()
    const file = join(ROOT, 'enc.env')
    seed(file, 'MXTEST_EQ', 'MXTEST_EQ=truncated-trap')

    const reveal = await post(`${sourceRoot('enc')}/dotenvx`, { action: 'reveal', key: 'MXTEST_EQ', fileIndex: '0' })
    expect(reveal).toContain('MXTEST_EQ=truncated-trap')
    // CSR 形态：值不再经 SSR 灌入 <code>，不变式下沉到 state JSON 的
    // revealed.value——提取解析后断言：若 reveal 在 = 处截断，值恰为
    // 'truncated-trap'，此式变红（缺失 revealed 同样抛错，防恒真）。
    expect(revealedValue(reveal)).not.toBe('truncated-trap')
  }, 15_000)

  it('rejects unknown actions and value-less writes instead of wiping secrets', async () => {
    await openEditor()
    const file = join(ROOT, 'enc.env')
    seed(file, 'MXTEST_KEEP', 'sentinel-keep')

    const unknown = await post(`${sourceRoot('enc')}/dotenvx`, { action: 'Reveal', key: 'MXTEST_KEEP', fileIndex: '0' })
    expect(unknown).toContain('<title>Invalid request</title>')

    const noValue = await post(`${sourceRoot('enc')}/dotenvx`, { key: 'MXTEST_KEEP', fileIndex: '0' })
    expect(noValue).toContain('<title>Invalid request</title>')

    // Legacy form shape (no action field, value present) still writes.
    const legacy = await post(`${sourceRoot('enc')}/dotenvx`, { key: 'MXTEST_KEEP', value: 'sentinel-keep-2', fileIndex: '0' })
    expect(legacy).toContain('<title>Saved</title>')

    const reveal = await post(`${sourceRoot('enc')}/dotenvx`, { action: 'reveal', key: 'MXTEST_KEEP', fileIndex: '0' })
    expect(reveal).toContain('sentinel-keep-2')
  }, 15_000)

  it('reveal prefers the file value over same-named child env names', async () => {
    await openEditor()
    const file = join(ROOT, 'enc.env')
    // HOME is one of the allowlisted child-env names — without `--overload` the
    // child's HOME would win over the stored value (dotenvx 2.30, verified).
    seed(file, 'HOME', 'stored-home-secret')

    const reveal = await post(`${sourceRoot('enc')}/dotenvx`, { action: 'reveal', key: 'HOME', fileIndex: '0' })
    expect(reveal).toContain('stored-home-secret')
    // CSR 形态：同上，不变式=state JSON 的 revealed.value 不得是子进程 HOME
    // 路径（若 child-env 覆盖取胜，值会以 /Users/ 开头被此式捕获）。
    expect(revealedValue(reveal)).not.toMatch(/^\/Users\//)
  }, 15_000)

  it('refuses to store values containing $ expansion sequences', async () => {
    await openEditor()
    const file = join(ROOT, 'enc.env')
    seed(file, 'MXTEST_DOLLAR', 'sentinel-dollar-safe')

    const rejected = await post(`${sourceRoot('enc')}/dotenvx`, { action: 'set', key: 'MXTEST_DOLLAR', value: 'a$FOO', fileIndex: '0' })
    expect(rejected).toContain('<title>Invalid value</title>')

    const reveal = await post(`${sourceRoot('enc')}/dotenvx`, { action: 'reveal', key: 'MXTEST_DOLLAR', fileIndex: '0' })
    expect(reveal).toContain('sentinel-dollar-safe')
  }, 15_000)

  it('clamps out-of-range file indexes instead of erroring', async () => {
    await openEditor()
    const file = join(ROOT, 'enc.env')
    seed(file, 'MXTEST_IDX', 'sentinel-idx')

    const page = await get(`${sourceRoot('enc')}?fileIndex=99`)
    expect(page).toContain('<title>Edit dotenvx source</title>')
    expect(page).toContain('MXTEST_IDX')
  }, 15_000)

  it('stores dash-leading values verbatim via the -- separator', async () => {
    await openEditor()
    const saved = await post(`${sourceRoot('enc')}/dotenvx`, { action: 'set', key: 'MXTEST_DASH', value: '-f', fileIndex: '0' })
    expect(saved).toContain('<title>Saved</title>')

    const reveal = await post(`${sourceRoot('enc')}/dotenvx`, { action: 'reveal', key: 'MXTEST_DASH', fileIndex: '0' })
    // CSR 形态：dash 开头值原样驻留 state JSON 的 revealed.value（toBe 天然
    // 整值匹配，防 -foo 之类前缀误命中）。
    expect(revealedValue(reveal)).toBe('-f')
    // No stray option-shaped file was created beside the source.
    expect(existsSync(join(ROOT, '-f'))).toBe(false)
    expect(existsSync(join(process.cwd(), '-f'))).toBe(false)
  }, 15_000)

  it('rejects empty values instead of wiping secrets', async () => {
    await openEditor()
    const file = join(ROOT, 'enc.env')
    seed(file, 'MXTEST_NOEMPTY', 'sentinel-noempty')

    const rejected = await post(`${sourceRoot('enc')}/dotenvx`, { action: 'set', key: 'MXTEST_NOEMPTY', value: '', fileIndex: '0' })
    expect(rejected).toContain('<title>Invalid request</title>')

    const reveal = await post(`${sourceRoot('enc')}/dotenvx`, { action: 'reveal', key: 'MXTEST_NOEMPTY', fileIndex: '0' })
    expect(reveal).toContain('sentinel-noempty')
  }, 15_000)

  it('saved page returns to the saved file via fileIndex', async () => {
    await openEditor()
    const saved = await post(`${sourceRoot('enc')}/dotenvx`, { action: 'set', key: 'MXTEST_CONTINUE', value: 'sentinel-continue', fileIndex: '0' })
    // CSR 形态：返回链接由浏览器端按 state 生成，不变式=state JSON 携带
    // fileIndex 0（"Saved"+fileIndex 组合即回到所存文件；页面级 href 断言
    // 见 editor-ui-smoke 的 N-4）。
    expect(stateOnPage(saved, 'saved').fileIndex).toBe(0)
  }, 15_000)

  it('audits local-file write failures', async () => {
    await openEditor()
    const lockedDir = join(ROOT, 'locked')
    mkdirSync(lockedDir, { recursive: true, mode: 0o700 })
    const { chmodSync } = await import('fs')
    chmodSync(lockedDir, 0o500)
    try {
      // Source re-pointed at a file inside the read-only directory.
      const state = {
        token: TOKEN,
        profileName: 'test',
        sourceStatuses: [],
        provenance: {},
        sourceEntries: [{ name: 'locked', source: { provider: 'local', files: ['locked/edit.env'] }, baseDir: ROOT }],
        homeDir: HOME,
      }
      running?.server.close()
      running = await createEditorServer(Buffer.from(JSON.stringify(state)).toString('base64url'))

      const failed = await post(`${sourceRoot('locked')}/local`, { fileIndex: '0', content: 'X=1\n' })
      expect(failed).toContain('<title>Edit failed</title>')

      const events = auditEvents().filter((event) => event.via === 'editor' && event.action === 'set')
      expect(events.some((event) => event.outcome === 'failure' && (event.sources as string[]).includes('locked'))).toBe(true)
    } finally {
      chmodSync(lockedDir, 0o700)
    }
  }, 15_000)
})
