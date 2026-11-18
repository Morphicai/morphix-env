import { Copy, Eye, EyeOff, Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { canDelete, canWrite, sourceLabel, type PanelKey, type RevealedValue, type WriteTarget } from '@/types'

interface KeyTableProps {
  keys: PanelKey[]
  locked: boolean
  loading: boolean
  revealed: RevealedValue | null
  onReveal: (key: PanelKey) => void
  onHide: () => void
  onCopy: (key: PanelKey) => void
  onEdit: (target: WriteTarget) => void
  onDelete: (target: WriteTarget) => void
}

function targetFor(key: PanelKey): WriteTarget {
  return {
    key: key.key,
    provider: key.provider,
    source: key.source,
    fileIndex: key.fileIndex,
  }
}

export function KeyTable({
  keys,
  locked,
  loading,
  revealed,
  onReveal,
  onHide,
  onCopy,
  onEdit,
  onDelete,
}: KeyTableProps) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b px-4 py-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Keys</CardTitle>
          <span className="text-xs text-muted-foreground">{loading ? 'Refreshing…' : `${keys.length} key(s) · names only`}</span>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-muted/35 text-[11px] tracking-wide text-muted-foreground uppercase">
            <tr>
              <th className="px-4 py-2.5 font-medium">Key</th>
              <th className="px-3 py-2.5 font-medium">Provider</th>
              <th className="px-3 py-2.5 font-medium">Source</th>
              <th className="w-16 px-3 py-2.5 font-medium">Order</th>
              <th className="w-36 px-4 py-2.5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {keys.map((key, index) => {
              const target = targetFor(key)
              const writable = canWrite(key.provider) && !key.inherited
              const deletable = canDelete(key.provider) && !key.inherited
              const rowRevealed = revealed?.key === key.key && revealed.source === key.source
              return (
                <tr
                  key={`${key.source}:${key.key}`}
                  className={`transition-colors hover:bg-muted/20 ${rowRevealed ? 'bg-amber-500/5' : ''}`}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-xs font-medium break-all">{key.key}</code>
                      {key.inherited && <Badge variant="secondary" className="text-[10px]">inherited</Badge>}
                    </div>
                    {rowRevealed && (
                      <div className="mt-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[10px] tracking-wide text-amber-700 uppercase dark:text-amber-400">revealed · hides after 90 seconds</span>
                          <span className="flex gap-0.5">
                            <Button type="button" variant="ghost" size="icon-sm" title="Copy value" aria-label={`Copy ${key.key}`} onClick={() => onCopy(key)}>
                              <Copy />
                            </Button>
                            <Button type="button" variant="ghost" size="icon-sm" title="Hide value now" aria-label={`Hide ${key.key}`} onClick={onHide}>
                              <EyeOff />
                            </Button>
                          </span>
                        </div>
                        <code className="mt-1 block font-mono text-xs break-all whitespace-pre-wrap">{revealed.value}</code>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{key.provider}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{sourceLabel(key.source)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{index + 1}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-0.5">
                      {rowRevealed ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          title="Hide value"
                          aria-label={`Hide ${key.key}`}
                          onClick={onHide}
                        >
                          <EyeOff />
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          title="Reveal for 90 seconds"
                          aria-label={`Reveal ${key.key}`}
                          disabled={locked}
                          onClick={() => onReveal(key)}
                        >
                          <Eye />
                        </Button>
                      )}
                      {writable && (
                        <Button type="button" variant="ghost" size="icon-sm" title="Set value" aria-label={`Edit ${key.key}`} disabled={locked} onClick={() => onEdit(target)}>
                          <Pencil />
                        </Button>
                      )}
                      {deletable && (
                        <Button type="button" variant="ghost" size="icon-sm" title="Delete key" aria-label={`Delete ${key.key}`} disabled={locked} onClick={() => onDelete(target)}>
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {keys.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-xs text-muted-foreground">{loading ? 'Loading key names…' : 'No keys in this scope.'}</td></tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}
