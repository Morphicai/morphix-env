import { FolderGit2, Globe2 } from 'lucide-react'
import { cn } from 'cn'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ScopeItem } from '@/types'

interface ScopeSidebarProps {
  scopes: ScopeItem[]
  activeScope: string
  onSelect: (scope: string) => void
}

export function ScopeSidebar({ scopes, activeScope, onSelect }: ScopeSidebarProps) {
  return (
    <Card className="h-fit gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center justify-between text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
          Scopes
          <span>{scopes.length}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 px-2">
        {scopes.map((scope) => {
          const Icon = scope.kind === 'global' ? Globe2 : FolderGit2
          return (
            <button
              key={scope.id}
              type="button"
              className={cn(
                'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                'hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                activeScope === scope.id && 'bg-accent text-accent-foreground',
                scope.available === false && 'cursor-not-allowed opacity-45',
              )}
              disabled={scope.available === false}
              title={scope.path ?? scope.name}
              onClick={() => onSelect(scope.id)}
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{scope.name}</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground capitalize">{scope.kind}</span>
              </span>
            </button>
          )
        })}
        {scopes.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted-foreground">Loading scopes…</p>}
      </CardContent>
    </Card>
  )
}
