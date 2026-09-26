import { execFileSync, spawn } from 'child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { isAbsolute, resolve } from 'path'
import { randomBytes } from 'crypto'
import type { EnvironmentComposition } from './composition'
import { expandHomePath } from './config'
import { loadKeytar, type SourceEntry } from './sources'
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
// Values only ever enter the `local` page content; every other page stays value-free.

function profileUiState(state: EditorState): EditorUiState {
  return {
    token: state.token,
    profileName: state.profileName,
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

function localUiState(state: EditorState, entry: SourceEntry, fileIndex: number): EditorUiState {
  const source = entry.source
  if (source.provider === 'dotenvx') {
    return { token: state.token, profileName: state.profileName, page: 'dotenvx', sourceName: entry.name, files: source.files, fileIndex }
  }
  if (source.provider !== 'local') throw new Error('Source does not use files')
  const file = localFile(entry, fileIndex)
  const content = existsSync(file) ? readFileSync(file, 'utf8') : ''
  return { token: state.token, profileName: state.profileName, page: 'local', sourceName: entry.name, files: source.files, fileIndex, content }
}

async function requireKeytar() {
  const keytar = await loadKeytar()
  if (!keytar) throw new Error('[morphix-env] Keychain editing needs the optional native module "keytar", which is not usable on this machine.')
  return keytar
}

async function keychainUiState(state: EditorState, entry: SourceEntry): Promise<EditorUiState> {
  const source = entry.source
  if (source.provider !== 'os-keychain') throw new Error('Not a Keychain source')
  const keytar = await requireKeytar()
  const credentials = await keytar.findCredentials(source.service)
  return {
    token: state.token,
    profileName: state.profileName,
    page: 'keychain',
    sourceName: entry.name,
    service: source.service,
    accounts: credentials.map(({ account }) => account),
  }
}

function providerUiState(state: EditorState, entry: SourceEntry): EditorUiState {
  return {
    token: state.token,
    profileName: state.profileName,
    page: 'provider',
    sourceName: entry.name,
    provider: entry.source.provider,
    url: sourceUrl(entry),
  }
}

function savedUiState(state: EditorState): EditorUiState {
  return { token: state.token, profileName: state.profileName, page: 'saved' }
}

function errorUiState(state: EditorState, code: number, title: string, message: string): EditorUiState {
  return { token: state.token, profileName: state.profileName, page: 'error', code, title, message }
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

export async function startEditorServer(encodedState: string): Promise<void> {
  const state = JSON.parse(Buffer.from(encodedState, 'base64url').toString('utf8')) as EditorState
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      if (!url.pathname.startsWith(editorPath(state))) return respond(res, 404, renderEditorHtml('Not found', errorUiState(state, 404, 'Not found', 'This editor path does not exist.')))
      const rest = url.pathname.slice(editorPath(state).length)
      if (!rest || rest === '/') {
        if (!state.selectedSource) return respond(res, 200, renderEditorHtml('mx-env editor', profileUiState(state)))
        const selected = state.sourceEntries.find((candidate) => candidate.name === state.selectedSource)
        if (!selected) return respond(res, 404, renderEditorHtml('Unknown source', errorUiState(state, 404, 'Unknown source', 'This source is not part of the selected profile.')))
        if (selected.source.provider === 'local' || selected.source.provider === 'dotenvx') return respond(res, 200, renderEditorHtml(selected.source.provider === 'dotenvx' ? 'Edit dotenvx source' : 'Edit local source', localUiState(state, selected, 0)))
        if (selected.source.provider === 'os-keychain') return respond(res, 200, renderEditorHtml('Edit Keychain source', await keychainUiState(state, selected)))
        return respond(res, 200, renderEditorHtml('Provider source', providerUiState(state, selected)))
      }
      const match = /^\/source\/([^/]+)(?:\/(local|dotenvx|keychain))?$/.exec(rest)
      if (!match) return respond(res, 404, renderEditorHtml('Not found', errorUiState(state, 404, 'Not found', 'This editor path does not exist.')))
      const entry = state.sourceEntries.find((candidate) => candidate.name === decodeURIComponent(match[1]))
      if (!entry) return respond(res, 404, renderEditorHtml('Unknown source', errorUiState(state, 404, 'Unknown source', 'This source is not part of the selected profile.')))

      if (req.method === 'GET') {
        if (entry.source.provider === 'local' || entry.source.provider === 'dotenvx') {
          const fileIndex = Number(url.searchParams.get('fileIndex') || '0')
          return respond(res, 200, renderEditorHtml(entry.source.provider === 'dotenvx' ? 'Edit dotenvx source' : 'Edit local source', localUiState(state, entry, Number.isInteger(fileIndex) && fileIndex >= 0 ? fileIndex : 0)))
        }
        if (entry.source.provider === 'os-keychain') return respond(res, 200, renderEditorHtml('Edit Keychain source', await keychainUiState(state, entry)))
        return respond(res, 200, renderEditorHtml('Provider source', providerUiState(state, entry)))
      }

      if (req.method !== 'POST') return respond(res, 405, renderEditorHtml('Method not allowed', errorUiState(state, 405, 'Method not allowed', 'This editor accepts GET and POST requests only.')))
      const body = await requestBody(req)
      if (match[2] === 'local' && entry.source.provider === 'local') {
        const fileIndex = Number(body.get('fileIndex') || '0')
        const file = localFile(entry, Number.isInteger(fileIndex) && fileIndex >= 0 ? fileIndex : 0)
        mkdirSync(resolve(file, '..'), { recursive: true, mode: 0o700 })
        writeFileSync(file, body.get('content') || '', { mode: 0o600 })
        respond(res, 200, renderEditorHtml('Saved', savedUiState(state)))
        setTimeout(() => server.close(), 250).unref()
        return
      }
      if (match[2] === 'dotenvx' && entry.source.provider === 'dotenvx') {
        const file = localFile(entry, Number(body.get('fileIndex') || '0'))
        const key = body.get('key') || ''
        const value = body.get('value') || ''
        // dotenvx owns the encrypted representation; this process never logs its CLI output.
        execFileSync('dotenvx', ['set', key, value, '-f', file], { stdio: ['ignore', 'ignore', 'ignore'] })
        respond(res, 200, renderEditorHtml('Saved', savedUiState(state)))
        setTimeout(() => server.close(), 250).unref()
        return
      }
      if (match[2] === 'keychain' && entry.source.provider === 'os-keychain') {
        const account = body.get('account') || ''
        const keytar = await requireKeytar()
        if (body.get('action') === 'delete') await keytar.deletePassword(entry.source.service, account)
        else await keytar.setPassword(entry.source.service, account, body.get('value') || '')
        respond(res, 200, renderEditorHtml('Saved', savedUiState(state)))
        setTimeout(() => server.close(), 250).unref()
        return
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
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('Editor did not receive a loopback port'))
      process.stdout.write(`http://127.0.0.1:${address.port}${editorPath(state)}\n`)
      resolve()
    })
  })
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
