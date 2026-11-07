import { realpathSync } from 'fs'
import { homedir } from 'os'
import { delimiter, join } from 'path'
import { GLOBAL_CONFIG_DIR } from './contracts'
import { LEGACY_GLOBAL_CONFIG_DIR } from './global-home'

/**
 * Shared shim PATH/list logic (L1). The L2 CLI (`mxenv`) boot-sanitizes PATH so
 * `run` cannot recurse shim → run → provider → shim, and warns on invalid
 * `shims` lists; the L3 CLI (`mxenv-cli`) owns the `shell-init` command face
 * (shim generation/stripping/two-level manifests) on top of this layer.
 * Package-split 4.1: pure PATH/list helpers sink here so L2 and L3 share one
 * implementation without depending on each other.
 */

/**
 * Names a shim may never take: every CLI subcommand of either CLI, all bin
 * names (new primary `mxenv` plus the deprecated aliases kept during 0.12.x),
 * and the internal editor entry. Kept in one place; the shim tests
 * assert parity with the dispatch tables in both cli.ts files so future
 * commands cannot drift past it.
 */
export const RESERVED_SHIM_NAMES = [
  'run', 'fetch', 'export', 'render', 'inject', 'generate', 'gen',
  'inspect', 'migrate', 'audit', 'edit', 'doc', 'skill', 'shell-init', 'help',
  'mxenv', 'mx-env', 'morphix-env', '__mx_editor',
  // Wave B placeholders reserved by mxenv-cli (dispatch labels exist, not implemented).
  'gui', 'global', 'host',
]

const SHIM_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Shims live under the renamed global dir `~/.mxenv/shims`（0.12.1 起写只落新名，不随数据读面回落）。 */
export function shimsDir(homeDir = homedir()): string {
  return join(homeDir, GLOBAL_CONFIG_DIR, 'shims')
}

/** 旧目录 shim 库（0.12.x 兼容窗）：PATH 剥离与 `--remove` 清扫仍须覆盖，防旧 shim 递归。 */
export function legacyShimsDir(homeDir = homedir()): string {
  return join(homeDir, LEGACY_GLOBAL_CONFIG_DIR, 'shims')
}

/**
 * Validates one declared shim list. Command names are configuration, not
 * secrets, so echoing the offending entry is safe. Callers decide the blast
 * radius: shell-init hard-fails, composition paths warn and ignore (a
 * convenience layer must never become a single point of failure for run).
 */
export function validateShimList(list: unknown, label: string): string[] {
  if (list === undefined || list === null) return []
  if (!Array.isArray(list)) return [`${label}: "shims" must be an array of command names`]
  const errors: string[] = []
  const seen = new Set<string>()
  for (const entry of list) {
    if (typeof entry !== 'string' || !entry) {
      errors.push(`${label}: shim entries must be non-empty command names`)
      continue
    }
    if (!SHIM_NAME_PATTERN.test(entry)) {
      errors.push(`${label}: shim entry "${entry}" must be a bare command name (letters, digits, ".", "_", "-"; no path separators or whitespace)`)
      continue
    }
    const lower = entry.toLowerCase()
    if (RESERVED_SHIM_NAMES.includes(lower)) {
      errors.push(`${label}: shim entry "${entry}" conflicts with a reserved mxenv command name`)
      continue
    }
    if (seen.has(lower)) {
      errors.push(`${label}: duplicate shim entry "${entry}" (comparison is case-insensitive)`)
      continue
    }
    seen.add(lower)
  }
  return errors
}

/**
 * Removes every PATH entry that resolves to a shims directory — the current
 * `~/.mxenv/shims` **and** the legacy `~/.mx-env/shims` (filter-all, so rc
 * files that add it twice are both cleaned). Entries are compared after
 * realpath normalization on both sides, case-insensitively on macOS (whose
 * default filesystem would resolve `Run` to the `run` shim file).
 */
