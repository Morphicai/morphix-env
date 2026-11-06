import { realpathSync } from 'fs'
import { homedir } from 'os'
import { delimiter, join } from 'path'

/**
 * Shared shim PATH/list logic (L1). The L2 CLI (`mxenv`) boot-sanitizes PATH so
 * `run` cannot recurse shim → run → provider → shim, and warns on invalid
 * `shims` lists; the L3 CLI (`mxenv-cli`) owns the `shell-init` command face
 * (shim generation/stripping/two-level manifests) on top of this layer.
 * Package-split 4.1: pure PATH/list helpers sink here so L2 and L3 share one
 * implementation without depending on each other.
 */

/**
 * Names a shim may never take: every CLI subcommand of either CLI, both L2 bin
 * names, and the internal editor entry. Kept in one place; the shim tests
 * assert parity with the dispatch tables in both cli.ts files so future
 * commands cannot drift past it.
 */
export const RESERVED_SHIM_NAMES = [
  'run', 'fetch', 'export', 'render', 'inject', 'generate', 'gen',
  'inspect', 'migrate', 'audit', 'edit', 'doc', 'skill', 'shell-init', 'help',
  'mx-env', 'morphix-env', '__mx_editor',
  // Wave B placeholders reserved by mxenv-cli (dispatch labels exist, not implemented).
  'gui', 'global', 'host',
]

const SHIM_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function shimsDir(homeDir = homedir()): string {
  return join(homeDir, '.mx-env', 'shims')
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
      errors.push(`${label}: shim entry "${entry}" conflicts with a reserved mx-env command name`)
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
 * Removes every PATH entry that resolves to the shims directory (filter-all,
 * so rc files that add it twice are both cleaned). Entries are compared after
 * realpath normalization on both sides, case-insensitively on macOS (whose
 * default filesystem would resolve `Run` to the `run` shim file).
 */
export function stripShimsFromPath(pathValue: string | undefined, homeDir = homedir()): string | undefined {
  if (!pathValue) return pathValue
  const target = shimsDir(homeDir)
  let targetReal = target
  try {
    targetReal = realpathSync(target)
  } catch { /* directory may not exist yet; literal comparison still applies */ }
  const equal = (a: string, b: string) =>
    process.platform === 'darwin' ? a.toLowerCase() === b.toLowerCase() : a === b
  const entries = pathValue.split(delimiter).filter((entry) => {
    if (!entry) return true
    const literal = entry.replace(/\/+$/, '')
    let resolved = literal
    try {
      resolved = realpathSync(literal)
    } catch { /* keep literal */ }
    return !equal(literal, target) && !equal(resolved, targetReal)
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
