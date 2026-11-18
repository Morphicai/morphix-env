import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, Lock, RefreshCw, ShieldCheck, Unlock } from 'lucide-react'
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
  ScopeItem,
  WiringEditorState,
  WriteTarget,
} from '@/types'

interface Notice {
  text: string
  error: boolean
}

export function App() {
  const [scopes, setScopes] = useState<ScopeItem[]>([])
  const [activeScope, setActiveScope] = useState(() => new URLSearchParams(window.location.search).get('scope') || 'global')
  const [providers, setProviders] = useState<ProviderState[]>([])
  const [legacyWiring, setLegacyWiring] = useState(false)
  const [wiringEditor, setWiringEditor] = useState<WiringEditorState | null>(null)
  const [testingSource, setTestingSource] = useState('')
  const [doctorResults, setDoctorResults] = useState<Record<string, DoctorResult | undefined>>({})
  const [keys, setKeys] = useState<PanelKey[]>([])
  const [locked, setLocked] = useState(true)
  const [loading, setLoading] = useState(true)
  const [authBusy, setAuthBusy] = useState(false)
  const [writeBusy, setWriteBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [revealed, setRevealed] = useState<RevealedValue | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const refreshVersion = useRef(0)
  const revealVersion = useRef(0)

  const clearSensitive = useCallback(() => {
    // Invalidate an in-flight reveal as well as clearing values already rendered.
    revealVersion.current += 1
    setRevealed(null)
    setEditor(null)
    setWiringEditor(null)
    setPending(null)
  }, [])

  const showError = useCallback((error: unknown) => {
    if (error instanceof PanelApiError && error.status === 423) {
      setLocked(true)
      clearSensitive()
    }
    setNotice({ text: error instanceof Error ? error.message : 'The panel request failed.', error: true })
  }, [clearSensitive])

  const refreshStatus = useCallback(async () => {
    try {
      const status = await panelApi<{ locked: boolean }>('/status')
      setLocked(status.locked)
      if (status.locked) clearSensitive()
    } catch {
      // Polling is advisory; an explicit action will surface any actionable error.
    }
  }, [clearSensitive])

  const loadScopes = useCallback(async () => {
    try {
      const result = await panelApi<{ scopes: ScopeItem[] }>('/scopes')
      setScopes(result.scopes)
      setActiveScope((current) => result.scopes.some((scope) => scope.id === current && scope.available !== false) ? current : 'global')
    } catch (error) {
      showError(error)
    }
  }, [showError])

  const refreshScope = useCallback(async (scope: string) => {
    const version = ++refreshVersion.current
    setLoading(true)
    setProviders([])
    setKeys([])
    setLegacyWiring(false)
    setDoctorResults({})
    setTestingSource('')
    try {
      // The provider map supplies file/provider metadata used by key actions.
      const wiring = await panelApi<{ sources: ProviderState[]; legacy: boolean }>(`/wiring?scope=${encodeURIComponent(scope)}`)
      if (version !== refreshVersion.current) return
      setProviders(wiring.sources)
      setLegacyWiring(wiring.legacy)
      const result = await panelApi<{ keys: PanelKey[] }>(`/keys?scope=${encodeURIComponent(scope)}`)
      if (version !== refreshVersion.current) return
      setKeys(result.keys)
    } catch (error) {
      if (version === refreshVersion.current) showError(error)
    } finally {
      if (version === refreshVersion.current) setLoading(false)
    }
  }, [showError])

  useEffect(() => {
    void loadScopes()
    void refreshStatus()
  }, [loadScopes, refreshStatus])

  useEffect(() => {
    clearSensitive()
    setNotice(null)
    void refreshScope(activeScope)
  }, [activeScope, clearSensitive, refreshScope])

  useEffect(() => {
    const timer = window.setInterval(() => void refreshStatus(), 30_000)
    const onFocus = () => void refreshStatus()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [refreshStatus])

  useEffect(() => {
    if (!revealed) return
    const timer = window.setTimeout(() => setRevealed(null), 90_000)
    return () => window.clearTimeout(timer)
  }, [revealed])

  const unlock = async () => {
    setAuthBusy(true)
    setNotice(null)
    try {
      await panelApi('/unlock', { method: 'POST' })
      setLocked(false)
      setNotice({ text: 'Write window opened. It locks again after 15 minutes or 5 minutes without a panel action.', error: false })
    } catch (error) {
      showError(error)
    } finally {
      setAuthBusy(false)
    }
  }

  const lock = async () => {
    setAuthBusy(true)
    try {
      await panelApi('/lock', { method: 'POST' })
    } catch {
      // Local lock still clears every sensitive value even if the daemon disappeared.
    } finally {
      setLocked(true)
      clearSensitive()
      setNotice({ text: 'Panel locked. Revealed values and edit forms were cleared.', error: false })
      setAuthBusy(false)
    }
  }

  const reveal = async (key: PanelKey) => {
    clearSensitive()
    const version = revealVersion.current
    setNotice(null)
    try {
      const result = await panelApi<{ key: string; value: string }>('/reveal', {
        method: 'POST',
        body: JSON.stringify({ key: key.key, source: key.source, scope: activeScope }),
      })
      if (version !== revealVersion.current) return
      setRevealed({ key: result.key, source: key.source, value: result.value })
    } catch (error) {
      showError(error)
    }
  }

  const copyValue = async (key: PanelKey) => {
    if (!revealed || revealed.key !== key.key || revealed.source !== key.source) return
    try {
      await navigator.clipboard.writeText(revealed.value)
      setNotice({ text: `${key.key} copied. The visible value still hides automatically after 90 seconds.`, error: false })
    } catch {
      setNotice({ text: 'Clipboard access was denied by the browser.', error: true })
    }
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
          body: JSON.stringify({
            key: editor.key,
            value: editor.value,
            source: editor.source,
            fileIndex: editor.fileIndex,
            scope: activeScope,
          }),
        })
        setNotice({ text: `${editor.key} was ${editor.mode === 'add' ? 'added' : 'updated'}. Refreshing this scope…`, error: false })
      } else {
        await panelApi('/delete', {
          method: 'POST',
          body: JSON.stringify({
            key: pending.target.key,
            source: pending.target.source,
            fileIndex: pending.target.fileIndex,
            scope: activeScope,
          }),
        })
        setNotice({ text: `${pending.target.key} was deleted. Refreshing this scope…`, error: false })
      }
      setEditor(null)
      setPending(null)
      await refreshScope(activeScope)
    } catch (error) {
      showError(error)
    } finally {
      setWriteBusy(false)
    }
  }

  const testSource = async (source: string) => {
    if (testingSource) return
    setTestingSource(source)
    try {
      const result = await panelApi<DoctorResult>(`/doctor?scope=${encodeURIComponent(activeScope)}&source=${encodeURIComponent(source)}`)
      setDoctorResults((current) => ({ ...current, [source]: result }))
    } catch {
      showError(new Error(`${sourceLabel(source)} is unavailable. Check its credentials and wiring outside the panel, then retry.`))
    } finally {
      setTestingSource('')
    }
  }

  const currentScope = scopes.find((scope) => scope.id === activeScope)

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card/35">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4 px-5 py-4 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl border bg-muted font-mono text-sm font-semibold">m</div>
            <div>
              <h1 className="text-base font-semibold tracking-tight">mxenv</h1>
              <div className="text-[11px] text-muted-foreground">Local secret control panel</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1.5 px-2.5 py-1 font-normal">
              <span className={cn('size-1.5 rounded-full', locked ? 'bg-muted-foreground' : 'bg-emerald-500')} />
              {locked ? 'Locked · read only' : 'Unlocked · temporary write window'}
            </Badge>
            <Button type="button" variant="ghost" size="sm" onClick={() => void refreshScope(activeScope)} disabled={loading}>
              <RefreshCw className={cn(loading && 'animate-spin')} /> Refresh
            </Button>
            {locked ? (
              <Button type="button" size="sm" onClick={() => void unlock()} disabled={authBusy}><Unlock /> Unlock</Button>
            ) : (
              <Button type="button" size="sm" variant="outline" onClick={() => void lock()} disabled={authBusy}><Lock /> Lock</Button>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] gap-6 px-5 py-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:px-8">
        <aside>
          <ScopeSidebar scopes={scopes} activeScope={activeScope} onSelect={setActiveScope} />
          <div className="mt-4 flex gap-2 px-2 text-[11px] leading-5 text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            <p>Names only by default. Reveal and write operations require an active human panel session.</p>
          </div>
        </aside>

        <main className="min-w-0 space-y-6">
          <div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-xl font-semibold tracking-tight">{currentScope?.name ?? 'Global'}</h1>
              <span className="text-xs text-muted-foreground capitalize">{currentScope?.kind ?? 'global'} scope</span>
            </div>
            {currentScope?.path && <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{currentScope.path}</p>}
          </div>

          {notice && (
            <div
              role={notice.error ? 'alert' : 'status'}
              aria-live="polite"
              className={cn(
                'flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs',
                notice.error ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400',
              )}
            >
              {!notice.error && <Check className="mt-0.5 size-3.5 shrink-0" />}
              <span>{notice.text}</span>
            </div>
          )}

          {revealed && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-xs font-medium">{revealed.key} · hides after 90 seconds</span>
                <Button type="button" size="xs" variant="outline" onClick={() => {
                  const key = keys.find((item) => item.key === revealed.key && item.source === revealed.source)
                  if (key) void copyValue(key)
                }}><Copy /> Copy</Button>
              </div>
              <code className="block font-mono text-xs break-all whitespace-pre-wrap">{revealed.value}</code>
            </div>
          )}

          <ProviderCards
            providers={providers}
            locked={locked}
            legacy={legacyWiring}
            canEditWiring={activeScope.startsWith('project:')}
            testingSource={testingSource}
            doctorResults={doctorResults}
            onAddKey={(source) => {
              const provider = providers.find((item) => item.name === source)
              if (provider) openEditor({ key: '', provider: provider.provider, source: provider.name, fileIndex: 0 }, 'add')
            }}
            onEditWiring={(next) => { clearSensitive(); setWiringEditor(next) }}
            onTestSource={(source) => void testSource(source)}
          />

          <KeyTable
            keys={keys}
            locked={locked}
            loading={loading}
            revealedKey={revealed?.key ?? null}
            onReveal={(key) => void reveal(key)}
            onCopy={(key) => void copyValue(key)}
            onEdit={(target) => openEditor(target, 'update')}
            onDelete={(target) => {
              clearSensitive()
              setPending({ type: 'delete', target })
            }}
          />

          <footer className="flex items-start gap-2 pb-4 text-[11px] leading-5 text-muted-foreground">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            <p>Lock clears revealed values and edit forms immediately. Reveal and write operations are audited without recording values or tokens. Remote providers remain read-only.</p>
          </footer>
        </main>
      </div>

      <EditorDialogs
        editor={editor}
        pending={pending}
        busy={writeBusy}
        onEditorChange={setEditor}
        onPendingChange={setPending}
        onConfirm={() => void performConfirmedAction()}
      />
      <WiringEditor
        editor={wiringEditor}
        scope={activeScope}
        onChange={setWiringEditor}
        onSaved={(message) => {
          setNotice({ text: message, error: false })
          void refreshScope(activeScope)
        }}
        onError={showError}
      />
    </div>
  )
}
