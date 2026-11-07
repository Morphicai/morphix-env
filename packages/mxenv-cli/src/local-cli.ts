import { spawnSync } from 'child_process'
import { accessSync, constants, existsSync } from 'fs'
import { delimiter, join, resolve } from 'path'

/**
 * D5 spawn 版本对齐（spec package-boundary「项目态写操作版本对齐」）：
 * 全局 CLI（L3）在项目作用域执行写操作（修改项目来源/配置）时，必须 spawn
 * 项目本地 CLI（L2，项目 node_modules 钉定版本）执行，绝不以全局侧自身版本
 * 直接改写项目数据。解析顺序 cwd → `node_modules/.bin` → PATH，与
 * mxenv-core 的 ensureCommand 哲学一致；解析失败硬失败并给安装指引。
 * Wave A 消费方为 Wave B 的 gui/global/host 命令预留；本模块先落地机制与
 * 两向验证（「项目写走本地版本」「无本地 CLI 明确失败」）。
 */

/** L2 CLI 的 bin 名（命名全切归 mxenv-naming-cutover，此处不改名）。 */
/** 新名 `mxenv` 优先；旧名 alias 于 0.12.x 垫片窗口内照认（naming-migration）。 */
export const LOCAL_CLI_BIN_NAMES = ['mxenv', 'mx-env', 'morphix-env'] as const

export class LocalCliMissingError extends Error {
  readonly cwd: string
  constructor(cwd: string) {
    super(
      `[mxenv] No project-local mxenv CLI found for ${cwd} (checked node_modules/.bin and PATH).\n` +
        `Install it in the project so writes run the project-pinned version: npm i -D mxenv (or: pnpm add -D mxenv).\n` +
        `Refusing to write project data with the global CLI.`,
    )
    this.name = 'LocalCliMissingError'
    this.cwd = cwd
  }
}

/**
 * Resolves the project-local L2 CLI. Order mirrors ensureCommand:
 * `<cwd>/node_modules/.bin/<bin>` first, then PATH lookup. Returns null when
 * nothing resolves — callers turn that into a hard failure, never a fallback
 * to the global engine.
 */
export function resolveLocalCli(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): string | null {
  for (const name of LOCAL_CLI_BIN_NAMES) {
    const localBinary = resolve(cwd, 'node_modules', '.bin', name)
    if (isExecutable(localBinary)) return localBinary
  }
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const name of LOCAL_CLI_BIN_NAMES) {
      const candidate = join(dir, name)
      if (isExecutable(candidate)) return candidate
    }
  }
  return null
}

function isExecutable(candidate: string): boolean {
  try {
    if (!existsSync(candidate)) return false
    accessSync(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Runs a project-scoped write through the project-local CLI. Throws
 * LocalCliMissingError (actionable install guidance, value-free) when no local
 * CLI resolves — the global CLI must never write project data itself.
 * Returns the child's exit status.
 */
export function spawnLocalCliWrite(
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): number {
  const cwd = options.cwd ?? process.cwd()
  const cli = resolveLocalCli(cwd, options.env)
  if (!cli) throw new LocalCliMissingError(cwd)
  const result = spawnSync(cli, args, {
    cwd,
    env: options.env ?? process.env,
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  if (result.error) {
    throw new Error(`[mxenv] Failed to execute the project-local CLI (${cli}): ${result.error.message}`)
  }
  return result.status ?? 1
}
