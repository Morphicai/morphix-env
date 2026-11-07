import { useState, type ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { EditorUiState } from './types'

function basePath(state: { token: string }): string {
  return `/${state.token}`
}

function sourcePath(state: { token: string }, sourceName: string): string {
  return `${basePath(state)}/source/${encodeURIComponent(sourceName)}`
}

// Platform-reserved source IDs (mxenv-core composition constants) get friendly
// display names; the raw ID stays visible in detailed views.
const SOURCE_DISPLAY_NAMES: Record<string, string> = {
  __mx_global_dotenv: 'Global store',
  __mx_legacy_local: 'Local override',
  __mx_legacy_infisical: 'Infisical (legacy)',
  __mx_cli_local_override: 'CLI local override',
}

function sourceDisplayName(name: string): string {
  return SOURCE_DISPLAY_NAMES[name] ?? name
}

function statusTone(availability: string): string {
  if (availability === 'ok') return 'text-success'
  if (availability === 'missing') return 'text-warning'
  if (availability === 'error') return 'text-error'
  return 'text-muted-foreground'
}

function BrandMark(): ReactNode {
  // mx geometric monogram (designed mark) — same geometry as the favicon.
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" role="img" aria-label="mxenv" className="shrink-0">
      <rect width="32" height="32" rx="8" fill="#005EFF" />
      <g fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 21V11l4.5 5L14 11v10" />
        <path d="M20 11l7 10M27 11l-7 10" />
      </g>
    </svg>
  )
}

