import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { panelApi, PanelApiError } from '@/api'
import type {
  WiringAction,
  WiringDiffItem,
  WiringEditorState,
  WiringPreview,
  WiringSource,
} from '@/types'

const selectClass = 'border-input bg-background ring-offset-background focus-visible:ring-ring flex h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-2'

function initialDraft(editor: WiringEditorState): WiringSource {
  if (editor.source?.config) return { ...editor.source.config }
  return { provider: 'local', files: ['.env.local'], optional: true, override: true }
}

function lines(value: string): string[] {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
}

function diffRows(before: WiringDiffItem[], after: WiringDiffItem[]) {
  const beforeMap = new Map(before.map((item) => [item.name, item]))
  const afterMap = new Map(after.map((item) => [item.name, item]))
  return [...new Set([...beforeMap.keys(), ...afterMap.keys()])].map((name) => {
    const oldItem = beforeMap.get(name)
    const newItem = afterMap.get(name)
    return {
      name,
      marker: !oldItem ? '+' : !newItem ? '−' : '~',
      item: newItem ?? oldItem!,
    }
  })
}

function DiffItem({ item, marker }: { item: WiringDiffItem; marker: string }) {
  const detail = item.files?.join(', ') || item.paths?.join(', ') || item.service || item.env || ''
  return (
    <div className="flex items-start gap-3 rounded-md border bg-muted/20 px-3 py-2 text-xs">
      <span className="w-3 font-mono text-muted-foreground">{marker}</span>
      <div className="min-w-0">
        <div><code className="font-mono font-medium">{item.name}</code> <span className="text-muted-foreground">{item.provider}</span></div>
        {detail && <div className="mt-1 break-all text-muted-foreground">{detail}</div>}
        <div className="mt-1 text-muted-foreground">
          {item.keyCount !== undefined && `${item.keyCount} declared key(s) · `}
          {item.profiles?.length ? `profiles: ${item.profiles.join(', ')}` : 'not in a profile'}
        </div>
      </div>
    </div>
  )
}

interface WiringEditorProps {
  editor: WiringEditorState | null
  scope: string
  onChange: (editor: WiringEditorState | null) => void
  onSaved: (message: string) => void
  onError: (error: unknown) => void
}

