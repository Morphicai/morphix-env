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
import { existsSync } from 'fs'
import { resolve } from 'path'
import { panelPage, panelLandingPage } from './panel-page'
import { panelBundleHash, panelCss, panelJs } from './panel-ui/generated/clientAssets'
import {
  acquireHostLock,
  applyConfigAction,
  applyEditAction,
  clearHostSession,
  isDotenvxEncrypted,
  loadConfigLayers,
  loadSource,
  prepareConfigAction,
  readHostSession,
  readProjectRegistry,
  releaseHostLock,
  resolveAuditConfigPath,
  resolveCompositionEntries,
  revealResidenceRelease,
  revealSingle,
  writeAudit,
  writeHostSession,
  type AuditEvent,
  type ConfigAction,
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
  /** 常驻（gui serve --daemon）：TTL/空闲关一律不触发（KeepAlive 语义下自杀不自洽），空闲只锁不关。 */
  daemon?: boolean
}

// Radix 的 scroll-lock/定位使用 style 属性；仅样式允许内联，脚本仍仅 self + SRI。
const PANEL_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

function windowOpen(s: HostSessionState, now: number): boolean {
  return (
    s.unlockAt !== null &&
    now - s.unlockAt < UNLOCK_TTL_MS &&
    now - s.lastActionAt < UNLOCK_IDLE_MS
  )
}

