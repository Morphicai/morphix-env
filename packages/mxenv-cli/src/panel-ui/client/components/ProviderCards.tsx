import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from 'cn'
import { sourceLabel, type ProviderState, type WiringEditorState } from '@/types'

export interface DoctorResult {
  status: string
  keyCount: number
  durationMs: number
}

interface ProviderCardsProps {
  providers: ProviderState[]
  locked: boolean
  legacy: boolean
  canEditWiring: boolean
  testingSource: string
  doctorResults: Record<string, DoctorResult | undefined>
  onAddKey: (source: string) => void
  onEditWiring: (editor: WiringEditorState) => void
  onTestSource: (source: string) => void
}

function detail(provider: ProviderState): string {
  const d = provider.details
  if (provider.provider === 'infisical') {
    return `env: ${d.env || 'unpinned'}${d.envPinned ? ' (pinned)' : ''} · ${(d.paths || []).join(', ')}`
  }
  if (provider.provider === 'local' || provider.provider === 'dotenvx') {
    const files = d.files || []
    return `${files.length} file(s) · ${files.filter((f) => f.encrypted).length} encrypted · ${files.filter((f) => !f.exists).length} missing`
  }
  if (provider.provider === 'os-keychain') return `${d.service || ''} · ${(d.keys || []).length} declared keys`
  if (provider.provider === 'doppler') return `${d.project || ''} / ${d.config || ''}`
  if (provider.provider === 'plugin') return `${d.plugin || ''} · ${(d.keys || []).length} declared keys`
  return ''
}

export function ProviderCards({
  providers,
  locked,
  legacy,
  canEditWiring,
  testingSource,
  doctorResults,
  onAddKey,
  onEditWiring,
  onTestSource,
}: ProviderCardsProps) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Providers</h2>
        <div className="flex items-center gap-2">
          {legacy && canEditWiring && (
            <Button type="button" size="sm" variant="outline" disabled={locked} onClick={() => onEditWiring({ mode: 'migrate' })}>
              Migrate legacy wiring
            </Button>
          )}
          {canEditWiring && !legacy && (
            <Button type="button" size="sm" variant="outline" disabled={locked} onClick={() => onEditWiring({ mode: 'add' })}>
              <Plus /> Add source
            </Button>
          )}
        </div>
      </div>
      {legacy && canEditWiring && (
        <p className="mb-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          This project uses legacy flat wiring. Review the migration diff to enable per-source editing; no env file or provider value is changed.
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {providers.map((provider) => {
          const doctor = doctorResults[provider.name]
          return (
            <div key={`${provider.name}:${provider.order}`} className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2">
                <span className={cn(
                  'size-2 shrink-0 rounded-full',
                  provider.status === 'loaded' && 'bg-emerald-500',
                  provider.status === 'empty' && 'bg-muted-foreground',
                  !['loaded', 'empty'].includes(provider.status) && 'bg-amber-500',
                )} />
                <span className="truncate text-sm font-medium">{sourceLabel(provider.name)}</span>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">{provider.provider} · {provider.status}</div>
              <div className="mt-2 min-h-8 break-all text-xs leading-4 text-muted-foreground">{detail(provider)}</div>
              <div className="mt-3 text-xs text-muted-foreground">
                {provider.keyCount} key(s) · order {provider.order + 1}{provider.override ? ' · override' : ''}
              </div>
              {doctor && <div className="mt-2 text-[11px] text-muted-foreground">doctor: {doctor.status} · {doctor.keyCount} key(s) · {doctor.durationMs}ms</div>}
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={testingSource === provider.name}
                  onClick={() => onTestSource(provider.name)}
                >
                  <RefreshCw className={cn(testingSource === provider.name && 'animate-spin')} /> Test
                </Button>
                {(provider.provider === 'local' || provider.provider === 'dotenvx') && (
                  <Button type="button" size="xs" variant="ghost" disabled={locked} onClick={() => onAddKey(provider.name)}>
                    <Plus /> Add key
                  </Button>
                )}
                {canEditWiring && !legacy && !provider.name.startsWith('__mx') && (
                  <>
                    <Button type="button" size="xs" variant="ghost" disabled={locked} onClick={() => onEditWiring({ mode: 'edit', source: provider })}>
                      <Pencil /> Edit wiring
                    </Button>
                    <Button type="button" size="xs" variant="ghost" disabled={locked} onClick={() => onEditWiring({ mode: 'remove', source: provider })}>
                      <Trash2 /> Remove
                    </Button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