export function WiringEditor({ editor, scope, onChange, onSaved, onError }: WiringEditorProps) {
  const [name, setName] = useState('')
  const [draft, setDraft] = useState<WiringSource>({ provider: 'local' })
  const [preview, setPreview] = useState<WiringPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setName(editor?.source?.name ?? '')
    setDraft(editor ? initialDraft(editor) : { provider: 'local' })
    setPreview(null)
    setBusy(false)
    setError('')
  }, [editor])

  const action = useMemo<WiringAction | null>(() => {
    if (!editor) return null
    if (editor.mode === 'migrate') return { type: 'migrate-legacy' }
    if (editor.mode === 'remove') return { type: 'remove-source', name: editor.source?.name ?? '' }
    return { type: editor.mode === 'add' ? 'add-source' : 'update-source', name, source: draft }
  }, [draft, editor, name])

  const update = (patch: Partial<WiringSource>) => setDraft((current) => ({ ...current, ...patch }))
  const listValue = (value?: string[]) => value?.join('\n') ?? ''

  const requestPreview = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!action || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await panelApi<WiringPreview>('/wiring-preview', {
        method: 'POST', body: JSON.stringify({ scope, action }),
      })
      setPreview(result)
    } catch (caught) {
      if (caught instanceof PanelApiError && caught.status === 423) onError(caught)
      else setError(caught instanceof Error ? caught.message : 'Could not preview this wiring change.')
    } finally {
      setBusy(false)
    }
  }

  const commit = async () => {
    if (!action || !preview || busy) return
    setBusy(true)
    setError('')
    try {
      await panelApi('/wiring-write', {
        method: 'POST',
        body: JSON.stringify({ scope, action, fingerprint: preview.fingerprint }),
      })
      setPreview(null)
      onChange(null)
      onSaved('Wiring updated. The previous configuration was saved as mxenv.config.json.bak.')
    } catch (caught) {
      if (caught instanceof PanelApiError && caught.status === 423) onError(caught)
      else if (caught instanceof PanelApiError && caught.status === 409) {
        setPreview(null)
        setError('The configuration changed after this preview. Review a fresh diff before writing.')
      } else setError(caught instanceof Error ? caught.message : 'Could not write this wiring change.')
    } finally {
      setBusy(false)
    }
  }

  const title = editor?.mode === 'add' ? 'Add provider'
    : editor?.mode === 'edit' ? 'Edit provider wiring'
      : editor?.mode === 'remove' ? 'Remove provider' : 'Migrate legacy wiring'
  const rows = preview ? diffRows(preview.before, preview.after) : []

  return (
    <>
      <AlertDialog open={Boolean(editor) && !preview} onOpenChange={(open) => !open && !busy && onChange(null)}>
        <AlertDialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <form onSubmit={(event) => void requestPreview(event)}>
            <AlertDialogHeader>
              <AlertDialogTitle>{title}</AlertDialogTitle>
              <AlertDialogDescription>
                Edit connection metadata only. Secret values stay in their providers; a backup and reviewed diff are required before writing.
              </AlertDialogDescription>
            </AlertDialogHeader>

            {editor?.mode === 'migrate' ? (
              <p className="my-5 text-sm text-muted-foreground">
                Convert this project’s flat Infisical and envFiles settings to modern sources, profiles, and a default profile. File contents are not changed.
              </p>
            ) : editor?.mode === 'remove' ? (
              <p className="my-5 text-sm text-muted-foreground">
                Remove <code className="font-mono text-foreground">{editor.source?.name}</code> from project wiring and every profile. Provider data and secret values are not deleted.
              </p>
            ) : (
              <div className="my-5 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="wiring-name">Source name</Label>
                    <Input id="wiring-name" value={name} readOnly={editor?.mode === 'edit'} autoComplete="off" className="font-mono read-only:bg-muted/40" onChange={(event) => setName(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="wiring-provider">Provider</Label>
                    <select id="wiring-provider" className={selectClass} value={draft.provider} disabled={editor?.mode === 'edit'} onChange={(event) => setDraft({ provider: event.target.value, optional: true, override: true })}>
                      {['local', 'dotenvx', 'infisical', 'os-keychain', 'doppler', 'plugin'].map((provider) => <option key={provider}>{provider}</option>)}
                    </select>
                  </div>
                </div>

                {(draft.provider === 'local' || draft.provider === 'dotenvx') && (
                  <div className="space-y-2">
                    <Label htmlFor="wiring-files">Files in precedence order</Label>
                    <textarea id="wiring-files" className="border-input bg-background min-h-20 w-full rounded-lg border px-3 py-2 font-mono text-sm" value={listValue(draft.files)} onChange={(event) => update({ files: lines(event.target.value) })} />
                    <p className="text-xs text-muted-foreground">One path per line; later files take precedence.</p>
                  </div>
                )}
                {draft.provider === 'dotenvx' && <div className="space-y-2"><Label htmlFor="wiring-key-path">Key file path (optional)</Label><Input id="wiring-key-path" value={draft.keyPath ?? ''} onChange={(event) => update({ keyPath: event.target.value || undefined })} /></div>}
                {draft.provider === 'infisical' && <>
                  <div className="space-y-2"><Label htmlFor="wiring-paths">Infisical paths</Label><textarea id="wiring-paths" className="border-input bg-background min-h-20 w-full rounded-lg border px-3 py-2 font-mono text-sm" value={listValue(draft.paths)} onChange={(event) => update({ paths: lines(event.target.value) })} /></div>
                  <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="wiring-env">Pinned environment</Label><Input id="wiring-env" value={draft.env ?? ''} placeholder="dev" onChange={(event) => update({ env: event.target.value || undefined })} /></div><div className="space-y-2"><Label htmlFor="wiring-prefix">Environment prefix</Label><Input id="wiring-prefix" value={draft.envPrefix ?? ''} onChange={(event) => update({ envPrefix: event.target.value || undefined })} /></div></div>
                </>}
                {draft.provider === 'os-keychain' && <>
                  <div className="space-y-2"><Label htmlFor="wiring-service">Service</Label><Input id="wiring-service" value={draft.service ?? ''} onChange={(event) => update({ service: event.target.value })} /></div>
                  <div className="space-y-2"><Label htmlFor="wiring-keys">Declared key names</Label><textarea id="wiring-keys" className="border-input bg-background min-h-20 w-full rounded-lg border px-3 py-2 font-mono text-sm" value={listValue(draft.keys)} onChange={(event) => update({ keys: lines(event.target.value) })} /></div>
                  <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="wiring-platform">Platform pin</Label><select id="wiring-platform" className={selectClass} value={draft.platform ?? ''} onChange={(event) => update({ platform: (event.target.value || undefined) as WiringSource['platform'] })}><option value="">Current platform</option><option value="macos">macOS</option><option value="linux">Linux</option><option value="windows">Windows</option></select></div><div className="space-y-2"><Label htmlFor="wiring-linux-store">Linux store</Label><select id="wiring-linux-store" className={selectClass} value={draft.linuxStore ?? 'secret-service'} onChange={(event) => update({ linuxStore: event.target.value as WiringSource['linuxStore'] })}><option value="secret-service">Secret Service</option><option value="keyutils">keyutils (explicit, volatile)</option></select></div></div>
                </>}
                {draft.provider === 'doppler' && <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="wiring-project">Doppler project</Label><Input id="wiring-project" value={draft.project ?? ''} onChange={(event) => update({ project: event.target.value })} /></div><div className="space-y-2"><Label htmlFor="wiring-config">Doppler config</Label><Input id="wiring-config" value={draft.config ?? ''} onChange={(event) => update({ config: event.target.value })} /></div></div>}
                {draft.provider === 'plugin' && <>
                  <div className="space-y-2"><Label htmlFor="wiring-plugin">Plugin package</Label><Input id="wiring-plugin" value={draft.plugin ?? ''} onChange={(event) => update({ plugin: event.target.value })} /></div>
                  <div className="space-y-2"><Label htmlFor="wiring-command">Command arguments</Label><textarea id="wiring-command" className="border-input bg-background min-h-20 w-full rounded-lg border px-3 py-2 font-mono text-sm" value={listValue(draft.command)} onChange={(event) => update({ command: lines(event.target.value) })} /></div>
                  <div className="space-y-2"><Label htmlFor="wiring-plugin-keys">Declared key names</Label><textarea id="wiring-plugin-keys" className="border-input bg-background min-h-20 w-full rounded-lg border px-3 py-2 font-mono text-sm" value={listValue(draft.keys)} onChange={(event) => update({ keys: lines(event.target.value) })} /></div>
                </>}
                {(draft.provider === 'local' || draft.provider === 'doppler') && <div className="space-y-2"><Label htmlFor="wiring-source-prefix">Environment prefix</Label><Input id="wiring-source-prefix" value={draft.envPrefix ?? ''} onChange={(event) => update({ envPrefix: event.target.value || undefined })} /></div>}
                <div className="flex gap-6 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(draft.optional)} onChange={(event) => update({ optional: event.target.checked })} /> Optional</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(draft.override)} onChange={(event) => update({ override: event.target.checked })} /> Allow later override</label>
                </div>
              </div>
            )}
            {error && <p role="alert" className="mb-4 text-xs text-destructive">{error}</p>}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <Button type="submit" disabled={busy || (editor?.mode === 'add' && !name)}>{busy ? 'Preparing…' : 'Review wiring'}</Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(preview)} onOpenChange={(open) => !open && !busy && setPreview(null)}>
        <AlertDialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm wiring change</AlertDialogTitle>
            <AlertDialogDescription>
              Review this exact diff. The write is rejected if the file changes after the preview. No secret values are included.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="my-4 space-y-2">{rows.map((row) => <DiffItem key={row.name} item={row.item} marker={row.marker} />)}</div>
          <p className="font-mono text-[11px] text-muted-foreground">diff {preview?.fingerprint.slice(0, 16)}… · backup: mxenv.config.json.bak</p>
          {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
          <AlertDialogFooter className="mt-5">
            <AlertDialogCancel disabled={busy}>Back</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void commit() }}>{busy ? 'Writing…' : 'Confirm wiring write'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
