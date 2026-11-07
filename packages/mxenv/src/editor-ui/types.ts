// Shared state contract between the editor server (src/editor.ts) and the
// React UI. The server renders this state to HTML; the client bundle hydrates
// the same state. Values enter a page only through explicit editing (local
// rows) or per-key reveal (dotenvx/keychain, single value resident) — never
// through listings, CLI output, or audit events.

export interface SourceStatusRow {
  name: string
  provider: string
  availability: string
  keyCount: number
  /** A local editor page exists for this source (entry resolved in the profile). */
  editable: boolean
}

export interface ProvenanceRow {
  key: string
  source: string
  provider: string
  overriddenSources: string[]
}

export interface SourceNavRow {
  name: string
  provider: string
}

/** At most one revealed value is resident in a rendered page at a time. */
export interface RevealedValue {
  key: string
  value: string
}

interface BaseState {
  token: string
  profileName: string
  /** Sources of the composed profile, for the header switcher (names only). */
  sources: SourceNavRow[]
}

export type EditorUiState = BaseState & (
  | { page: 'profile'; sourceStatuses: SourceStatusRow[]; provenance: ProvenanceRow[] }
  | { page: 'local'; sourceName: string; files: string[]; fileIndex: number; content: string }
  | { page: 'dotenvx'; sourceName: string; files: string[]; fileIndex: number; keyNames: string[]; formKey?: string; revealed?: RevealedValue }
  | { page: 'keychain'; sourceName: string; service: string; accounts: string[]; revealed?: RevealedValue }
  | { page: 'provider'; sourceName: string; provider: string; url: string | null }
  | { page: 'saved'; sourceName: string; action: 'set' | 'delete'; key: string; fileIndex: number }
  | { page: 'closed' }
  | { page: 'error'; code: number; title: string; message: string }
)