export function stripShimsFromPath(pathValue: string | undefined, homeDir = homedir()): string | undefined {
  if (!pathValue) return pathValue
  const equal = (a: string, b: string) =>
    process.platform === 'darwin' ? a.toLowerCase() === b.toLowerCase() : a === b
  const targets = [shimsDir(homeDir), legacyShimsDir(homeDir)]
  const targetPairs = targets.map((target) => {
    let real = target
    try {
      real = realpathSync(target)
    } catch { /* directory may not exist yet; literal comparison still applies */ }
    return [target, real] as const
  })
  const entries = pathValue.split(delimiter).filter((entry) => {
    if (!entry) return true
    const literal = entry.replace(/\/+$/, '')
    let resolved = literal
    try {
      resolved = realpathSync(literal)
    } catch { /* keep literal */ }
    return !targetPairs.some(([target, real]) => equal(literal, target) || equal(resolved, real))
  })
  return entries.join(delimiter)
}

/**
 * Boot-time sanitization for every CLI command, not just `run`: composition
 * spawns provider subprocesses (doppler, plugins, dotenvx) that inherit PATH,
 * so a shimmed provider CLI would recurse shim → run → provider → shim.
 * Sanitizing process.env before any composition keeps the whole process tree
 * clean. Returns the pre-sanitization PATH (shell-init's parity check needs
 * the real one) and whether the invocation came through a shim.
 */
export function sanitizeBootEnv(env: NodeJS.ProcessEnv = process.env, homeDir?: string): { viaShim: boolean; originalPath?: string } {
  const originalPath = env.PATH
  const viaShim = env.MXENV_SHIM === '1'
  try {
    // homedir() can throw in hardened containers with no $HOME and no passwd
    // entry; light commands (--help/--version) must survive that.
    const home = homeDir ?? homedir()
    const stripped = stripShimsFromPath(originalPath, home)
    if (stripped !== originalPath) {
      if (stripped) env.PATH = stripped
      else delete env.PATH
    }
  } catch { /* sanitization is best-effort; composition paths resolve home themselves */ }
  delete env.MXENV_SHIM
  return { viaShim, originalPath }
}

// ─── rc PATH 块（纯逻辑，L2/L3 共享） ───────────────────────────────
// shell-init（L3）upsert/remove 与 migrate --home（L2）迁移后重写共用一份
// 常量与替换语义：rc 块在写入时烘死 shimsDir 绝对路径，目录迁移后必须能按
// 新旧标记双认重写，否则 PATH 断供（home-migration review S-1）。

export const RC_BLOCK_BEGIN = '# >>> mxenv shims >>>'
export const RC_BLOCK_END = '# <<< mxenv shims <<<'
/** rc 标记块双认：旧块（0.12.x 前写入）仍可识别/替换/剥离，写侧只产新名。 */
export const LEGACY_RC_BLOCK_BEGIN = '# >>> mx-env shims >>>'
export const LEGACY_RC_BLOCK_END = '# <<< mx-env shims <<<'

export function rcBlock(homeDir = homedir()): string {
  const dir = shimsDir(homeDir)
  // The path lands inside a double-quoted shell line; refuse characters that
  // could break out of it. Real $HOME values essentially never contain these.
  if (/["$`\\]/.test(dir)) {
    throw new Error('[mxenv] Shims directory path contains characters that are unsafe in a shell rc line.')
  }
  return `${RC_BLOCK_BEGIN}\nexport PATH="${dir}:$PATH"\n${RC_BLOCK_END}`
}

/** 标记块匹配（新旧双认）：begin/end 各自两种写法的任意配对均识别。每次返回新实例（g 标志无状态残留）。 */
export function rcBlockPattern(): RegExp {
  const begins = `${escapeRegExp(RC_BLOCK_BEGIN)}|${escapeRegExp(LEGACY_RC_BLOCK_BEGIN)}`
  const ends = `${escapeRegExp(RC_BLOCK_END)}|${escapeRegExp(LEGACY_RC_BLOCK_END)}`
  return new RegExp(`(?:${begins})[\\s\\S]*?(?:${ends})`, 'g')
}

/** 内容里是否已有工具标记 rc 块（新旧任一标记）。 */
export function hasRcBlock(content: string): boolean {
  return rcBlockPattern().test(content)
}

/** 纯替换：所有标记块收敛为当前 shimsDir 的新块；无标记块时原样返回。 */
export function replaceRcBlocks(content: string, homeDir = homedir()): string {
  return content.replace(rcBlockPattern(), rcBlock(homeDir))
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
