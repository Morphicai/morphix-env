// Shared state contract between the editor server (src/editor.ts) and the
// React UI. The server renders this state to HTML; the client bundle hydrates
// the same state. Only the `local` page ever carries values, by design.

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

interface BaseState {
  token: string
  profileName: string
}

export type EditorUiState = BaseState & (
  | { page: 'profile'; sourceStatuses: SourceStatusRow[]; provenance: ProvenanceRow[] }
  | { page: 'local'; sourceName: string; files: string[]; fileIndex: number; content: string }
  | { page: 'dotenvx'; sourceName: string; files: string[]; fileIndex: number }
  | { page: 'keychain'; sourceName: string; service: string; accounts: string[] }
  | { page: 'provider'; sourceName: string; provider: string; url: string | null }
  | { page: 'saved' }
  | { page: 'error'; code: number; title: string; message: string }
)
