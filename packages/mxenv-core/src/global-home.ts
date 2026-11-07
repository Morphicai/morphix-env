import { existsSync } from 'fs'
import { homedir } from 'os'
import { resolve } from 'path'
import { GLOBAL_CONFIG_DIR } from './contracts'

/**
 * 全局目录兼容读取（home-migration）：`~/.mxenv/` 是命名切换后的家；兼容窗口内
 * 它不存在时读回落旧 `~/.mx-env/`（不断供），两目录并存只认新目录。迁移由
 * `mxenv migrate --home` 完成（copy → 备份改名 → 值级等价验证 → 失败回滚）。
 *
 * 读写同一解析：兼容窗内写也落旧目录（否则审计/shim 写会先建出 `~/.mxenv/`，
 * 令 migrate --home 误判"目标已存在"）。未迁移回落触发一次性迁移提示（stderr，
 * 值不落输出），migrate --home 自身抑制。
 */
export const LEGACY_GLOBAL_CONFIG_DIR = '.mx-env'

let legacyHintSuppressed = false
let legacyHintShown = false

/** migrate --home 自身（及其等价验证）不提示迁移。 */
export function suppressLegacyHomeHint(): void {
  legacyHintSuppressed = true
}

/** 测试可观测：一次性提示是否已发出。 */
export function legacyHomeHintShown(): boolean {
  return legacyHintShown
}

/** 解析当前生效的全局目录：新目录优先，旧目录兼容回落，皆无则返回新目录（新装）。 */
export function resolveGlobalDir(homeDir = homedir()): string {
  const next = resolve(homeDir, GLOBAL_CONFIG_DIR)
  const legacy = resolve(homeDir, LEGACY_GLOBAL_CONFIG_DIR)
  if (existsSync(next)) return next
  if (existsSync(legacy)) {
    if (!legacyHintSuppressed && !legacyHintShown) {
      legacyHintShown = true
      process.stderr.write(
        `[mxenv] using legacy global directory ${legacy} — run \`mxenv migrate --home\` to move it to ${next}.\n`,
      )
    }
    return legacy
  }
  return next
}
