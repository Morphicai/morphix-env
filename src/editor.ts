import { execFileSync, spawn } from 'child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { isAbsolute, dirname, join, resolve } from 'path'
import { randomBytes } from 'crypto'
import type { EnvironmentComposition } from './composition'
import { expandHomePath } from './config'
import { isDotenvxEncrypted, parseEnvFile } from './env'
import { ensureCommand, loadKeytar, type SourceEntry } from './sources'
import { verificationEnv } from './migrate'
import { writeAudit } from './audit'
import { renderEditorHtml } from './editor-ui/render'
import type { EditorUiState } from './editor-ui/types'

const EDITOR_LIFETIME_MS = 15 * 60 * 1000

interface EditorState {
  token: string
  profileName: string
  selectedSource?: string
  sourceStatuses: EnvironmentComposition['sourceStatuses']
  provenance: EnvironmentComposition['provenance']
  sourceEntries: SourceEntry[]
  /** Audit target override for tests; defaults to the real home directory. */
  homeDir?: string
}

function editorPath(state: EditorState, suffix = ''): string {
  return `/${state.token}${suffix}`
}

function localFile(entry: SourceEntry, fileIndex = 0): string {
  const source = entry.source
  if (source.provider !== 'local' && source.provider !== 'dotenvx') throw new Error('Source does not use files')
  const raw = source.files[fileIndex]
  const expanded = expandHomePath(raw, homedir())
  return isAbsolute(expanded) ? expanded : resolve(entry.baseDir, expanded)
}

function sourceUrl(entry: SourceEntry): string | null {
  const source = entry.source
  if (source.provider === 'infisical') return source.siteUrl || 'https://app.infisical.com'
  if (source.provider === 'doppler') return `https://dashboard.doppler.com/workplace/projects/${encodeURIComponent(source.project)}/configs/${encodeURIComponent(source.config)}`
  return null
}

// ---------- UI-state builders ----------
// These translate the internal EditorState into the React state contract.
// Values enter a page only through explicit editing (local rows) or per-key
// reveal (dotenvx/keychain, single value resident) — never through listings,
// CLI output, or audit events.

/** Key names of an env file via full dotenv semantics (`export KEY=`, dotted
 * keys). In dotenvx files names stay plaintext (values are `encrypted:` blobs),
 * so listings need no decryption. */
function envFileKeyNames(file: string): string[] {
  return Object.keys(parseEnvFile(file))
    .filter((key) => !key.startsWith('DOTENV_PUBLIC_KEY'))
    .sort((a, b) => a.localeCompare(b))
}

/**
 * Environment for the editor's dotenvx calls, chosen per file's key model:
 * - `.env.keys` beside the file, or a new/plaintext file → file model
 *   (`DOTENVX_NO_NATIVE`): preserve the portable layout and create new key
 *   material beside the file — never in the launch cwd. Combined with the
 *   pinned `cwd: dirname(file)` on every call this mirrors migrate, which
 *   pins cwd for exactly this reason.
 * - An encrypted file without `.env.keys` (private key custodied in the OS
 *   keychain — e.g. created by plain `dotenvx set`) → drop the flag so the
 *   custodian key stays reachable.
 * The allowlisted environment itself (migrate's verificationEnv) keeps
 * same-named shell exports from shadowing file values and inline
 * `DOTENV_PRIVATE_KEY*` material from substituting for the key file.
 */
function dotenvxEnv(file: string): NodeJS.ProcessEnv {
  const env = { ...verificationEnv() }
  const keychainKeyed = !existsSync(join(dirname(file), '.env.keys')) && isDotenvxEncrypted(file)
  if (keychainKeyed) delete env.DOTENVX_NO_NATIVE
  return env
}

let dotenvxCliCache: string | null = null
function dotenvxCli(): string {
  if (!dotenvxCliCache) dotenvxCliCache = ensureCommand('dotenvx', 'editor', 'dotenvx')
  return dotenvxCliCache
}

/**
 * Read one dotenvx value in-process (browser-bound, never printed). `--overload`
 * makes the file value win over same-named variables of the allowlisted child
 * env (without it `get HOME` would return the child's HOME — verified on dotenvx
 * 2.30). `get` prints the bare value plus one trailing newline; exactly that
 * newline is removed and nothing else. Honest limitation: every dotenvx load
 * path expands `$name` sequences, so a legacy stored value containing `$` is
 * revealed in its expanded (consumer-visible) form — `set` refuses to store new
 * `$` values, matching migrate's semantics.
 */
