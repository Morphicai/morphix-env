/**
 * L3 面板宿主（panel-host）：会话式本地 API + 值安全揭示面。
 * 形态=编辑器会话机模式（spawn detached、随机端口、握手回 URL、TTL+空闲关、
 * 显式 close）；经 L1 能力消费（revealSingle/审计/host-runtime/config），
 * 不 import L2 包（产品包零依赖纪律）。值红线：值只进揭示响应（no-store），
 * 永不进日志/审计/持久化；reveal/unlock 端点只供人操作的面板会话消费
 * （X-Mxenv-Panel 标记 + 审计；同 uid 无法硬隔离见 design 决策 3/4）。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { randomBytes } from 'crypto'
import {
  acquireHostLock,
  clearHostSession,
  loadConfigLayers,
  loadSource,
  normalizeProfile,
  readHostSession,
  releaseHostLock,
  resolveAuditConfigPath,
  revealSingle,
  writeAudit,
  writeHostSession,
  type AuditEvent,
  type LoadedSource,
  type PanelKeyInfo,
  type SourceEntry,
} from '@morphixai/mxenv-core'

// ─── 会话状态（墙钟判定；定时器仅兜底） ─────────────────────────

const SESSION_TTL_MS = 4 * 60 * 60_000 // 会话上限 4h
const SESSION_IDLE_MS = 30 * 60_000 // 会话空闲关（任意 API 请求算活动）
const UNLOCK_TTL_MS = 15 * 60_000 // 解锁窗口 15min
const UNLOCK_IDLE_MS = 5 * 60_000 // 窗口空闲锁（只计 reveal/unlock/lock 显式动作）

export interface HostSessionState {
  token: string
  startedAt: number
  lastActivityAt: number // 任意 API 请求
  lastActionAt: number // 显式动作（reveal/unlock/lock）
  unlockAt: number | null
  closing: boolean
}

function windowOpen(s: HostSessionState, now: number): boolean {
  return (
    s.unlockAt !== null &&
    now - s.unlockAt < UNLOCK_TTL_MS &&
    now - s.lastActionAt < UNLOCK_IDLE_MS
  )
}

function sessionExpired(s: HostSessionState, now: number): boolean {
  return now - s.startedAt > SESSION_TTL_MS || now - s.lastActivityAt > SESSION_IDLE_MS
}

// ─── 审计（值无关；范围=值相关与状态转换，names-only 查询不记） ──────

function auditHost(
  state: { homeDir: string; profileName: string; configPath: string },
  event: Pick<AuditEvent, 'keys' | 'outcome' | 'action' | 'reason'>,
  startedAt: number,
): void {
  writeAudit(
    {
      timestamp: new Date().toISOString(),
      profile: state.profileName || '-',
      sources: [],
      keys: event.keys,
      outcome: event.outcome,
      durationMs: Date.now() - startedAt,
      via: 'host',
      action: event.action,
      ...(event.reason ? { reason: event.reason } : {}),
      configPath: state.configPath,
    },
    state.homeDir,
  )
}

/** configPath 只记真实路径（design 决策 7）；与 run/edit 写侧共用 core 解析。 */
export function resolveConfigPath(homeDir: string, cwd: string): string {
  return resolveAuditConfigPath({ homeDir }, cwd)
}

/** 组装宿主可见来源：全局库 + 项目配置声明来源的并集（值不在此层出现）。 */
export function collectEntries(layers: { global: { config: { sources?: Record<string, unknown> }; baseDir: string }; project: { config: { sources?: Record<string, unknown> }; baseDir: string } }): SourceEntry[] {
  const entries: SourceEntry[] = []
  for (const [name, source] of Object.entries(layers.global.config.sources || {})) {
    entries.push({ name, source: source as SourceEntry['source'], baseDir: layers.global.baseDir })
  }
  for (const [name, source] of Object.entries(layers.project.config.sources || {})) {
    entries.push({ name, source: source as SourceEntry['source'], baseDir: layers.project.baseDir })
  }
  return entries
}

// ─── names-only 资源（GET /keys） ───────────────────────────────