function sessionExpired(s: HostSessionState, now: number): boolean {
  if (s.daemon) return false // 常驻：不判 TTL/空闲（终结只经显式 shutdown/uninstall）
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

// ─── names-only 资源（GET /keys、/wiring、/snapshot） ───────────────

const PANEL_SOURCE_CONCURRENCY = 4

async function mapConcurrent<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(PANEL_SOURCE_CONCURRENCY, items.length) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      output[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return output
}

/** keys 与 wiring 共享一次来源加载；多文件来源按文件加载以保留 reveal 的 fileIndex。 */
async function collectScopeSnapshot(scope: PanelScopeContext, homeDir: string) {
  const parts = await mapConcurrent(scope.entries, async (entry) => {
    const source = entry.source
    const files = 'files' in source ? source.files : undefined
    const scopedEntries = files && files.length > 1
      ? files.map((_, fileIndex) => ({ entry: { ...entry, source: { ...source, files: [files[fileIndex]] } as SourceEntry['source'] }, fileIndex }))
      : [{ entry, fileIndex: undefined }]
    const loaded = await Promise.all(scopedEntries.map(async ({ entry: scoped, fileIndex }) => {
      try {
        return { result: await loadSource(scoped, { homeDir, environment: {} }), fileIndex, error: false }
      } catch {
        return { result: null, fileIndex, error: true }
      }
    }))
    const rows: PanelKeyInfo[] = []
    for (const item of loaded) {
      if (!item.result) continue
      for (const key of Object.keys(item.result.values)) {
        rows.push({
          key, source: entry.name, provider: source.provider,
          ...(scope.id !== 'global' && entry.globalImplicit ? { inherited: true } : {}),
          ...(item.fileIndex !== undefined ? { fileIndex: item.fileIndex } : {}),
          status: 'present',
        })
      }
    }
    const statuses = loaded.filter((item) => item.result).map((item) => item.result!.availability)
    const status = loaded.some((item) => item.error) ? 'error'
      : statuses.length && statuses.every((item) => item === 'missing-optional') ? 'missing-optional'
        : statuses.length && statuses.every((item) => item === 'skipped') ? 'skipped' : 'loaded'
    const details: Record<string, unknown> = {}
    if (source.provider === 'infisical') {
      details.paths = source.paths
      details.env = source.env || null
      details.envPinned = Boolean(source.env)
      if (source.envPrefix) details.envPrefix = source.envPrefix
    } else if (source.provider === 'local' || source.provider === 'dotenvx') {
      details.files = source.files.map((file) => ({ file, exists: existsSync(resolve(entry.baseDir, file)), encrypted: isDotenvxEncrypted(resolve(entry.baseDir, file)) }))
    } else if (source.provider === 'os-keychain') {
      details.service = source.service
      details.keys = source.keys || []
      if (source.platform) details.platform = source.platform
      if (source.linuxStore) details.linuxStore = source.linuxStore
    } else if (source.provider === 'doppler') {
      details.project = source.project
      details.config = source.config
    } else if (source.provider === 'plugin') {
      details.plugin = source.plugin
      details.keys = source.keys
    }
    return {
      source: {
        name: entry.name, provider: source.provider, order: scope.entries.indexOf(entry), status,
        keyCount: new Set(rows.map((row) => row.key)).size, override: Boolean(source.override), optional: Boolean(source.optional), details, config: source,
      },
      keys: rows,
    }
  })
  return { legacy: scope.legacy, sources: parts.map((part) => part.source), keys: parts.flatMap((part) => part.keys).sort((a, b) => a.key.localeCompare(b.key)) }
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

interface PanelScopeContext {
  id: string
  cwd: string
  entries: SourceEntry[]
  profileName: string
  configPath: string
  legacy: boolean
}

/** 缺省 /keys 与旧 reveal 请求的兼容面：沿用会话启动时组装好的来源。 */
function defaultScope(runtime: HostRuntime): PanelScopeContext {
  return {
    id: '',
    cwd: runtime.cwd,
    entries: runtime.entries,
    profileName: runtime.profileName,
    configPath: resolveConfigPath(runtime.homeDir, runtime.cwd),
    legacy: false,
  }
}

/**
 * scope 只允许 `global` 或注册表里的 `project:<name>`，绝不接受调用方给路径。
 * 来源顺序与 profile/legacy 语义由 core 统一解析；这里不复制组合规则。
 */
function resolvePanelScope(runtime: HostRuntime, id: string, profile?: string | null): PanelScopeContext | null {
  if (id === 'global') {
    const initial = loadConfigLayers({ homeDir: runtime.homeDir, cwd: runtime.cwd })
    const layers = loadConfigLayers({ homeDir: runtime.homeDir, cwd: initial.global.baseDir })
    const resolved = resolveCompositionEntries(layers, { profile: profile || undefined })
    // 把全局目录作为 cwd 复用解析器时，其隐式项目 legacy 尾会再次发现同一个
    // ~/.mxenv/.env；全局范围只要基线 + global config 的 profile，不接项目尾巴。
    const entries = resolved.entries.filter((entry) => !entry.legacy)
    const profileName = resolved.name.endsWith('+legacy') ? resolved.name.slice(0, -'+legacy'.length) : resolved.name
    return { id, cwd: layers.global.baseDir, entries, profileName, configPath: layers.global.exists ? layers.global.path : '-', legacy: false }
  }
  if (!id.startsWith('project:')) return null
  const name = id.slice('project:'.length)
  const project = readProjectRegistry(runtime.homeDir).find((entry) => entry.name === name)
  if (!project || !existsSync(project.path)) return null
  const layers = loadConfigLayers({ homeDir: runtime.homeDir, cwd: project.path })
  const resolved = resolveCompositionEntries(layers, { profile: profile || undefined })
  return {
    id,
    cwd: layers.project.baseDir,
    entries: resolved.entries,
    profileName: resolved.name,
    configPath: layers.project.exists ? layers.project.path : '-',
    legacy: Boolean(!layers.project.config.sources && (layers.project.config.infisical || layers.project.config.envFiles)),
  }
}

function scopeForRequest(runtime: HostRuntime, id: string | null, profile?: string | null): PanelScopeContext | null {
  return id ? resolvePanelScope(runtime, id, profile) : defaultScope(runtime)
}

const PANEL_HEADER = 'x-mxenv-panel'

function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > limit) {
        req.destroy()
        resolve(data.slice(0, limit))
      }
    })
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
    legacy: false,
    }

    if (s.closing) {
      // 终止即失效：closing 后任何连接（含 keep-alive 存量）都不得再服务。
      send(res, 503, { error: 'session closed' })
      return
    }
    if (sessionExpired(s, now)) {
      s.closing = true
      auditHost(auditState, { keys: [], outcome: 'success', action: 'close', reason: 'expired' }, startedAt)
      await runtime.close()
      send(res, 503, { error: 'session expired' })
      return
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1')

    // 引导页：无 token 直接访问根路径 → 静态指路页（零会话信息泄露，唯一交互是本地跳转）。
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '')) {
      send(res, 200, panelLandingPage(), { 'content-type': 'text/html; charset=utf-8' })
      return
    }

    // React 静态资源：token + 内容哈希双重精确匹配；错误路径统一 404。
    // JS/CSS 不含会话数据，可在私有浏览器缓存中复用；HTML 与 API 仍 no-store。
    const assetMatch = url.pathname.match(/^\/([^/]+)\/panel-([a-f0-9]{24})\.(js|css)$/)
    if (req.method === 'GET' && assetMatch) {
      const [, token, hash, extension] = assetMatch
      if (token !== s.token || hash !== panelBundleHash) {
        auditHost(auditState, { keys: [], outcome: 'failure', action: undefined, reason: 'auth' }, startedAt)
        send(res, 404, { error: 'not found' })
        return
      }
      send(res, 200, extension === 'js' ? panelJs : panelCss, {
        'content-type': extension === 'js' ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8',
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff',
      })
      return
    }

    // 面板页：token-in-path 一次换 HTML。浏览器首访无 Bearer，
    // 故须在认证检查前精确匹配当前会话 token；错 token 与不存在路径同为 404。
    const pageLikePath = /^\/[^/]+\/?$/.test(url.pathname) && !['/status', '/scopes', '/keys', '/wiring', '/snapshot', '/doctor'].includes(url.pathname)
    if (req.method === 'GET' && pageLikePath) {
      if (url.pathname === `/${s.token}`) {
        // 规范化到尾斜杠，HTML 才能用不含 token 的相对资源 URL。
        send(res, 308, '', { location: `/${s.token}/`, 'cache-control': 'no-store' })
        return
      }
      if (url.pathname !== `/${s.token}/`) {
        auditHost(auditState, { keys: [], outcome: 'failure', action: undefined, reason: 'auth' }, startedAt)
        send(res, 404, { error: 'not found' })
        return
      }
      send(res, 200, panelPage(), {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': PANEL_CSP,
        'x-content-type-options': 'nosniff',
      })
      return
    }

    // 认证：Bearer token（不进日志/审计）
    const auth = req.headers.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!token || token !== s.token) {
      auditHost(auditState, { keys: [], outcome: 'failure', action: undefined, reason: 'auth' }, startedAt)
      send(res, 401, { error: 'unauthorized' })
      return
    }
    s.lastActivityAt = now

    const isPanelClient = req.headers[PANEL_HEADER] === '1'

    try {
      if (req.method === 'GET' && url.pathname === '/status') {
        // names-only 会话状态（gui status 用）：不含值与 token。
        send(res, 200, { locked: !windowOpen(s, now), startedAt: new Date(s.startedAt).toISOString() })
        return
      }

      if (req.method === 'GET' && url.pathname === '/scopes') {
        const projects = readProjectRegistry(runtime.homeDir).map((project) => ({
          id: `project:${project.name}`,
          kind: 'project',
          name: project.name,
          path: project.path,
          lastSeenAt: project.lastSeenAt,
          available: existsSync(project.path),
        }))
        // 远程清单尚未落地（remotes.json 属 P4）；返回空数组而非伪装远程可用。
        send(res, 200, {
          scopes: [{ id: 'global', kind: 'global', name: 'Global', available: true }, ...projects],
          remotes: [],
        })
        return
      }

      if (req.method === 'GET' && url.pathname === '/wiring') {
        const scope = scopeForRequest(runtime, url.searchParams.get('scope'), url.searchParams.get('profile'))
        if (!scope) {
          send(res, 404, { error: 'unknown or unavailable scope' })
          return
        }
        const snapshot = await collectScopeSnapshot(scope, runtime.homeDir)
        send(res, 200, { scope: scope.id || undefined, profile: scope.profileName, legacy: snapshot.legacy, sources: snapshot.sources })
        return
      }

      if (req.method === 'GET' && url.pathname === '/doctor') {
        const scope = scopeForRequest(runtime, url.searchParams.get('scope'), url.searchParams.get('profile'))
        const sourceName = url.searchParams.get('source')
        if (!scope) {
          send(res, 404, { error: 'unknown or unavailable scope' })
          return
        }
        if (!sourceName) {
          send(res, 400, { error: 'source is required' })
          return
        }
        const entry = [...scope.entries].reverse().find((candidate) => candidate.name === sourceName)
        if (!entry) {
          send(res, 404, { error: 'unknown source' })
          return
        }
        const started = Date.now()
        try {
          const loaded = await loadSource(entry, { homeDir: runtime.homeDir, environment: {} })
          send(res, 200, {
            source: entry.name,
            provider: entry.source.provider,
            status: loaded.availability,
            keyCount: Object.keys(loaded.values).length,
            durationMs: Date.now() - started,
          })
        } catch {
          send(res, 200, {
            source: entry.name,
            provider: entry.source.provider,
            status: 'error',
            keyCount: 0,
            durationMs: Date.now() - started,
          })
        }
        return
      }

      if (req.method === 'GET' && url.pathname === '/snapshot') {
        const scope = scopeForRequest(runtime, url.searchParams.get('scope'), url.searchParams.get('profile'))
        if (!scope) {
          send(res, 404, { error: 'unknown or unavailable scope' })
          return
        }
        const snapshot = await collectScopeSnapshot(scope, runtime.homeDir)
        send(res, 200, { scope: scope.id || undefined, profile: scope.profileName, legacy: snapshot.legacy, sources: snapshot.sources, keys: snapshot.keys })
        return
      }

      if (req.method === 'GET' && url.pathname === '/keys') {
        const scopeId = url.searchParams.get('scope')
        const profile = url.searchParams.get('profile')
        const scope = scopeForRequest(runtime, scopeId, profile)
        if (!scope) {
          send(res, 404, { error: 'unknown or unavailable scope' })
          return
        }
        // names-only：值只用于 presence 判定，不出响应（names-only 查询不记审计）
        const snapshot = await collectScopeSnapshot(scope, runtime.homeDir)
        send(res, 200, {
          scope: scope.id || undefined,
          profile: scope.profileName,
          keys: snapshot.keys,
        })
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
          revealResidenceRelease(s.token) // 锁回即清已展示值的驻留
          auditHost(auditState, { keys: [], outcome: 'success', action: 'lock' }, startedAt)
          send(res, 200, { unlocked: false })
        }
        return
      }

      if (req.method === 'POST' && (url.pathname === '/wiring-preview' || url.pathname === '/wiring-write')) {
        const committing = url.pathname === '/wiring-write'
        if (!isPanelClient) {
          auditHost(auditState, { keys: [], outcome: 'failure', action: 'wiring-write', reason: 'consumer-boundary' }, startedAt)
          send(res, 403, { error: 'panel client required (wiring edits are for human-operated panel sessions only)' })
          return
        }
        if (!windowOpen(s, now)) {
          auditHost(auditState, { keys: [], outcome: 'failure', action: 'wiring-write', reason: 'locked' }, startedAt)
          send(res, 423, { error: 'locked: unlock window is not open' })
          return
        }
        let body: { scope?: string; profile?: string; action?: ConfigAction; fingerprint?: string }
        try {
          body = JSON.parse((await readBody(req)) || '{}') as typeof body
        } catch {
          auditHost(auditState, { keys: [], outcome: 'failure', action: 'wiring-write', reason: 'invalid-request' }, startedAt)
          send(res, 400, { error: 'invalid JSON body' })
          return
        }
        if (!body.scope?.startsWith('project:') || !body.action || typeof body.action !== 'object' || typeof body.action.type !== 'string') {
          auditHost(auditState, { keys: [], outcome: 'failure', action: 'wiring-write', reason: 'invalid-request' }, startedAt)
          send(res, 400, { error: 'an explicit project scope and one wiring action are required' })
          return
        }
        const scope = scopeForRequest(runtime, body.scope, body.profile)
        if (!scope) {
          auditHost(auditState, { keys: [], outcome: 'failure', action: 'wiring-write', reason: 'not-found' }, startedAt)
          send(res, 404, { error: 'unknown or unavailable scope' })
          return
        }
        const scopedAudit = { ...auditState, profileName: scope.profileName, configPath: scope.configPath }
        try {
          if (!committing) {
            const preview = prepareConfigAction({ cwd: scope.cwd, action: body.action })
            s.lastActionAt = now
            send(res, 200, preview)
            return
          }
          if (typeof body.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(body.fingerprint)) {
            auditHost(scopedAudit, { keys: [], outcome: 'failure', action: 'wiring-write', reason: 'invalid-request' }, startedAt)
            send(res, 400, { error: 'a preview fingerprint is required for wiring confirmation' })
            return
          }
          s.lastActionAt = now
          const result = applyConfigAction({
            cwd: scope.cwd,
            action: body.action,
            expectedFingerprint: body.fingerprint,
            subject: 'host',
            profileName: scope.profileName,
            homeDir: runtime.homeDir,
          })
          send(res, 200, result)
        } catch (error) {
          const err = error as Error & { code?: string; audited?: boolean }
          if (committing && !err.audited) {
            auditHost(scopedAudit, { keys: [], outcome: 'failure', action: 'wiring-write', reason: err.code || 'write-failed' }, startedAt)
          }
          const status = err.code === 'stale-fingerprint' ? 409 : err.code === 'write-failed' || err.code === 'rollback-failed' ? 500 : 400
          send(res, status, { error: err.message, code: err.code || 'write-failed' })
        }
        return
      }

      if (req.method === 'POST' && (url.pathname === '/set' || url.pathname === '/delete')) {
        const action = url.pathname === '/set' ? 'set' as const : 'delete' as const
        if (!isPanelClient) {
          auditHost(auditState, { keys: [], outcome: 'failure', action, reason: 'consumer-boundary' }, startedAt)
          send(res, 403, { error: 'panel client required (consumer boundary: writes are for human-operated panel sessions only)' })
          return
        }
        if (!windowOpen(s, now)) {
          auditHost(auditState, { keys: [], outcome: 'failure', action, reason: 'locked' }, startedAt)
          send(res, 423, { error: 'locked: unlock window is not open' })
          return
        }
        let body: { key?: string; source?: string; value?: string; fileIndex?: number; scope?: string; profile?: string }
        try {
          body = JSON.parse((await readBody(req)) || '{}') as typeof body
        } catch {
          auditHost(auditState, { keys: [], outcome: 'failure', action, reason: 'invalid-request' }, startedAt)
          send(res, 400, { error: 'invalid JSON body' })
          return
        }
        if (typeof body.key !== 'string' || !body.key || typeof body.source !== 'string' || !body.source || (action === 'set' && typeof body.value !== 'string')) {
          auditHost(auditState, { keys: body.key ? [body.key] : [], outcome: 'failure', action, reason: 'invalid-request' }, startedAt)
          send(res, 400, { error: 'key, source and a string value for set are required' })
          return
        }
        const scope = scopeForRequest(runtime, body.scope || null, body.profile)
        if (!scope) {
          auditHost(auditState, { keys: [body.key], outcome: 'failure', action, reason: 'not-found' }, startedAt)
          send(res, 404, { error: 'unknown or unavailable scope' })
          return
        }
        const scopedAudit = { ...auditState, profileName: scope.profileName, configPath: scope.configPath }
        const entry = [...scope.entries].reverse().find((candidate) => candidate.name === body.source)
        if (!entry) {
          auditHost(scopedAudit, { keys: [body.key], outcome: 'failure', action, reason: 'not-found' }, startedAt)
          send(res, 404, { error: `unknown source "${body.source}"` })
          return
        }
        s.lastActionAt = now // 显式写动作与 reveal 一样延续 5 分钟动作空闲窗
        try {
          const result = await applyEditAction({
            action,
            key: body.key,
            value: body.value,
            entry,
            fileIndex: body.fileIndex,
            subject: 'host',
            profileName: scope.profileName,
            cwd: scope.cwd,
            options: { homeDir: runtime.homeDir },
          })
          // 结果只含动作/键名/来源，不回显写入值。
          send(res, 200, result)
        } catch (error) {
          const err = error as Error & { code?: string }
          const clientError = err.code && err.code !== 'write-failed' && err.code !== 'keychain-unavailable'
          send(res, clientError ? 400 : 500, { error: err.message, code: err.code || 'write-failed' })
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
          revealResidenceRelease(s.token) // 窗口关即清驻留（防值残留到下次解锁）
          auditHost(auditState, { keys: [], outcome: 'failure', action, reason: 'locked' }, startedAt)
          send(res, 423, { error: 'locked: unlock window is not open' })
          return
        }
        let body: { key?: string; source?: string; fileIndex?: number; scope?: string; profile?: string }
        try {
          body = JSON.parse((await readBody(req)) || '{}') as typeof body
        } catch {
          send(res, 400, { error: 'invalid JSON body' })
          return
        }
        if (!body.key || !body.source) {
          auditHost(auditState, { keys: [body.key || ''], outcome: 'failure', action, reason: 'not-found' }, startedAt)
          send(res, 400, { error: 'key and source are required' })
          return
        }
        const scope = scopeForRequest(runtime, body.scope || null, body.profile)
        if (!scope) {
          auditHost(auditState, { keys: [body.key], outcome: 'failure', action, reason: 'not-found' }, startedAt)
          send(res, 404, { error: 'unknown or unavailable scope' })
          return
        }
        const scopedAudit = { ...auditState, profileName: scope.profileName, configPath: scope.configPath }
        // 同名来源后序获胜（与 readStoredValue 的覆盖语义一致）；查找限定在当前 scope。
        const entry = [...scope.entries].reverse().find((e) => e.name === body.source)
        if (!entry) {
          auditHost(scopedAudit, { keys: [body.key], outcome: 'failure', action, reason: 'not-found' }, startedAt)
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
            profileName: scope.profileName,
            cwd: scope.cwd,
            options: { homeDir: runtime.homeDir },
          })
          send(res, 200, { key: body.key, value: revealed.value, source: revealed.source }, { 'cache-control': 'no-store' })
        } catch (error) {
          const err = error as Error & { audited?: boolean; code?: string }
          if (!err.audited) {
            auditHost(scopedAudit, { keys: [body.key], outcome: 'failure', action, reason: err.code || 'read-error' }, startedAt)
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
  /** 常驻模式（gui serve --daemon / launchd / systemd）：无 TTL、空闲只锁不关。 */
  daemon?: boolean
  /** 固定端口（默认随机）。端口占用即启动失败（fail-closed，不静默改随机）。 */
  port?: number
}

/** pid 存活校验（design 决策 2 的崩溃残留自愈）：死 pid 的发现文件/锁即陈旧。 */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function startHostSession(options: StartHostOptions): Promise<{ runtime: HostRuntime; url: string } | { alreadyRunning: true; url: string }> {
  const { homeDir, cwd } = options
  const existing = readHostSession(homeDir)
  if (existing) {
    if (pidAlive(existing.pid)) {
      return { alreadyRunning: true, url: `http://127.0.0.1:${existing.port}/${existing.token}` }
    }
    // 崩溃残留：死会话的发现文件与锁一并清除后重取（自愈）。
    clearHostSession(homeDir)
    releaseHostLock(homeDir)
  }
  if (!acquireHostLock(homeDir)) {
    // 竞争方刚持锁、runtime.json 尚未写入：短暂等待 winner 的发现文件。
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 50))
      const raced = readHostSession(homeDir)
      if (raced) return { alreadyRunning: true, url: `http://127.0.0.1:${raced.port}/${raced.token}` }
    }
    throw new Error('[mxenv] host session lock is held by another process and no runtime session appeared; remove ~/.mxenv/host/lock if a crash left it behind.')
  }

  const token = randomBytes(24).toString('base64url')
  const state: HostSessionState = {
    token,
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    lastActionAt: 0,
    unlockAt: null,
    closing: false,
    ...(options.daemon ? { daemon: true } : {}),
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
      revealResidenceRelease(state.token)
      clearHostSession(homeDir)
      releaseHostLock(homeDir)
      // server.close 只拒新连接；存量 keep-alive 必须显式断开（终止即失效）。
      runtime.server?.closeAllConnections?.()
      await new Promise<void>((resolve) => runtime.server?.close(() => resolve()))
    },
  }
  runtime.server = createServer((req, res) => {
    void createHostHandler(runtime)(req, res)
  })

  await new Promise<void>((resolve, reject) => {
    runtime.server.once('error', reject)
    runtime.server.listen(options.port ?? 0, '127.0.0.1', () => resolve())
  })
  const port = (runtime.server.address() as { port: number }).port
  writeHostSession({ port, pid: process.pid, token, startedAt: new Date().toISOString() }, homeDir)
  auditHost(
    { homeDir, profileName: runtime.profileName, configPath: resolveAuditConfigPath({ homeDir }, cwd) },
    { keys: [], outcome: 'success', action: 'start', ...(options.daemon ? { reason: 'daemon' } : {}) },
    state.startedAt,
  )

  // TTL/空闲兜底定时器（墙钟判定在请求路径逐次校验——定时器只兜底）；
  // daemon 模式无过期语义，不装定时器。
  if (!state.daemon) {
    const timer = setInterval(() => {
      if (sessionExpired(state, Date.now()) && !state.closing) {
        state.closing = true
        void runtime.close().finally(() => clearInterval(timer))
      }
    }, 60_000)
    timer.unref?.()
  }

  return { runtime, url: `http://127.0.0.1:${port}/${token}` }
}

export function hostStatus(homeDir: string): { running: boolean; port?: number; startedAt?: string } {
  const session = readHostSession(homeDir)
  return session ? { running: true, port: session.port, startedAt: session.startedAt } : { running: false }
}

/** gui status 的锁定态查询（names-only GET /status；token 取自 0600 发现文件）。 */
export async function hostLockState(homeDir: string): Promise<{ locked: boolean } | null> {
  const session = readHostSession(homeDir)
  if (!session) return null
  try {
    const res = await fetch(`http://127.0.0.1:${session.port}/status`, {
      headers: { authorization: `Bearer ${session.token}` },
      signal: AbortSignal.timeout(3_000),
    })
    const body = (await res.json()) as { locked: boolean }
    return { locked: body.locked }
  } catch {
    return null
  }
}