function dotenvxReadValue(file: string, key: string): string {
  const raw = execFileSync(dotenvxCli(), ['get', key, '-f', file, '--overload'], {
    env: dotenvxEnv(file),
    cwd: dirname(file),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return raw.endsWith('\n') ? raw.slice(0, -1) : raw
}

function dotenvxMutate(action: 'set' | 'del', key: string, value: string | undefined, file: string): void {
  // `--` keeps dash-leading values (e.g. `-f`) from being parsed as dotenvx
  // options (verified on 2.30). Known limitation: the value travels as a CLI
  // argv element, briefly visible in the local process table (dotenvx offers
  // no stdin/env channel for `set`; probes 2026-11-06). The read path is
  // unaffected.
  const args = action === 'set' ? ['set', key, '-f', file, '--', value ?? ''] : ['del', key, '-f', file]
  // Never logs CLI output; per-file env as in dotenvxReadValue.
  execFileSync(dotenvxCli(), args, { env: dotenvxEnv(file), cwd: dirname(file), stdio: ['ignore', 'ignore', 'ignore'] })
}

/** Clamp a user-supplied file index into the source's file range. */
function fileIndexParam(raw: string | null, files: string[]): number {
  const parsed = Number(raw || '0')
  return Number.isInteger(parsed) && parsed >= 0 && parsed < files.length ? parsed : 0
}

/** Whitelisted edit actions; missing action means a legacy write form. A write
 * without a non-empty `value` is malformed — never an implicit wipe to empty. */
function parseEditAction(body: URLSearchParams): 'set' | 'reveal' | 'delete' | null {
  const raw = body.get('action')
  const action = raw == null ? 'set' : raw
  if (action !== 'set' && action !== 'reveal' && action !== 'delete') return null
  if (action === 'set' && !body.get('value')) return null
  return action
}

/** Action-aware failure copy: a reveal is a read, never a failed save. */
function actionErrorState(state: EditorState, action: 'set' | 'delete' | 'reveal'): EditorUiState {
  if (action === 'reveal') {
    return errorUiState(state, 400, 'Unable to read this value', 'The stored value could not be read — the key may have been removed outside this editor. No value was returned to the terminal.')
  }
  return action === 'delete'
    ? errorUiState(state, 400, 'Unable to delete this key', 'The key could not be removed. No value was returned to the terminal.')
    : errorUiState(state, 400, 'Unable to save this source', 'No value was returned to the terminal.')
}

/** Value-free audit for editor actions: key names and action kinds only. */
function auditEditor(state: EditorState, entry: SourceEntry | null, action: 'set' | 'delete' | 'reveal' | 'close', keys: string[], outcome: 'success' | 'failure', startedAt: number): void {
  writeAudit({
    timestamp: new Date().toISOString(),
    profile: state.profileName,
    sources: entry ? [entry.name] : [],
    keys,
    outcome,
    durationMs: Date.now() - startedAt,
    via: 'editor',
    action,
  }, state.homeDir)
}

function uiBase(state: EditorState) {
  return {
    token: state.token,
    profileName: state.profileName,
    sources: state.sourceEntries.map((entry) => ({ name: entry.name, provider: entry.source.provider })),
  }
}

function profileUiState(state: EditorState): EditorUiState {
  return {
    ...uiBase(state),
    page: 'profile',
    sourceStatuses: state.sourceStatuses.map((status) => ({
      name: status.name,
      provider: status.provider,
      availability: status.availability,
      keyCount: status.keyCount,
      editable: state.sourceEntries.some((candidate) => candidate.name === status.name),
    })),
    provenance: Object.entries(state.provenance).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({
      key,
      source: value.source,
      provider: value.provider,
      overriddenSources: value.overriddenSources,
    })),
  }
}

function localUiState(state: EditorState, entry: SourceEntry, fileIndex: number, opts: { formKey?: string; revealed?: { key: string; value: string } } = {}): EditorUiState {
  const source = entry.source
  if (source.provider === 'dotenvx') {
    return {
      ...uiBase(state),
      page: 'dotenvx',
      sourceName: entry.name,
      files: source.files,
      fileIndex,
      keyNames: envFileKeyNames(localFile(entry, fileIndex)),
      formKey: opts.formKey,
      revealed: opts.revealed,
    }
  }
  if (source.provider !== 'local') throw new Error('Source does not use files')
  const file = localFile(entry, fileIndex)
  const content = existsSync(file) ? readFileSync(file, 'utf8') : ''
  return { ...uiBase(state), page: 'local', sourceName: entry.name, files: source.files, fileIndex, content }
}

async function requireKeytar() {
  const keytar = await loadKeytar()
  if (!keytar) throw new Error('[morphix-env] Keychain editing needs the optional native module "keytar", which is not usable on this machine.')
  return keytar
}

function keychainPageState(state: EditorState, entry: SourceEntry, credentials: Array<{ account: string; password: string }>, revealed?: { key: string; value: string }): EditorUiState {
  const source = entry.source
  if (source.provider !== 'os-keychain') throw new Error('Not a Keychain source')
  return {
    ...uiBase(state),
    page: 'keychain',
    sourceName: entry.name,
    service: source.service,
    accounts: credentials.map(({ account }) => account),
    revealed,
  }
}

async function keychainUiState(state: EditorState, entry: SourceEntry, revealed?: { key: string; value: string }): Promise<EditorUiState> {
  const source = entry.source
  if (source.provider !== 'os-keychain') throw new Error('Not a Keychain source')
  const keytar = await requireKeytar()
  return keychainPageState(state, entry, await keytar.findCredentials(source.service), revealed)
}

function providerUiState(state: EditorState, entry: SourceEntry): EditorUiState {
  return {
    ...uiBase(state),
    page: 'provider',
    sourceName: entry.name,
    provider: entry.source.provider,
    url: sourceUrl(entry),
  }
}

function savedUiState(state: EditorState, sourceName: string, action: 'set' | 'delete', key: string, fileIndex: number): EditorUiState {
  return { ...uiBase(state), page: 'saved', sourceName, action, key, fileIndex }
}

function closedUiState(state: EditorState): EditorUiState {
  return { ...uiBase(state), page: 'closed' }
}

function errorUiState(state: EditorState, code: number, title: string, message: string): EditorUiState {
  return { ...uiBase(state), page: 'error', code, title, message }
}

// ---------- HTTP plumbing ----------

async function requestBody(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += value.length
    if (size > 1024 * 1024) throw new Error('Editor request is too large')
    chunks.push(value)
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
}

function respond(res: ServerResponse, status: number, content: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(content)
}

export interface RunningEditor {
  server: ReturnType<typeof createServer>
  /** Root URL (`/<token>`): always the index page. */
  url: string
  /** The URL the browser opens: the pinned source page when `--source` was used. */
  landingUrl: string
}

export async function createEditorServer(encodedState: string): Promise<RunningEditor> {
  const state = JSON.parse(Buffer.from(encodedState, 'base64url').toString('utf8')) as EditorState
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      if (!url.pathname.startsWith(editorPath(state))) return respond(res, 404, renderEditorHtml('Not found', errorUiState(state, 404, 'Not found', 'This editor path does not exist.')))
      const rest = url.pathname.slice(editorPath(state).length)
      if (!rest || rest === '/') {
        // The index is always reachable: "All sources" points here from every
        // page regardless of how the editor was launched (--source lands the
        // browser on the source page directly, see startEditorServer).
        if (req.method === 'POST') {
          const body = await requestBody(req)
          if (body.get('action') === 'close') {
            const started = Date.now()
            auditEditor(state, null, 'close', [], 'success', started)
            respond(res, 200, renderEditorHtml('Session ended', closedUiState(state)))
            setTimeout(() => server.close(), 250).unref()
            return
          }
          return respond(res, 400, renderEditorHtml('Invalid request', errorUiState(state, 400, 'Invalid request', 'This editor accepts only a close action on the session root.')))
        }
        return respond(res, 200, renderEditorHtml('mx-env editor', profileUiState(state)))
      }
      const match = /^\/source\/([^/]+)(?:\/(local|dotenvx|keychain))?$/.exec(rest)
      if (!match) return respond(res, 404, renderEditorHtml('Not found', errorUiState(state, 404, 'Not found', 'This editor path does not exist.')))
      const entry = state.sourceEntries.find((candidate) => candidate.name === decodeURIComponent(match[1]))
      if (!entry) return respond(res, 404, renderEditorHtml('Unknown source', errorUiState(state, 404, 'Unknown source', 'This source is not part of the selected profile.')))

      if (req.method === 'GET') {
        if (entry.source.provider === 'local' || entry.source.provider === 'dotenvx') {
          const fileIndex = fileIndexParam(url.searchParams.get('fileIndex'), entry.source.files)
          const formKey = url.searchParams.get('key') || undefined
          return respond(res, 200, renderEditorHtml(entry.source.provider === 'dotenvx' ? 'Edit dotenvx source' : 'Edit local source', localUiState(state, entry, fileIndex, { formKey })))
        }
        if (entry.source.provider === 'os-keychain') return respond(res, 200, renderEditorHtml('Edit Keychain source', await keychainUiState(state, entry)))
        return respond(res, 200, renderEditorHtml('Provider source', providerUiState(state, entry)))
      }

      if (req.method !== 'POST') return respond(res, 405, renderEditorHtml('Method not allowed', errorUiState(state, 405, 'Method not allowed', 'This editor accepts GET and POST requests only.')))
      const body = await requestBody(req)
      if (match[2] === 'local' && entry.source.provider === 'local') {
        const started = Date.now()
        const fileIndex = fileIndexParam(body.get('fileIndex'), entry.source.files)
        const file = localFile(entry, fileIndex)
        try {
          mkdirSync(resolve(file, '..'), { recursive: true, mode: 0o700 })
          writeFileSync(file, body.get('content') || '', { mode: 0o600 })
        } catch {
          auditEditor(state, entry, 'set', [], 'failure', started)
          return respond(res, 400, renderEditorHtml('Edit failed', actionErrorState(state, 'set')))
        }
        auditEditor(state, entry, 'set', envFileKeyNames(file), 'success', started)
        // The session continues after a save (multi-step maintenance); it ends
        // only via the explicit close action or the TTL.
        return respond(res, 200, renderEditorHtml('Saved', savedUiState(state, entry.name, 'set', '', fileIndex)))
      }
      if (match[2] === 'dotenvx' && entry.source.provider === 'dotenvx') {
        const started = Date.now()
        const fileIndex = fileIndexParam(body.get('fileIndex'), entry.source.files)
        const file = localFile(entry, fileIndex)
        const key = body.get('key') || ''
        const action = parseEditAction(body)
        if (!action) {
          return respond(res, 400, renderEditorHtml('Invalid request', errorUiState(state, 400, 'Invalid request', 'Unknown or incomplete edit action; nothing was processed.')))
        }
        if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(key)) {
          return respond(res, 400, renderEditorHtml('Invalid key', errorUiState(state, 400, 'Invalid key name', 'Key names must match [A-Za-z_][A-Za-z0-9_.]*; no value was processed.')))
        }
        if (action === 'set' && (body.get('value') || '').includes('$')) {
          // Every dotenvx load path expands `$name` sequences (no opt-out), so
          // storing one changes what consumers see — migrate refuses these too.
          return respond(res, 400, renderEditorHtml('Invalid value', errorUiState(state, 400, 'Value contains $', 'dotenvx expands $name sequences on every load path, so this value cannot be stored faithfully. Remove the $ sequence first; nothing was processed.')))
        }
        try {
          if (action === 'reveal') {
            const value = dotenvxReadValue(file, key)
            auditEditor(state, entry, 'reveal', [key], 'success', started)
            return respond(res, 200, renderEditorHtml('Edit dotenvx source', localUiState(state, entry, fileIndex, { revealed: { key, value } })))
          }
          if (action === 'delete') {
            dotenvxMutate('del', key, undefined, file)
            auditEditor(state, entry, 'delete', [key], 'success', started)
            return respond(res, 200, renderEditorHtml('Saved', savedUiState(state, entry.name, 'delete', key, fileIndex)))
          }
          dotenvxMutate('set', key, body.get('value') || '', file)
          auditEditor(state, entry, 'set', [key], 'success', started)
          return respond(res, 200, renderEditorHtml('Saved', savedUiState(state, entry.name, 'set', key, fileIndex)))
        } catch {
          auditEditor(state, entry, action, [key], 'failure', started)
          return respond(res, 400, renderEditorHtml(action === 'reveal' ? 'Read failed' : 'Edit failed', actionErrorState(state, action)))
        }
      }
      if (match[2] === 'keychain' && entry.source.provider === 'os-keychain') {
        const started = Date.now()
        const account = body.get('account') || ''
        const action = parseEditAction(body)
        if (!action) {
          return respond(res, 400, renderEditorHtml('Invalid request', errorUiState(state, 400, 'Invalid request', 'Unknown or incomplete edit action; nothing was processed.')))
        }
        // Existing services may legitimately carry arbitrary account names
        // (emails, dotted ids) — only emptiness is rejected; values never leak.
        if (account.trim() === '') {
          return respond(res, 400, renderEditorHtml('Invalid key', errorUiState(state, 400, 'Invalid account name', 'Account names must not be empty; no value was processed.')))
        }
        try {
          const keytar = await requireKeytar()
          if (action === 'reveal') {
            const credentials = await keytar.findCredentials(entry.source.service)
            const found = credentials.find((candidate) => candidate.account === account)
            if (!found) throw new Error('Unknown account')
            auditEditor(state, entry, 'reveal', [account], 'success', started)
            return respond(res, 200, renderEditorHtml('Edit Keychain source', keychainPageState(state, entry, credentials, { key: account, value: found.password })))
          }
          if (action === 'delete') {
            await keytar.deletePassword(entry.source.service, account)
            auditEditor(state, entry, 'delete', [account], 'success', started)
            return respond(res, 200, renderEditorHtml('Saved', savedUiState(state, entry.name, 'delete', account, 0)))
          }
          await keytar.setPassword(entry.source.service, account, body.get('value') || '')
          auditEditor(state, entry, 'set', [account], 'success', started)
          return respond(res, 200, renderEditorHtml('Saved', savedUiState(state, entry.name, 'set', account, 0)))
        } catch {
          auditEditor(state, entry, action, [account], 'failure', started)
          return respond(res, 400, renderEditorHtml(action === 'reveal' ? 'Read failed' : 'Edit failed', actionErrorState(state, action)))
        }
      }
      return respond(res, 400, renderEditorHtml('Invalid edit', errorUiState(state, 400, 'Invalid edit request', 'This edit action does not match the source provider.')))
    } catch {
      respond(res, 400, renderEditorHtml('Edit failed', errorUiState(state, 400, 'Unable to save this source', 'No value was returned to the terminal.')))
    }
  })

  const closeTimer = setTimeout(() => server.close(), EDITOR_LIFETIME_MS)
  closeTimer.unref()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Editor did not receive a loopback port')
  const root = `http://127.0.0.1:${address.port}${editorPath(state)}`
  // --source sessions land the browser on that source's page; the root stays
  // the index so "All sources" works from every page.
  const landingUrl = state.selectedSource
    ? `http://127.0.0.1:${address.port}${editorPath(state, `/source/${encodeURIComponent(state.selectedSource)}`)}`
    : root
  return { server, url: root, landingUrl }
}

