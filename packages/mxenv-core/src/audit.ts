import { appendFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { AuditEvent } from './contracts'
import { GLOBAL_CONFIG_DIR } from './contracts'

// AuditEvent 类型已抽至 ./contracts（L0）；re-export 保持原导出面。
export type { AuditEvent } from './contracts'

/**
 * 审计目录——读写单一事实源（0.12.1 起恒为 `~/.mxenv/audit`，写只落新名）。
 * 旧 `~/.mx-env/audit` 的历史事件随 `mxenv migrate --home` 并入；迁移前
 * `audit tail` 只看新目录（与 writeAudit 同源，避免读写两侧分裂）。
 */
export function auditDir(homeDir = homedir()): string {
  return join(homeDir, GLOBAL_CONFIG_DIR, 'audit')
}

/** Best-effort local audit that intentionally has no values or command arguments. */
export function writeAudit(event: AuditEvent, homeDir = homedir()): void {
  try {
    // 审计恒落 ~/.mxenv/audit（写只落新名）；无值纪律不变。
    const dir = auditDir(homeDir)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const day = event.timestamp.slice(0, 10)
    appendFileSync(join(dir, `${day}.jsonl`), `${JSON.stringify(event)}\n`, { mode: 0o600 })
  } catch {
    // Auditing must never turn a valid development command into an outage.
  }
}
