import { existsSync, readdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { resolve } from 'path'
import { GLOBAL_CONFIG_DIR } from './contracts'

/**
 * 全局目录兼容读取（home-migration）：`~/.mxenv/` 是命名切换后的家；兼容窗口内
 * 旧 `~/.mx-env/` 仍作为数据读回落（不断供），两目录都有真实数据时只认新目录。
 * 迁移由 `mxenv migrate --home` 完成（copy → 备份改名 → 值级等价验证 → 失败回滚）。
 *
 * 写侧纪律（0.12.1 起）：**写只落新名**——audit/shim 一律写 `~/.mxenv/`，哪怕
 * 数据读面还在回落旧目录。为防止"脚手架目录建出即翻转读面/卡死迁移"，判定
 * 新目录是否生效改用 hasGlobalData（有无真实数据）而非存在性：
 * - 只有 `audit/`/`shims/` 脚手架的新目录不翻转读面（数据仍在旧目录，不断供）；
 * - `migrate --home` 对脚手架-only 目标不再误判 conflict，走合并迁移。
 */
export const LEGACY_GLOBAL_CONFIG_DIR = '.mx-env'

/** 新目录里允许先于真实数据出现的脚手架（不构成"已迁移"证据）。 */
const GLOBAL_SCAFFOLDING = new Set(['audit', 'shims', '.mxenv-verify-pending'])

const HINT_MARKER_NAME = '.mxenv-legacy-hint-shown'

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

/**
 * 新目录是否持有真实数据（配置/值文件等，脚手架除外）。
 * migrate --home 的目标存在性判定与读面翻转共用这一谓词。
 */
export function hasGlobalData(homeDir = homedir()): boolean {
  return hasGlobalDataAt(resolve(homeDir, GLOBAL_CONFIG_DIR))
}

/** 指定目录内是否持有真实数据（脚手架除外）。 */
export function hasGlobalDataAt(dir: string): boolean {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return false
  }
  return entries.some((name) => !GLOBAL_SCAFFOLDING.has(name))
}

/**
 * 解析当前生效的全局数据目录：新目录有真实数据 → 新目录；否则旧目录存在 →
 * 旧目录（一次性迁移提示，每机一次）；皆无则返回新目录（新装/脚手架）。
 */
export function resolveGlobalDir(homeDir = homedir()): string {
  const next = resolve(homeDir, GLOBAL_CONFIG_DIR)
  const legacy = resolve(homeDir, LEGACY_GLOBAL_CONFIG_DIR)
  if (existsSync(next) && hasGlobalDataAt(next)) return next
  if (existsSync(legacy)) {
    hintLegacyHomeOnce(legacy, next)
    return legacy
  }
  return next
}

/** 迁移提示每机一次（旧目录内记 marker）；legacyHomeHintShown() 反映本进程实际是否打印。 */
function hintLegacyHomeOnce(legacy: string, next: string): void {
  if (legacyHintSuppressed || legacyHintShown) return
  const marker = resolve(legacy, HINT_MARKER_NAME)
  try {
    if (existsSync(marker)) return
    writeFileSync(marker, '', { mode: 0o600 })
  } catch { /* marker 读写失败不阻塞提示 */ }
  legacyHintShown = true
  process.stderr.write(
    `[mxenv] using legacy global directory ${legacy} — run \`mxenv migrate --home\` to move it to ${next}.\n`,
  )
}