export async function startEditorServer(encodedState: string): Promise<void> {
  const { landingUrl } = await createEditorServer(encodedState)
  process.stdout.write(`${landingUrl}\n`)
}

export interface LaunchedEditor {
  url: string
  opened: boolean
}

export async function launchEditor(entryScript: string, composition: EnvironmentComposition, selectedSource?: string): Promise<LaunchedEditor> {
  if (selectedSource && !composition.sourceEntries.some((entry) => entry.name === selectedSource)) {
    throw new Error(`[morphix-env] Unknown source "${selectedSource}" in the selected profile.`)
  }
  const state: EditorState = {
    token: randomBytes(24).toString('base64url'),
    profileName: composition.profileName,
    selectedSource,
    sourceStatuses: composition.sourceStatuses,
    provenance: composition.provenance,
    sourceEntries: composition.sourceEntries,
    homeDir: homedir(),
  }
  const encoded = Buffer.from(JSON.stringify(state)).toString('base64url')
  const child = spawn(process.execPath, [entryScript, '__mx_editor', encoded], {
    detached: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  }) as import('child_process').ChildProcess
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('[morphix-env] Timed out starting local editor.')), 5_000)
    child.once('error', () => { clearTimeout(timer); reject(new Error('[morphix-env] Could not start local editor.')) })
    child.stdout?.once('data', (chunk: Buffer) => {
      clearTimeout(timer)
      const url = chunk.toString('utf8').trim()
      // The child has already sent its one-time handshake. Keeping this pipe
      // open would keep the caller's CLI event loop alive for the editor TTL.
      child.stdout?.destroy()
      resolve(url)
    })
  })
  child.unref()
  let opened = false
  if (process.platform === 'darwin' && process.env.MX_ENV_NO_OPEN !== '1') {
    try {
      execFileSync('open', [url], { stdio: 'ignore' })
      opened = true
    } catch { /* Explicit --print-editor-url remains available as a fallback. */ }
  }
  return { url, opened }
}
