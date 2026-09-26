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