async function collectKeys(entries: SourceEntry[], context: { homeDir: string }): Promise<PanelKeyInfo[]> {
  const rows: PanelKeyInfo[] = []
  for (const entry of entries) {
    if (!('keys' in entry.source) && entry.source.provider !== 'local' && entry.source.provider !== 'dotenvx') continue
    let loaded: LoadedSource
    try {
      loaded = await loadSource(entry, { homeDir: context.homeDir, environment: {} })
    } catch {
      continue // 来源不可用时不阻塞其余来源；状态由 present/missing 表达
    }
    const files = 'files' in entry.source ? entry.source.files : undefined
    for (const [key, value] of Object.entries(loaded.values)) {
      rows.push({
        key,
        source: entry.name,
        ...(files && files.length > 1 ? { fileIndex: 0 } : {}),
        status: value === undefined || value === null ? 'missing' : 'present',
      })
    }
  }
  return rows.sort((a, b) => a.key.localeCompare(b.key))
}

// ─── HTTP 面（Bearer token；reveal/unlock 需面板标记） ─────────────

export interface HostRuntime {
  server: Server
  state: HostSessionState
  homeDir: string
  cwd: string
  profileName: string
  entries: SourceEntry[]
  close: () => Promise<void>
}

const PANEL_HEADER = 'x-mxenv-panel'

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => (data += chunk))
    req.on('end', () => resolve(data))
  })
}

function send(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extraHeaders })
  res.end(payload)
}

export function createHostHandler(runtime: HostRuntime) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const startedAt = Date.now()
    const now = Date.now()
    const s = runtime.state
    const auditState = {
      homeDir: runtime.homeDir,
      profileName: runtime.profileName,
      configPath: resolveConfigPath(runtime.homeDir, runtime.cwd),
    }

    if (sessionExpired(s, now) && !s.closing) {
      s.closing = true
      await runtime.close()
      send(res, 503, { error: 'session expired' })
      return
    }

    // 认证：Bearer token（不进日志/审计）
    const auth = req.headers.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!token || token !== s.token) {
      auditHost(auditState, { keys: [], outcome: 'failure', action: 'close', reason: 'auth' }, startedAt)
      send(res, 401, { error: 'unauthorized' })
      return
    }
    s.lastActivityAt = now

    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const isPanelClient = req.headers[PANEL_HEADER] === '1'

    try {
      if (req.method === 'GET' && url.pathname === '/keys') {
        const profile = url.searchParams.get('profile')
        let entries = runtime.entries
        if (profile) {
          const config = loadConfigLayers({ homeDir: runtime.homeDir, cwd: runtime.cwd }).project.config
          const input = config.profiles?.[profile]
          const declared = input ? normalizeProfile(input).sources : undefined
          if (declared) entries = entries.filter((e) => declared.includes(e.name))
        }
        // names-only：值只用于 presence 判定，不出响应（names-only 查询不记审计）
        send(res, 200, { keys: await collectKeys(entries, { homeDir: runtime.homeDir }) })
        return
      }

      if (req.method === 'POST' && (url.pathname === '/unlock' || url.pathname === '/lock')) {
        if (!isPanelClient) {
          auditHost(auditState, { keys: [], outcome: 'failure', action: url.pathname === '/unlock' ? 'unlock' : 'lock', reason: 'consumer-boundary' }, startedAt)
          send(res, 403, { error: 'panel client required (consumer boundary: reveal/unlock are for human-operated panel sessions only)' })
          return
        }
        if (url.pathname === '/unlock') {
          s.unlockAt = now
          s.lastActionAt = now
          auditHost(auditState, { keys: [], outcome: 'success', action: 'unlock' }, startedAt)
          send(res, 200, { unlocked: true, windowMs: UNLOCK_TTL_MS })
        } else {
          s.unlockAt = null
          s.lastActionAt = now
          auditHost(auditState, { keys: [], outcome: 'success', action: 'lock' }, startedAt)
          send(res, 200, { unlocked: false })
        }
        return
      }

      if (req.method === 'POST' && url.pathname === '/shutdown') {
        if (!s.closing) {
          s.closing = true
          auditHost(auditState, { keys: [], outcome: 'success', action: 'close' }, startedAt)
          send(res, 200, { closing: true })
          await runtime.close()
        } else {
          send(res, 200, { closing: true })
        }
        return
      }

      if (req.method === 'POST' && url.pathname === '/reveal') {
        const action = 'reveal' as const
        if (!isPanelClient) {
          auditHost(auditState, { keys: [], outcome: 'failure', action, reason: 'consumer-boundary' }, startedAt)
          send(res, 403, { error: 'panel client required (consumer boundary: reveal/unlock are for human-operated panel sessions only)' })
          return
        }
        if (!windowOpen(s, now)) {
          auditHost(auditState, { keys: [], outcome: 'failure', action, reason: 'locked' }, startedAt)
          send(res, 423, { error: 'locked: unlock window is not open' })
          return
        }
        const body = JSON.parse((await readBody(req)) || '{}') as { key?: string; source?: string; fileIndex?: number }
        if (!body.key || !body.source) {
          auditHost(auditState, { keys: [body.key || ''], outcome: 'failure', action, reason: 'not-found' }, startedAt)
          send(res, 400, { error: 'key and source are required' })
          return
        }
        const entry = runtime.entries.find((e) => e.name === body.source)
        if (!entry) {
          auditHost(auditState, { keys: [body.key], outcome: 'failure', action, reason: 'not-found' }, startedAt)
          send(res, 404, { error: `unknown source "${body.source}"` })
          return
        }
        s.lastActionAt = now
        try {
          // 揭示唯一实现：逐键、单值驻留（slot=会话 token）；能力自带 reveal 审计。
          const revealed = await revealSingle({
            key: body.key,
            entry,
            fileIndex: body.fileIndex,
            subject: 'host',
            slotId: s.token,
            authorized: true,
            profileName: runtime.profileName,
            options: { homeDir: runtime.homeDir },
          })
          send(res, 200, { key: body.key, value: revealed.value, source: revealed.source }, { 'cache-control': 'no-store' })
        } catch (error) {
          const err = error as Error & { audited?: boolean; code?: string }
          if (!err.audited) {
            auditHost(auditState, { keys: [body.key], outcome: 'failure', action, reason: err.code || 'read-error' }, startedAt)
          }
          send(res, err.code === 'not-found' ? 404 : 500, { error: err.message })
        }
        return
      }

      send(res, 404, { error: 'not found' })
    } catch (error) {
      send(res, 500, { error: (error as Error).message })
    }
  }
}

