import * as AlertDialog from '@radix-ui/react-alert-dialog'
import * as Select from '@radix-ui/react-select'
import { useState, type ReactNode } from 'react'
import type { EditorUiState } from './types'

function basePath(state: { token: string }): string {
  return `/${state.token}`
}

function sourcePath(state: { token: string }, sourceName: string): string {
  return `${basePath(state)}/source/${encodeURIComponent(sourceName)}`
}

function statusTone(availability: string): string {
  if (availability === 'ok') return 'ok'
  if (availability === 'missing') return 'warn'
  if (availability === 'error') return 'error'
  return 'muted'
}

function ChevronIcon(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
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

function Page({ state, title, subtitle, back = true, children }: {
  state: EditorUiState
  title: string
  subtitle?: ReactNode
  back?: boolean
  children?: ReactNode
}): ReactNode {
  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">mx</span>
          <span className="brand-name">mx-env</span>
          <span className="brand-divider" aria-hidden="true" />
          <span className="brand-crumb">Secret editor</span>
        </div>
        <div className="profile-chip" title="Active profile">
          <span className="profile-dot" aria-hidden="true" />
          <span className="profile-name">{state.profileName}</span>
        </div>
      </header>
      <main className="container">
        <div className="page-head">
          {back && <a className="back-link" href={basePath(state)}>← All sources</a>}
          <h1>{title}</h1>
          {subtitle && <p className="subtitle">{subtitle}</p>}
        </div>
        {children}
      </main>
      <footer className="footer">
        One-time local session · values never return to the terminal · the editor closes itself after a save
      </footer>
    </div>
  )
}

function Card({ title, count, children }: { title: string; count?: number; children: ReactNode }): ReactNode {
  return (
    <section className="card">
      <div className="card-head">
        <h2>{title}</h2>
        {typeof count === 'number' && <span className="count-pill">{count}</span>}
      </div>
      {children}
    </section>
  )
}

