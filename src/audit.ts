import { appendFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export interface AuditEvent {
  timestamp: string
  profile: string
  sources: string[]
  keys: string[]
  outcome: 'success' | 'failure'
  exitCode?: number
  durationMs: number
  /**
   * Invocation channel. `shim` means the run came through a PATH shim. This is
   * an observational dimension, not a security assertion: the marker travels
   * as an env var and is forgeable by any same-uid process. `editor` marks
   * actions taken in the one-shot visual editor (values never enter events).
   */
  via?: 'cli' | 'shim' | 'editor'
  /**
   * Editor action kind for `via: 'editor'` events. Value-free by contract:
   * events carry key names only, never values.
   */
  action?: 'set' | 'delete' | 'reveal' | 'close'
}

/** Best-effort local audit that intentionally has no values or command arguments. */
export function writeAudit(event: AuditEvent, homeDir = homedir()): void {
  try {
    const dir = join(homeDir, '.mx-env', 'audit')
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const day = event.timestamp.slice(0, 10)
    appendFileSync(join(dir, `${day}.jsonl`), `${JSON.stringify(event)}\n`, { mode: 0o600 })
  } catch {
    // Auditing must never turn a valid development command into an outage.
  }
}