// ─── 会话生命周期 ─────────────────────────────────────────────

export interface StartHostOptions {
  homeDir: string
  cwd: string
  profileName?: string
  entries?: SourceEntry[]
}

export async function startHostSession(options: StartHostOptions): Promise<{ runtime: HostRuntime; url: string } | { alreadyRunning: true; url: string }> {
  const { homeDir, cwd } = options
  const existing = readHostSession(homeDir)
  if (existing) {
    // 幂等附着：会话仍存活（pid 存活校验交给操作系统——连接成功即活）。
    return { alreadyRunning: true, url: `http://127.0.0.1:${existing.port}/${existing.token}` }
  }
  if (!acquireHostLock(homeDir)) {
    const raced = readHostSession(homeDir)
    if (raced) return { alreadyRunning: true, url: `http://127.0.0.1:${raced.port}/${raced.token}` }
    throw new Error('[mxenv] host session lock is held by another process and no runtime session exists; remove ~/.mxenv/host/lock if a crash left it behind.')
  }

  const token = randomBytes(24).toString('base64url')
  const state: HostSessionState = {
    token,
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    lastActionAt: 0,
    unlockAt: null,
    closing: false,
  }

  const runtime: HostRuntime = {
    server: null as unknown as Server,
    state,
    homeDir,
    cwd,
    profileName: options.profileName || '-',
    entries: options.entries || [],
    close: async () => {
      // 先清发现文件再停服务：server.close 回调要等连接全关（keep-alive 会拖住），
      // "停止即失效"必须是即时语义（spec：close 后旧 token 落空）。
      clearHostSession(homeDir)
      releaseHostLock(homeDir)
      await new Promise<void>((resolve) => runtime.server?.close(() => resolve()))
    },
  }
  runtime.server = createServer((req, res) => {
    void createHostHandler(runtime)(req, res)
  })

  await new Promise<void>((resolve, reject) => {
    runtime.server.once('error', reject)
    runtime.server.listen(0, '127.0.0.1', () => resolve())
  })
  const port = (runtime.server.address() as { port: number }).port
  writeHostSession({ port, pid: process.pid, token, startedAt: new Date().toISOString() }, homeDir)

  // TTL/空闲兜底定时器（墙钟判定在请求路径逐次校验——定时器只兜底）
  const timer = setInterval(() => {
    if (sessionExpired(state, Date.now()) && !state.closing) {
      state.closing = true
      void runtime.close().finally(() => clearInterval(timer))
    }
  }, 60_000)
  timer.unref?.()

  return { runtime, url: `http://127.0.0.1:${port}/${token}` }
}

export function hostStatus(homeDir: string): { running: boolean; port?: number; startedAt?: string; unlocked?: boolean } {
  const session = readHostSession(homeDir)
  return session ? { running: true, port: session.port, startedAt: session.startedAt } : { running: false }
}
