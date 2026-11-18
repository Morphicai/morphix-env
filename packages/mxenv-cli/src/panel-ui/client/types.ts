export interface ScopeItem {
  id: string
  kind: 'global' | 'project' | string
  name: string
  path?: string
  available?: boolean
}

export interface ProviderFile {
  name?: string
  path?: string
  encrypted?: boolean
  exists?: boolean
}

export interface ProviderDetails {
  env?: string
  envPinned?: boolean
  paths?: string[]
  files?: ProviderFile[]
  service?: string
  keys?: string[]
  project?: string
  config?: string
  plugin?: string
}

export interface WiringSource {
  provider: string
  files?: string[]
  paths?: string[]
  env?: string
  envPrefix?: string
  keyPath?: string
  service?: string
  keys?: string[]
  platform?: 'macos' | 'linux' | 'windows'
  linuxStore?: 'secret-service' | 'keyutils'
  project?: string
  config?: string
  plugin?: string
  command?: string[]
  optional?: boolean
  override?: boolean
}

export interface ProviderState {
  name: string
  provider: string
  status: string
  details: ProviderDetails
  keyCount: number
  order: number
  override?: boolean
  config?: WiringSource
}

export type WiringAction =
  | { type: 'add-source' | 'update-source'; name: string; source: WiringSource }
  | { type: 'remove-source'; name: string }
  | { type: 'migrate-legacy' }

export interface WiringDiffItem {
  name: string
  provider?: string
  files?: string[]
  paths?: string[]
  env?: string
  service?: string
  keyCount?: number
  profiles?: string[]
}

export interface WiringPreview {
  configPath: string
  fingerprint: string
  before: WiringDiffItem[]
  after: WiringDiffItem[]
}

export interface WiringEditorState {
  mode: 'add' | 'edit' | 'remove' | 'migrate'
  source?: ProviderState
}

export interface PanelKey {
  key: string
  provider: string
  source: string
  fileIndex?: number
  inherited?: boolean
}

export interface ScopeSnapshot {
  scope?: string
  profile: string
  legacy: boolean
  sources: ProviderState[]
  keys: PanelKey[]
}

export interface WriteTarget {
  key: string
  provider: string
  source: string
  fileIndex?: number
}

export interface EditorState extends WriteTarget {
  mode: 'add' | 'update'
  value: string
  /** Agent 输入请求附带的说明（仅展示，不落盘、不含值）。 */
  reason?: string
}

export type PendingAction =
  | { type: 'set' }
  | { type: 'delete'; target: WriteTarget }

export interface RevealedValue {
  key: string
  source: string
  value: string
}

export function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    __mx_global_dotenv: 'global baseline',
    __mx_legacy_dotenvx: 'global baseline',
    __mx_local: 'local files',
    __mx_dotenvx: 'dotenvx files',
  }
  return labels[source] ?? source
}

export function canWrite(provider: string): boolean {
  return provider === 'local' || provider === 'dotenvx' || provider === 'os-keychain'
}

export function canDelete(provider: string): boolean {
  return provider === 'local' || provider === 'dotenvx'
}