function ExternalIcon(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 3H3.5A1.5 1.5 0 002 4.5v8A1.5 1.5 0 003.5 14h8a1.5 1.5 0 001.5-1.5V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9 2h5v5M14 2l-6.5 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CheckIcon(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Page({ state, title, subtitle, children }: {
  state: EditorUiState
  title: string
  subtitle?: ReactNode
  children?: ReactNode
}): ReactNode {
  const currentSource = 'sourceName' in state ? state.sourceName : null
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b bg-card">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <BrandMark />
            <span className="font-semibold tracking-tight">mxenv</span>
            <Badge variant="secondary" className="font-mono text-[11px] font-normal text-muted-foreground">
              v{state.version}
            </Badge>
            <Separator orientation="vertical" className="mx-1 h-4" />
            <span className="truncate text-sm text-muted-foreground">Secret editor</span>
          </div>
          <Badge variant="outline" className="gap-1.5 font-normal" title="Active profile" data-testid="profile-name">
            <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
            {state.profileName}
          </Badge>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1.5 overflow-x-auto px-6 pb-2" aria-label="Sources">
          <a
            data-testid="source-chip"
            className={cn(
              'inline-flex shrink-0 items-center rounded-full px-3 py-1 text-sm transition-colors',
              currentSource === null
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
            href={basePath(state)}
          >
            All sources
          </a>
          {state.sources.map((source) => (
            <a
              key={source.name}
              data-testid="source-chip"
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors',
                currentSource === source.name
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
              href={sourcePath(state, source.name)}
            >
              <span className="text-[10px] uppercase tracking-wide opacity-70">{source.provider}</span>
              {sourceDisplayName(source.name)}
            </a>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {children}
      </main>
      <footer className="mx-auto max-w-5xl px-6 pb-8 text-xs text-muted-foreground">
        One-time local session · values never return to the terminal · 15-minute lifetime · end the session explicitly when done
      </footer>
    </div>
  )
}

function SectionCard({ title, count, description, children }: {
  title: string
  count?: number
  description?: ReactNode
  children: ReactNode
}): ReactNode {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {typeof count === 'number' && (
          <Badge variant="secondary" className="font-mono font-normal">{count}</Badge>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function FileSelect({ base, files, fileIndex }: { base: string; files: string[]; fileIndex: number }): ReactNode {
  return (
    <div className="space-y-2">
      <Label>File</Label>
      <Select
        value={String(fileIndex)}
        onValueChange={(value) => {
          window.location.href = `${base}?fileIndex=${encodeURIComponent(value)}`
        }}
      >
        <SelectTrigger className="max-w-md font-mono text-xs" aria-label="File">
          <SelectValue placeholder={files[0] ?? ''} />
        </SelectTrigger>
        <SelectContent>
          {files.map((file, index) => (
            <SelectItem value={String(index)} key={`${file}:${index}`}>
              <span className="font-mono text-xs">{file}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function ProfilePage({ state }: { state: Extract<EditorUiState, { page: 'profile' }> }): ReactNode {
  return (
    <Page
      state={state}
      title="Profile overview"
      subtitle={<>Profile <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{state.profileName}</code> — this summary deliberately never displays values.</>}
    >
      <SectionCard title="Sources" count={state.sourceStatuses.length}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Keys</TableHead>
              <TableHead className="text-right" aria-label="Actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.sourceStatuses.map((row) => (
              <TableRow key={row.name}>
                <TableCell>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{sourceDisplayName(row.name)}</span>
                    <code className="text-xs text-muted-foreground" data-testid="src-name">{row.name}</code>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-normal">{row.provider}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className={cn('font-mono font-normal', statusTone(row.availability))}>
                    {row.availability}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-mono text-sm">{row.keyCount}</TableCell>
                <TableCell className="text-right">
                  {row.editable
                    ? <Button asChild variant="link" size="sm" className="px-0"><a href={sourcePath(state, row.name)}>Open →</a></Button>
                    : <span className="text-muted-foreground">—</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>
      <SectionCard title="Resolved keys" count={state.provenance.length}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead>Winning source</TableHead>
              <TableHead>Provider</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.provenance.map((row) => (
              <TableRow key={row.key}>
                <TableCell><code className="font-mono text-xs">{row.key}</code></TableCell>
                <TableCell>
                  <div className="flex flex-col gap-0.5">
                    <span>{sourceDisplayName(row.source)}</span>
                    <code className="text-xs text-muted-foreground">{row.source}</code>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-normal">{row.provider}</Badge>
                  {row.overriddenSources.length > 0 && (
                    <span className="ml-2 text-xs text-muted-foreground">overrides {row.overriddenSources.join(', ')}</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>
    </Page>
  )
}

// ---------- local file: structured KEY=VALUE editor ----------
// The file stays the source of truth: parse each line into an editable row,
// keep everything that is not KEY=VALUE (comments, blank lines, multi-line
// value continuations) verbatim, and serialize back to a single `content`
// field so the server-side POST contract never changes. Without JS the
// hidden field still carries the unchanged file, so a no-JS submit is a
// harmless no-op instead of data loss.

type EnvRow =
  | { kind: 'var'; prefix: string; key: string; sep: string; value: string }
  | { kind: 'raw'; text: string }

const ENV_VAR_LINE = /^(\s*)(export\s+)?([A-Za-z_][A-Za-z0-9_.]*)(\s*=\s*)(.*)$/

function parseEnvRows(content: string): EnvRow[] {
  return content.split('\n').map((line) => {
    const match = ENV_VAR_LINE.exec(line)
    if (!match) return { kind: 'raw', text: line }
    return { kind: 'var', prefix: match[1] + (match[2] || ''), key: match[3], sep: match[4], value: match[5] }
  })
}

function serializeEnvRows(rows: EnvRow[]): string {
  return rows
    .filter((row) => row.kind === 'raw' || row.key.trim() !== '')
    .map((row) => (row.kind === 'raw' ? row.text : `${row.prefix}${row.key}${row.sep}${row.value}`))
    .join('\n')
}

function LocalPage({ state }: { state: Extract<EditorUiState, { page: 'local' }> }): ReactNode {
  const [rows, setRows] = useState<EnvRow[]>(() => parseEnvRows(state.content))
  const serialized = serializeEnvRows(rows)
  const updateVarRow = (index: number, patch: Partial<Extract<EnvRow, { kind: 'var' }>>): void => {
    setRows((current) => current.map((row, i) => (i === index && row.kind === 'var' ? { ...row, ...patch } : row)))
  }
  const removeRow = (index: number): void => {
    setRows((current) => current.filter((_, i) => i !== index))
  }
  const addRow = (): void => {
    setRows((current) => [...current, { kind: 'var', prefix: '', key: '', sep: '=', value: '' }])
  }
  return (
    <Page
      state={state}
      title={`Edit ${sourceDisplayName(state.sourceName)}`}
      subtitle="Changes are written only to the selected local file. Values stay in this browser session and never return to CLI output."
    >
      <SectionCard title="File">
        <FileSelect base={sourcePath(state, state.sourceName)} files={state.files} fileIndex={state.fileIndex} />
      </SectionCard>
      <SectionCard title="Variables">
        <form method="post" action={`${sourcePath(state, state.sourceName)}/local`} className="space-y-4">
          <input type="hidden" name="fileIndex" value={state.fileIndex} />
          <input type="hidden" name="content" value={serialized} readOnly />
          <div className="space-y-2">
            {rows.map((row, index) => {
              if (row.kind === 'raw') {
                if (row.text.trim() === '') return null
                return <div className="whitespace-pre-wrap rounded-md bg-muted/60 px-3 py-1.5 font-mono text-xs text-muted-foreground" key={index}>{row.text}</div>
              }
              return (
                <div className="flex items-center gap-2" key={index}>
                  <Input
                    className="w-2/5 font-mono text-xs"
                    value={row.key}
                    onChange={(event) => updateVarRow(index, { key: event.target.value })}
                    aria-label={`Key of row ${index + 1}`}
                    pattern="[A-Za-z_][A-Za-z0-9_.]*"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <span className="text-muted-foreground" aria-hidden="true">=</span>
                  <Input
                    className="flex-1 font-mono text-xs"
                    value={row.value}
                    onChange={(event) => updateVarRow(index, { value: event.target.value })}
                    aria-label={`Value of row ${index + 1}`}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => removeRow(index)} aria-label={`Remove row ${index + 1}`}>
                    ✕
                  </Button>
                </div>
              )
            })}
            {rows.every((row) => row.kind !== 'var') && (
              <p className="text-sm text-muted-foreground">No variables in this file yet — add the first one below.</p>
            )}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addRow}>+ Add variable</Button>
          <div className="flex justify-end">
            <Button type="submit">Save local file</Button>
          </div>
        </form>
        <p className="mt-4 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          Rows are written back as KEY=value. Comments, blank lines and anything that is not KEY=VALUE are preserved exactly as they appear;
          rows with an empty key are skipped on save.
        </p>
      </SectionCard>
    </Page>
  )
}

function DotenvxPage({ state }: { state: Extract<EditorUiState, { page: 'dotenvx' }> }): ReactNode {
  const action = `${sourcePath(state, state.sourceName)}/dotenvx`
  return (
    <Page
      state={state}
      title={`Edit ${sourceDisplayName(state.sourceName)}`}
      subtitle="This file is managed by dotenvx. Values appear only when you reveal them — one at a time — and stay in this browser session."
    >
      <SectionCard title="Existing keys" count={state.keyNames.length}>
        {state.keyNames.length === 0
          ? <p className="text-sm text-muted-foreground">No keys in this file yet — add the first one below.</p>
          : (
            <div className="divide-y">
              {state.keyNames.map((key, index) => (
                <div className="flex flex-wrap items-center gap-2 py-2.5 first:pt-0 last:pb-0" key={key}>
                  <code className="font-mono text-xs">{key}</code>
                  {state.revealed?.key === key && (
                    <code className="rounded bg-muted px-2 py-1 font-mono text-xs" data-testid="revealed-value">{state.revealed.value}</code>
                  )}
                  <span className="ml-auto flex items-center gap-1">
                    {state.revealed?.key === key
                      ? <Button asChild variant="ghost" size="sm"><a href={`${sourcePath(state, state.sourceName)}?fileIndex=${state.fileIndex}`}>Hide</a></Button>
                      : (
                        <form method="post" action={action}>
                          <input type="hidden" name="action" value="reveal" />
                          <input type="hidden" name="key" value={key} />
                          <input type="hidden" name="fileIndex" value={state.fileIndex} />
                          <Button type="submit" variant="ghost" size="sm">Show value</Button>
                        </form>
                      )}
                    <Button asChild variant="ghost" size="sm">
                      <a href={`${sourcePath(state, state.sourceName)}?fileIndex=${state.fileIndex}&key=${encodeURIComponent(key)}`}>Edit</a>
                    </Button>
                    <form id={`dotenvx-delete-${index}`} method="post" action={action} className="hidden">
                      <input type="hidden" name="action" value="delete" />
                      <input type="hidden" name="key" value={key} />
                      <input type="hidden" name="fileIndex" value={state.fileIndex} />
                    </form>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">Delete</Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete “{key}”?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This removes the key from the encrypted file. The stored value is destroyed and cannot be recovered from mxenv.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction variant="destructive" type="submit" form={`dotenvx-delete-${index}`}>
                            Delete key
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </span>
                </div>
              ))}
            </div>
          )}
      </SectionCard>
      <SectionCard title="Add or replace a key">
        <FileSelect base={sourcePath(state, state.sourceName)} files={state.files} fileIndex={state.fileIndex} />
        <form method="post" action={action} className="mt-4 space-y-4">
          <input type="hidden" name="action" value="set" />
          <input type="hidden" name="fileIndex" value={state.fileIndex} />
          <div className="max-w-md space-y-2">
            <Label htmlFor="dotenvx-key">Key</Label>
            <Input id="dotenvx-key" name="key" required pattern="[A-Za-z_][A-Za-z0-9_.]*" autoComplete="off" spellCheck={false} className="font-mono text-xs" defaultValue={state.formKey ?? ''} data-testid="key-input" />
          </div>
          <div className="max-w-md space-y-2">
            <Label htmlFor="dotenvx-value">Value</Label>
            <Input id="dotenvx-value" name="value" type="password" required autoComplete="new-password" />
          </div>
          <div className="flex justify-end">
            <Button type="submit">Save encrypted value</Button>
          </div>
        </form>
        <p className="mt-4 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          Saving rewrites only the submitted key — every other key keeps its encrypted value untouched.
          Revealed values are shown one at a time and never leave this browser session.
          Values containing <code className="font-mono">$</code> sequences are refused: dotenvx expands them on every load path.
        </p>
      </SectionCard>
    </Page>
  )
}

function KeychainPage({ state }: { state: Extract<EditorUiState, { page: 'keychain' }> }): ReactNode {
  const action = `${sourcePath(state, state.sourceName)}/keychain`
  return (
    <Page
      state={state}
      title={`Edit ${sourceDisplayName(state.sourceName)}`}
      subtitle={<>Existing account names are shown; values appear only when you reveal them — one at a time. OS keychain service <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{state.service}</code>.</>}
    >
      <SectionCard title="Existing entries" count={state.accounts.length}>
        {state.accounts.length === 0
          ? <p className="text-sm text-muted-foreground">No entries yet — add the first one below.</p>
          : (
            <div className="divide-y">
              {state.accounts.map((account, index) => (
                <div className="flex flex-wrap items-center gap-2 py-2.5 first:pt-0 last:pb-0" key={account}>
                  <code className="font-mono text-xs">{account}</code>
                  {state.revealed?.key === account && (
                    <code className="rounded bg-muted px-2 py-1 font-mono text-xs" data-testid="revealed-value">{state.revealed.value}</code>
                  )}
                  <span className="ml-auto flex items-center gap-1">
                    {state.revealed?.key === account
                      ? <Button asChild variant="ghost" size="sm"><a href={sourcePath(state, state.sourceName)}>Hide</a></Button>
                      : (
                        <form method="post" action={action}>
                          <input type="hidden" name="action" value="reveal" />
                          <input type="hidden" name="account" value={account} />
                          <Button type="submit" variant="ghost" size="sm">Show value</Button>
                        </form>
                      )}
                    <form id={`keychain-delete-${index}`} method="post" action={action} className="hidden">
                      <input type="hidden" name="action" value="delete" />
                      <input type="hidden" name="account" value={account} />
                    </form>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">Delete</Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete “{account}”?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This removes the entry from the OS keychain service <code className="font-mono">{state.service}</code>.
                            The stored value is destroyed and cannot be recovered from mxenv.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction variant="destructive" type="submit" form={`keychain-delete-${index}`}>
                            Delete entry
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </span>
                </div>
              ))}
            </div>
          )}
      </SectionCard>
      <SectionCard title="Add or replace an entry">
        <form method="post" action={action} className="space-y-4">
          <input type="hidden" name="action" value="set" />
          <div className="max-w-md space-y-2">
            <Label htmlFor="keychain-account">Environment key</Label>
            <Input id="keychain-account" name="account" required autoComplete="off" spellCheck={false} className="font-mono text-xs" />
          </div>
          <div className="max-w-md space-y-2">
            <Label htmlFor="keychain-value">Value</Label>
            <Input id="keychain-value" name="value" type="password" required autoComplete="new-password" />
          </div>
          <div className="flex justify-end">
            <Button type="submit">Save to keychain</Button>
          </div>
        </form>
      </SectionCard>
    </Page>
  )
}

function ProviderPage({ state }: { state: Extract<EditorUiState, { page: 'provider' }> }): ReactNode {
  return (
    <Page
      state={state}
      title={sourceDisplayName(state.sourceName)}
      subtitle={<>This source is owned by <Badge variant="outline" className="font-normal">{state.provider}</Badge>. Values stay in that provider and are never displayed here.</>}
    >
      <SectionCard title="Remote provider">
        <p className="text-sm text-muted-foreground">
          mxenv composes keys from this provider but cannot edit them locally. Open the provider console to review or rotate values,
          then validate with <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">mxenv inspect</code>.
        </p>
        <div className="mt-4">
          {state.url
            ? <Button asChild><a href={state.url} target="_blank" rel="noreferrer">Open provider editor <ExternalIcon /></a></Button>
            : <span className="text-sm text-muted-foreground">No console URL configured for this provider.</span>}
        </div>
      </SectionCard>
    </Page>
  )
}

function SavedPage({ state }: { state: Extract<EditorUiState, { page: 'saved' }> }): ReactNode {
  const detail = state.key
    ? state.action === 'delete'
      ? <>Key <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{state.key}</code> was deleted.</>
      : <>Key <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{state.key}</code> was written.</>
    : 'The local file was saved.'
  return (
    <Page state={state} title="Saved" subtitle={undefined}>
      <SectionCard title="Saved">
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-success/10 text-success" aria-hidden="true">
            <CheckIcon />
          </div>
          <p className="text-sm">{detail} No value was written to terminal output or audit records.</p>
          <p className="max-w-md text-xs text-muted-foreground">
            The session is still open — continue editing or end it explicitly. It also ends on its own after 15 minutes.
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <Button asChild><a data-testid="continue-editing" href={`${sourcePath(state, state.sourceName)}?fileIndex=${state.fileIndex}`}>Continue editing</a></Button>
            <Button asChild variant="outline"><a href={basePath(state)}>All sources</a></Button>
            <form method="post" action={basePath(state)}>
              <input type="hidden" name="action" value="close" />
              <Button type="submit" variant="ghost" className="text-muted-foreground hover:text-destructive">End session</Button>
            </form>
          </div>
        </div>
      </SectionCard>
    </Page>
  )
}

function ClosedPage({ state }: { state: Extract<EditorUiState, { page: 'closed' }> }): ReactNode {
  return (
    <Page state={state} title="Session ended" subtitle={undefined}>
      <SectionCard title="Session ended">
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
            <CheckIcon />
          </div>
          <p className="text-sm">The local editor session is over and its server is shutting down. You can close this tab.</p>
        </div>
      </SectionCard>
    </Page>
  )
}

function ErrorPage({ state }: { state: Extract<EditorUiState, { page: 'error' }> }): ReactNode {
  return (
    <Page state={state} title={state.title} subtitle={undefined}>
      <SectionCard title={state.title}>
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive" aria-hidden="true">
            <span className="text-lg font-semibold">!</span>
          </div>
          <p className="max-w-md text-sm text-muted-foreground">{state.message}</p>
          <Button asChild variant="outline"><a href={basePath(state)}>Back to overview</a></Button>
        </div>
      </SectionCard>
    </Page>
  )
}

export function App({ state }: { state: EditorUiState }): ReactNode {
  switch (state.page) {
    case 'profile': return <ProfilePage state={state} />
    case 'local': return <LocalPage state={state} />
    case 'dotenvx': return <DotenvxPage state={state} />
    case 'keychain': return <KeychainPage state={state} />
    case 'provider': return <ProviderPage state={state} />
    case 'saved': return <SavedPage state={state} />
    case 'closed': return <ClosedPage state={state} />
    case 'error': return <ErrorPage state={state} />
  }
}