function FileSelect({ base, files, fileIndex }: { base: string; files: string[]; fileIndex: number }): ReactNode {
  return (
    <div className="field">
      <span className="field-label">File</span>
      <Select.Root
        value={String(fileIndex)}
        onValueChange={(value) => {
          window.location.href = `${base}?fileIndex=${encodeURIComponent(value)}`
        }}
      >
        <Select.Trigger className="select-trigger" aria-label="File">
          <span className="select-value">{files[fileIndex] ?? files[0] ?? ''}</span>
          <Select.Icon className="select-icon">
            <ChevronIcon />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="select-content" position="popper" sideOffset={6}>
            <Select.Viewport className="select-viewport">
              {files.map((file, index) => (
                <Select.Item className="select-item" value={String(index)} key={`${file}:${index}`}>
                  <Select.ItemText>{file}</Select.ItemText>
                  <Select.ItemIndicator className="select-indicator">✓</Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  )
}

function ProfilePage({ state }: { state: Extract<EditorUiState, { page: 'profile' }> }): ReactNode {
  return (
    <Page
      state={state}
      title="Profile overview"
      back={false}
      subtitle={<>Profile <code className="inline-code">{state.profileName}</code> — this summary deliberately never displays values.</>}
    >
      <Card title="Sources" count={state.sourceStatuses.length}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Provider</th>
                <th>Status</th>
                <th className="col-num">Keys</th>
                <th className="col-num" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {state.sourceStatuses.map((row) => (
                <tr key={row.name}>
                  <td><code className="src-name">{row.name}</code></td>
                  <td><span className="provider-badge">{row.provider}</span></td>
                  <td><span className={`badge ${statusTone(row.availability)}`}>{row.availability}</span></td>
                  <td className="col-num">{row.keyCount}</td>
                  <td className="col-num">
                    {row.editable
                      ? <a className="table-action" href={sourcePath(state, row.name)}>Open →</a>
                      : <span className="table-action is-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Resolved keys" count={state.provenance.length}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Winning source</th>
                <th>Provider</th>
              </tr>
            </thead>
            <tbody>
              {state.provenance.map((row) => (
                <tr key={row.key}>
                  <td><code className="key-name">{row.key}</code></td>
                  <td>{row.source}</td>
                  <td>
                    {row.provider}
                    {row.overriddenSources.length > 0 && (
                      <span className="override-note"> · overrides {row.overriddenSources.join(', ')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
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
      title={`Edit ${state.sourceName}`}
      subtitle="Changes are written only to the selected local file. Values stay in this browser session and never return to CLI output."
    >
      <section className="card">
        <FileSelect base={sourcePath(state, state.sourceName)} files={state.files} fileIndex={state.fileIndex} />
        <form method="post" action={`${sourcePath(state, state.sourceName)}/local`} className="form">
          <input type="hidden" name="fileIndex" value={state.fileIndex} />
          <input type="hidden" name="content" value={serialized} readOnly />
          <div className="field">
            <span className="field-label">Variables</span>
            <div className="kv-list">
              {rows.map((row, index) => {
                if (row.kind === 'raw') {
                  if (row.text.trim() === '') return null
                  return <div className="kv-raw" key={index}>{row.text}</div>
                }
                return (
                  <div className="kv-row" key={index}>
                    <input
                      className="kv-key"
                      value={row.key}
                      onChange={(event) => updateVarRow(index, { key: event.target.value })}
                      aria-label={`Key of row ${index + 1}`}
                      pattern="[A-Za-z_][A-Za-z0-9_.]*"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <span className="kv-eq" aria-hidden="true">=</span>
                    <input
                      className="kv-value"
                      value={row.value}
                      onChange={(event) => updateVarRow(index, { value: event.target.value })}
                      aria-label={`Value of row ${index + 1}`}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button type="button" className="kv-remove" onClick={() => removeRow(index)} aria-label={`Remove row ${index + 1}`}>✕</button>
                  </div>
                )
              })}
              {rows.every((row) => row.kind !== 'var') && <p className="empty">No variables in this file yet — add the first one below.</p>}
            </div>
            <button type="button" className="btn btn-ghost kv-add" onClick={addRow}>+ Add variable</button>
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" type="submit">Save local file</button>
          </div>
        </form>
        <p className="notice notice-info">
          Rows are written back as KEY=value. Comments, blank lines and anything that is not KEY=VALUE are preserved exactly as they appear;
          rows with an empty key are skipped on save.
        </p>
      </section>
    </Page>
  )
}

function DotenvxPage({ state }: { state: Extract<EditorUiState, { page: 'dotenvx' }> }): ReactNode {
  return (
    <Page
      state={state}
      title={`Edit ${state.sourceName}`}
      subtitle="This file is managed by dotenvx. Edit one key at a time so the provider can preserve encryption."
    >
      <section className="card">
        <FileSelect base={sourcePath(state, state.sourceName)} files={state.files} fileIndex={state.fileIndex} />
        <form method="post" action={`${sourcePath(state, state.sourceName)}/dotenvx`} className="form">
          <input type="hidden" name="fileIndex" value={state.fileIndex} />
          <div className="field">
            <span className="field-label">Key</span>
            <input className="input" name="key" required pattern="[A-Za-z_][A-Za-z0-9_]*" autoComplete="off" spellCheck={false} />
          </div>
          <div className="field">
            <span className="field-label">Value</span>
            <input className="input" name="value" type="password" required autoComplete="new-password" />
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" type="submit">Save encrypted value</button>
          </div>
        </form>
        <p className="notice notice-info">Existing encrypted values are never decrypted into this page — only the key you submit is rewritten.</p>
      </section>
    </Page>
  )
}

function KeychainPage({ state }: { state: Extract<EditorUiState, { page: 'keychain' }> }): ReactNode {
  const action = `${sourcePath(state, state.sourceName)}/keychain`
  return (
    <Page
      state={state}
      title={`Edit ${state.sourceName}`}
      subtitle={<>Existing account names are shown; values are never revealed. OS keychain service <code className="inline-code">{state.service}</code>.</>}
    >
      <Card title="Existing entries" count={state.accounts.length}>
        {state.accounts.length === 0
          ? <p className="empty">No entries yet — add the first one below.</p>
          : (
            <ul className="account-list">
              {state.accounts.map((account, index) => (
                <li className="account-row" key={account}>
                  <code className="src-name">{account}</code>
                  <form id={`keychain-delete-${index}`} method="post" action={action}>
                    <input type="hidden" name="action" value="delete" />
                    <input type="hidden" name="account" value={account} />
                  </form>
                  <AlertDialog.Root>
                    <AlertDialog.Trigger asChild>
                      <button type="button" className="btn btn-danger-ghost">Delete</button>
                    </AlertDialog.Trigger>
                    <AlertDialog.Portal>
                      <AlertDialog.Overlay className="dialog-overlay" />
                      <AlertDialog.Content className="dialog-content">
                        <AlertDialog.Title className="dialog-title">Delete “{account}”?</AlertDialog.Title>
                        <AlertDialog.Description className="dialog-description">
                          This removes the entry from the OS keychain service <code className="inline-code">{state.service}</code>.
                          The stored value is destroyed and cannot be recovered from mx-env.
                        </AlertDialog.Description>
                        <div className="dialog-actions">
                          <AlertDialog.Cancel className="btn btn-ghost">Cancel</AlertDialog.Cancel>
                          <AlertDialog.Action asChild>
                            <button type="submit" form={`keychain-delete-${index}`} className="btn btn-danger">Delete entry</button>
                          </AlertDialog.Action>
                        </div>
                      </AlertDialog.Content>
                    </AlertDialog.Portal>
                  </AlertDialog.Root>
                </li>
              ))}
            </ul>
            )}
      </Card>
      <Card title="Add or replace an entry">
        <form method="post" action={action} className="form">
          <input type="hidden" name="action" value="set" />
          <div className="field">
            <span className="field-label">Environment key</span>
            <input className="input" name="account" required pattern="[A-Za-z_][A-Za-z0-9_]*" autoComplete="off" spellCheck={false} />
          </div>
          <div className="field">
            <span className="field-label">Value</span>
            <input className="input" name="value" type="password" required autoComplete="new-password" />
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" type="submit">Save to keychain</button>
          </div>
        </form>
      </Card>
    </Page>
  )
}

function ProviderPage({ state }: { state: Extract<EditorUiState, { page: 'provider' }> }): ReactNode {
  return (
    <Page
      state={state}
      title={state.sourceName}
      subtitle={<>This source is owned by <span className="provider-badge">{state.provider}</span>. Values stay in that provider and are never displayed here.</>}
    >
      <section className="card provider-card">
        <p className="provider-hint">
          mx-env composes keys from this provider but cannot edit them locally. Open the provider console to review or rotate values,
          then validate with <code className="inline-code">mx-env inspect</code>.
        </p>
        {state.url
          ? <a className="btn btn-primary" href={state.url} target="_blank" rel="noreferrer">Open provider editor <ExternalIcon /></a>
          : <span className="empty">No console URL configured for this provider.</span>}
      </section>
    </Page>
  )
}

function SavedPage({ state }: { state: Extract<EditorUiState, { page: 'saved' }> }): ReactNode {
  return (
    <Page state={state} title="Saved" subtitle={undefined}>
      <section className="card saved-card">
        <div className="saved-icon" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="saved-title">Saved</h2>
        <p className="saved-text">The selected source was updated. No value was written to terminal output or audit records.</p>
        <p className="saved-hint">You can close this page — the local editor session ends automatically.</p>
        <a className="btn btn-ghost" href={basePath(state)}>Back to overview</a>
      </section>
    </Page>
  )
}

function ErrorPage({ state }: { state: Extract<EditorUiState, { page: 'error' }> }): ReactNode {
  return (
    <Page state={state} title={state.title} back={false} subtitle={undefined}>
      <section className="card saved-card">
        <div className="saved-icon is-error" aria-hidden="true">!</div>
        <h2 className="saved-title">{state.title}</h2>
        <p className="saved-text">{state.message}</p>
        <a className="btn btn-ghost" href={basePath(state)}>Back to overview</a>
      </section>
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
    case 'error': return <ErrorPage state={state} />
  }
}
