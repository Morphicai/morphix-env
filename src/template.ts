import { spawnSync } from 'child_process'
import { chmodSync, mkdirSync, writeFileSync } from 'fs'
import { basename, dirname, resolve } from 'path'

/** POSIX single-quote escaping so `eval "$(mx-env export)"` round-trips any value. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function templateVariablePattern(): RegExp {
  return /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g
}

/** Unique `${VAR}` names in declaration order. */
export function findTemplateVariables(text: string): string[] {
  const names = new Set<string>()
  for (const match of text.matchAll(templateVariablePattern())) names.add(match[1])
  return [...names]
}

/**
 * Replaces `${VAR}` with composed values for config formats that do not
 * interpolate. Unresolved names are reported and left literal so the caller
 * can warn before anything is written.
 */
export function renderTemplate(text: string, environment: NodeJS.ProcessEnv): { output: string; missing: string[] } {
  const missing = new Set<string>()
  const output = text.replace(templateVariablePattern(), (match, name) => {
    const value = environment[name]
    if (value === undefined || value === null) {
      missing.add(name)
      return match
    }
    return value
  })
  return { output, missing: [...missing] }
}

/** Owner-only output: creates parent dirs 0700 and forces mode 0600 even on overwrite. */
export function writePrivateFile(path: string, content: string): void {
  const absolute = resolve(path)
  mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 })
  writeFileSync(absolute, content, { mode: 0o600 })
  chmodSync(absolute, 0o600)
}

export type GitOutputStatus = 'ignored' | 'untracked' | 'tracked' | 'outside-repo'

/**
 * Classifies a rendered/injected output file so callers can warn before a
 * value lands on a git-tracked path. Never throws: missing git or a directory
 * outside any work tree reports `outside-repo` (no warning needed).
 */
export function gitOutputStatus(path: string): GitOutputStatus {
  const absolute = resolve(path)
  const cwd = dirname(absolute)
  const name = basename(absolute)
  const inside = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, encoding: 'utf8' })
  if (inside.status !== 0) return 'outside-repo'
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', name], { cwd, encoding: 'utf8' })
  if (tracked.status === 0) return 'tracked'
  const ignored = spawnSync('git', ['check-ignore', '-q', '--', name], { cwd, encoding: 'utf8' })
  if (ignored.status === 0) return 'ignored'
  if (ignored.status === 1) return 'untracked'
  return 'outside-repo'
}

/** Value-free warning: names the file and the git state, never any content. */
export function warnOutputGitRisk(path: string): void {
  const status = gitOutputStatus(path)
  if (status === 'tracked') {
    console.warn(`[morphix-env] Warning: ${path} is tracked by git; a rendered value could be committed. Add it to .gitignore and untrack it.`)
  } else if (status === 'untracked') {
    console.warn(`[morphix-env] Warning: ${path} is not git-ignored; add it to .gitignore before committing.`)
  }
}
