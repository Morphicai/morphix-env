import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Lock, RefreshCw, ShieldCheck, Unlock } from 'lucide-react'
import { panelApi, PanelApiError } from '@/api'
import { EditorDialogs } from '@/components/EditorDialogs'
import { KeyTable } from '@/components/KeyTable'
import { ProviderCards, type DoctorResult } from '@/components/ProviderCards'
import { ScopeSidebar } from '@/components/ScopeSidebar'
import { WiringEditor } from '@/components/WiringEditor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from 'cn'
import { sourceLabel } from '@/types'
import type {
  EditorState,
  PanelKey,
  PendingAction,
  ProviderState,
  RevealedValue,
  ScopeSnapshot,
  WiringEditorState,
  WriteTarget,
} from '@/types'

interface ScopeItem {
  id: string
  kind: string
  name: string
  path?: string
  available?: boolean
}

export function App() {
  const queryClient = useQueryClient()
  const [urlParams] = useState(() => new URLSearchParams(window.location.search))
  const profile = urlParams.get('profile') || ''
  const requestKey = urlParams.get('request') || ''
  const requestReason = (urlParams.get('reason') || '').slice(0, 200)
  const [activeScope, setActiveScope] = useState(() => urlParams.get('scope') || 'global')
  const [requestHandled, setRequestHandled] = useState(false)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [wiringEditor, setWiringEditor] = useState<WiringEditorState | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [revealed, setRevealed] = useState<RevealedValue | null>(null)
  const [revealBusy, setRevealBusy] = useState('')
  const [revealVersion, setRevealVersion] = useState(0)
  const [authBusy, setAuthBusy] = useState(false)
  const [writeBusy, setWriteBusy] = useState(false)
  const [testingSource, setTestingSource] = useState('')
  const [doctorResults, setDoctorResults] = useState<Record<string, DoctorResult>>({})
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scopesQuery = useQuery({
    queryKey: ['scopes'],
    queryFn: () => panelApi<{ scopes: ScopeItem[] }>('/scopes'),
  })
  const scopes = scopesQuery.data?.scopes ?? []

  const statusQuery = useQuery({
    queryKey: ['status'],
    queryFn: () => panelApi<{ locked: boolean; startedAt: string }>('/status'),
    staleTime: 0,
    refetchInterval: 30_000,
  })
  const locked = statusQuery.data?.locked ?? true

  const snapshotQuery = useQuery({
    queryKey: ['snapshot', activeScope, profile],
    queryFn: () => panelApi<ScopeSnapshot>(`/snapshot?scope=${encodeURIComponent(activeScope)}${profile ? `&profile=${encodeURIComponent(profile)}` : ''}`),
    // 切换新 scope 时不把旧 scope 的键名/供应商显示成新 scope 的内容。
    placeholderData: undefined,
  })
  const providers: ProviderState[] = snapshotQuery.data?.sources ?? []
  const keys: PanelKey[] = snapshotQuery.data?.keys ?? []
  const legacyWiring = snapshotQuery.data?.legacy ?? false
  const loading = snapshotQuery.isLoading

  useEffect(() => {
    if (!scopes.length) return
    if (!scopes.some((scope) => scope.id === activeScope && scope.available !== false)) setActiveScope('global')
  }, [scopes, activeScope])

  // Agent 输入请求：URL 只携带键名与说明（不含值）。解锁后自动打开预填的
  // 输入表单；提交仍走 unlock 窗口 + 二次确认 + 无值审计，值直达密钥源。
  const clearRequestParams = useCallback(() => {
    const next = new URLSearchParams(window.location.search)
    next.delete('request')
    next.delete('reason')
    const query = next.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
  }, [])

  useEffect(() => {
    if (!requestKey || requestHandled || locked) return
    if (locked) return
    const sources = snapshotQuery.data?.sources
    if (!sources) return
    const existing = keys.find((row) => row.key === requestKey && !row.inherited)
    if (existing) {
      setEditor({ key: existing.key, provider: existing.provider, source: existing.source, fileIndex: existing.fileIndex, mode: 'update', value: '', reason: requestReason })
    } else {
      // 项目 scope 只写项目声明源（内部 __mx 全局基线除外）；全局 scope 的
      // 可写面恰是全局基线本身。
      const writable = [...sources]
        .filter((source) => source.name.startsWith('__mx') === (activeScope === 'global'))
        .filter((source) => source.provider === 'local' || source.provider === 'dotenvx' || source.provider === 'os-keychain')
        .sort((a, b) => ['local', 'dotenvx', 'os-keychain'].indexOf(a.provider) - ['local', 'dotenvx', 'os-keychain'].indexOf(b.provider))[0]
      if (!writable) {
        setNotice({ text: `No writable source in this scope can accept ${requestKey}.`, error: true })
        setRequestHandled(true)
        clearRequestParams()
        return
      }
      setEditor({ key: requestKey, provider: writable.provider, source: writable.name, fileIndex: 0, mode: 'add', value: '', reason: requestReason })
    }
    setRequestHandled(true)
    clearRequestParams()
  }, [requestKey, requestReason, requestHandled, locked, snapshotQuery.data, keys, activeScope, clearRequestParams])

  useEffect(() => {
    if (requestKey && !requestHandled && locked) {
      setNotice({ text: `An agent requested input for ${requestKey}. Unlock to provide it — the value goes straight into the secret source, not through the agent.`, error: false })
    }
  }, [requestKey, requestHandled, locked])

  const clearSensitive = useCallback(() => {
    setRevealed(null)
    setEditor(null)
    setWiringEditor(null)
    setPending(null)
    setRevealBusy('')
    setRevealVersion((version) => version + 1)
    if (revealTimer.current) clearTimeout(revealTimer.current)
  }, [])

  useEffect(() => {
    if (locked) clearSensitive()
  }, [locked, clearSensitive])

  useEffect(() => {
    clearSensitive()
    setDoctorResults({})
    setNotice(null)
  }, [activeScope, clearSensitive])

  useEffect(() => () => {
    if (revealTimer.current) clearTimeout(revealTimer.current)
  }, [])

  const refreshScope = useCallback(async (scopeId: string) => {
    await queryClient.invalidateQueries({ queryKey: ['snapshot', scopeId, profile] })
  }, [profile, queryClient])

  const showError = (error: unknown) => {
    setNotice({ text: error instanceof Error ? error.message : String(error), error: true })
  }

  const unlock = async () => {
    setAuthBusy(true)
    try {
      await panelApi('/unlock', { method: 'POST' })
      queryClient.setQueryData(['status'], (old: { locked: boolean; startedAt: string } | undefined) => ({ startedAt: old?.startedAt ?? '', locked: false }))
      setNotice({ text: 'Unlocked for a temporary write window. Reveal hides values after 90 seconds.', error: false })
    } catch (error) { showError(error) } finally { setAuthBusy(false) }
  }

  const lock = async () => {
    setAuthBusy(true)
    try {
      await panelApi('/lock', { method: 'POST' })
      queryClient.setQueryData(['status'], (old: { locked: boolean; startedAt: string } | undefined) => ({ startedAt: old?.startedAt ?? '', locked: true }))
      clearSensitive()
    } catch (error) { showError(error) } finally { setAuthBusy(false) }
  }

  const reveal = async (key: PanelKey) => {
    if (locked || revealBusy) return
    const requestVersion = revealVersion
    const requestId = `${key.source}:${key.key}`
    setRevealBusy(requestId)
    try {
      const result = await panelApi<RevealedValue>('/reveal', {
        method: 'POST',
        body: JSON.stringify({ key: key.key, source: key.source, fileIndex: key.fileIndex, scope: activeScope }),
      })
      // scope 切换或 lock 后的晚到响应不得把旧值重新显示。
      if (requestVersion !== revealVersion) return
      setRevealed(result)
      if (revealTimer.current) clearTimeout(revealTimer.current)
      revealTimer.current = setTimeout(() => setRevealed(null), 90_000)
    } catch (error) {
      if (error instanceof PanelApiError && error.status === 423) {
        queryClient.setQueryData(['status'], (old: { locked: boolean; startedAt: string } | undefined) => ({ startedAt: old?.startedAt ?? '', locked: true }))
        clearSensitive()
      }
      showError(error)
    } finally { setRevealBusy('') }
  }

  const copyValue = async (key: PanelKey) => {
    if (locked) return
    if (revealed?.key === key.key && revealed.source === key.source) {
      await navigator.clipboard.writeText(revealed.value)
      setNotice({ text: `${key.key} copied. The clipboard is outside mxenv control.`, error: false })
      return
    }
    await reveal(key)
  }

  const openEditor = (target: WriteTarget, mode: EditorState['mode']) => {
    clearSensitive()
    setNotice(null)
    setEditor({ ...target, mode, value: '' })
  }

  const performConfirmedAction = async () => {
    if (!pending || writeBusy) return
    setWriteBusy(true)
    try {
      if (pending.type === 'set') {
        if (!editor) return
        await panelApi('/set', {
          method: 'POST',
          body: JSON.stringify({ key: editor.key, value: editor.value, source: editor.source, fileIndex: editor.fileIndex, scope: activeScope }),
        })
        setNotice({ text: `${editor.key} was ${editor.mode === 'add' ? 'added' : 'updated'}. Refreshing this scope…`, error: false })
      } else {
        await panelApi('/delete', {
          method: 'POST',
          body: JSON.stringify({ key: pending.target.key, source: pending.target.source, fileIndex: pending.target.fileIndex, scope: activeScope }),
        })
        setNotice({ text: `${pending.target.key} was deleted. Refreshing this scope…`, error: false })
      }
      setEditor(null)
      setPending(null)
      await refreshScope(activeScope)
    } catch (error) { showError(error) } finally { setWriteBusy(false) }
  }

  const testSource = async (source: string) => {
    if (testingSource) return
    setTestingSource(source)
    try {
      const result = await panelApi<DoctorResult>(`/doctor?scope=${encodeURIComponent(activeScope)}&source=${encodeURIComponent(source)}`)
      setDoctorResults((current) => ({ ...current, [source]: result }))
    } catch {
      showError(new Error(`${sourceLabel(source)} is unavailable. Check its credentials and wiring outside the panel, then retry.`))
    } finally { setTestingSource('') }
  }

  const currentScope = scopes.find((scope) => scope.id === activeScope)

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card/35">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4 px-5 py-4 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl border bg-muted font-mono text-sm font-semibold">m</div>
            <div><h1 className="text-base font-semibold tracking-tight">mxenv</h1><div className="text-[11px] text-muted-foreground">Local secret control panel</div></div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1.5 px-2.5 py-1 font-normal"><span className={cn('size-1.5 rounded-full', locked ? 'bg-muted-foreground' : 'bg-emerald-500')} />{locked ? 'Locked · read only' : 'Unlocked · temporary write window'}</Badge>
            <Button type="button" variant="ghost" size="sm" onClick={() => void refreshScope(activeScope)} disabled={snapshotQuery.isFetching}><RefreshCw className={cn(snapshotQuery.isFetching && 'animate-spin')} /> Refresh</Button>
            {locked ? <Button type="button" size="sm" onClick={() => void unlock()} disabled={authBusy}><Unlock /> Unlock</Button> : <Button type="button" size="sm" variant="outline" onClick={() => void lock()} disabled={authBusy}><Lock /> Lock</Button>}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] gap-6 px-5 py-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:px-8">
        <aside>
          <ScopeSidebar scopes={scopes} activeScope={activeScope} onSelect={setActiveScope} />
          <div className="mt-4 flex gap-2 px-2 text-[11px] leading-5 text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0" /><p>Names only by default. Reveal and write operations require an active human panel session.</p></div>
        </aside>

        <main className="min-w-0 space-y-6">
          <div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><h1 className="text-xl font-semibold tracking-tight">{currentScope?.name ?? 'Global'}</h1><span className="text-xs text-muted-foreground capitalize">{currentScope?.kind ?? 'global'} scope</span></div>
            {currentScope?.path && <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{currentScope.path}</p>}
          </div>

          {notice && <div role={notice.error ? 'alert' : 'status'} aria-live="polite" className={cn('flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs', notice.error ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400')}><>{!notice.error && <Check className="mt-0.5 size-3.5 shrink-0" />}</><span>{notice.text}</span></div>}

          <ProviderCards providers={providers} locked={locked} legacy={legacyWiring} canEditWiring={activeScope.startsWith('project:')} testingSource={testingSource} doctorResults={doctorResults} onAddKey={(source) => { const provider = providers.find((item) => item.name === source); if (provider) openEditor({ key: '', provider: provider.provider, source: provider.name, fileIndex: 0 }, 'add') }} onEditWiring={(next) => { clearSensitive(); setWiringEditor(next) }} onTestSource={(source) => void testSource(source)} />

          <KeyTable
            keys={keys}
            locked={locked}
            loading={loading}
            revealed={revealed}
            onReveal={(key) => void reveal(key)}
            onHide={() => {
              setRevealed(null)
              if (revealTimer.current) clearTimeout(revealTimer.current)
            }}
            onCopy={(key) => void copyValue(key)}
            onEdit={(target) => openEditor(target, 'update')}
            onDelete={(target) => { clearSensitive(); setPending({ type: 'delete', target }) }}
          />

          <footer className="flex items-start gap-2 pb-4 text-[11px] leading-5 text-muted-foreground"><Lock className="mt-0.5 size-3.5 shrink-0" /><p>Lock clears revealed values and edit forms immediately. Reveal and write operations are audited without recording values or tokens. Remote providers remain read-only.</p></footer>
        </main>
      </div>

      <EditorDialogs editor={editor} pending={pending} busy={writeBusy} onEditorChange={setEditor} onPendingChange={setPending} onConfirm={() => void performConfirmedAction()} />
      <WiringEditor editor={wiringEditor} scope={activeScope} onChange={setWiringEditor} onSaved={(message) => { setNotice({ text: message, error: false }); void refreshScope(activeScope) }} onError={showError} />
    </div>
  )
}
