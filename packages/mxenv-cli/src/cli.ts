#!/usr/bin/env node

import { homedir } from 'os'
import { loadConfigLayers, sanitizeBootEnv, shimsDir, suppressLegacyHomeHint, validateShimList, type ConfigLayers } from '@morphixai/mxenv-core'
import {
  defaultRcPath,
  detectHandmadeReservedShims,
  findShadowedCommands,
  removeAllShims,
  removeRcBlock,
  resolveShimCommands,
  upsertRcBlock,
  writeShims,
} from './shims'
import { spawn } from 'child_process'
import { collectEntries, hostLockState, hostStatus, startHostSession } from './host'
import { clearHostSession, readHostSession, releaseHostLock } from '@morphixai/mxenv-core'
import pkg from '../package.json'

const VERSION = pkg.version

interface Args {
  command: string
  subArgs: string[]
  positionals: string[]
  envFiles: string[]
  outFile: string | null
  verbose: boolean
  filter: string | null
  noInfisical: boolean
  env: string | null
  profile: string | null
  noGlobal: boolean
  allowInsecureGlobal: boolean
  printEditorUrl: boolean
  source: string | null
  target: string | null
  /** skill: hermes 分类目录（~/.hermes/skills/<category>/mxenv/），默认 devops。 */
  hermesCategory: string | null
  to: string | null
  service: string | null
  force: boolean
  dryRun: boolean
  /** migrate: 全局目录一次性迁移（~/.mx-env → ~/.mxenv）。 */
  home: boolean
  serve: boolean
  write: boolean
  remove: boolean
  warnPlaintext: boolean
  /** 子命令级 --help/-h（顶层 --help 以 command 形态落在 main 分派里）。 */
  help: boolean
  /** Flags the parser did not recognize; shell-init fails on these instead of silently ignoring them. */
  unknownFlags: string[]
}

/**
 * Same flag grammar as the L2 CLI parser: recognized-but-unused flags stay
 * silently accepted (zero semantic change for `shell-init`), and only flags
 * the parser does not recognize land in unknownFlags.
 */
function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: '', subArgs: [], positionals: [], envFiles: [], outFile: null, verbose: false,
    filter: null, noInfisical: false, env: null, profile: null, noGlobal: false,
    allowInsecureGlobal: false, printEditorUrl: false, source: null,
    target: null, hermesCategory: null, to: null, service: null, force: false, dryRun: false, home: false, serve: false,
    write: false, remove: false, warnPlaintext: false, help: false, unknownFlags: [],
  }

  let i = 2
  const command = argv[i]
  if (!command) return args
  args.command = command
  i++

  while (i < argv.length) {
    const arg = argv[i]
    if (arg === '--') {
      args.subArgs = argv.slice(i + 1)
      break
    }
    if (arg === '--env-file' || arg === '-f') {
      if (argv[++i]) args.envFiles.push(argv[i])
    } else if (arg === '--out' || arg === '-o') {
      if (argv[++i]) args.outFile = argv[i]
    } else if (arg === '--filter') {
      if (argv[++i]) args.filter = argv[i]
    } else if (arg === '--env' || arg === '-e') {
      if (argv[++i]) args.env = argv[i]
    } else if (arg === '--profile' || arg === '-p') {
      if (argv[++i]) args.profile = argv[i]
    } else if (arg === '--source') {
      if (argv[++i]) args.source = argv[i]
    } else if (arg === '--verbose' || arg === '-v') {
      args.verbose = true
    } else if (arg === '--no-infisical') {
      args.noInfisical = true
    } else if (arg === '--no-global') {
      args.noGlobal = true
    } else if (arg === '--allow-insecure-global') {
      args.allowInsecureGlobal = true
    } else if (arg === '--print-editor-url') {
      args.printEditorUrl = true
    } else if (arg === '--target') {
      if (argv[++i]) args.target = argv[i]
    } else if (arg === '--hermes-category') {
      if (argv[++i]) args.hermesCategory = argv[i]
    } else if (arg === '--to') {
      if (argv[++i]) args.to = argv[i]
    } else if (arg === '--service') {
      if (argv[++i]) args.service = argv[i]
    } else if (arg === '--force') {
      args.force = true
    } else if (arg === '--dry-run') {
      args.dryRun = true
    } else if (arg === '--home') {
      args.home = true
    } else if (arg === '--write') {
      args.write = true
    } else if (arg === '--remove') {
      args.remove = true
    } else if (arg === '--serve') {
      args.serve = true
    } else if (arg === '--warn-plaintext') {
      args.warnPlaintext = true
    } else if (arg === '--help' || arg === '-h') {
      args.help = true
    } else if (args.command === 'run') {
      args.subArgs = argv.slice(i)
      break
    } else if (!arg.startsWith('-')) {
      args.positionals.push(arg)
    } else {
      // Unknown flags are recorded, not silently dropped: shell-init refuses
      // to proceed with them so `shell-init --wirte` cannot degrade into a
      // silent no-op. Other commands keep their historical lenient behavior.
      args.unknownFlags.push(arg)
    }
    i++
  }
  return args
}

function configLayers(): ConfigLayers {
  return loadConfigLayers({ cwd: process.cwd(), homeDir: homedir() })
}

/**
 * Boot-time capture, set by main() before dispatch: whether this invocation
 * came through a PATH shim (audit `via` dimension) and the pre-sanitization
 * PATH (shell-init's per-command parity check needs the real one).
 */
const bootInfo: { viaShim: boolean; originalPath?: string } = { viaShim: false }

/**
 * `shell-init`: generate PATH shims for the declared command list (global ∪
 * project), optionally write/remove the rc PATH block. Hard-fails on invalid
 * `shims` entries — this is the command whose whole job is the list, unlike
 * composition paths which only warn. Value-free by construction: the list is
 * command names, never secrets.
 */
function cmdShellInit(args: Args): number {
  // --help 先于平台判定（review F5）：帮助在任何平台都可用且退出 0。
  if (args.help) {
    showHelp()
    return 0
  }
  if (process.platform === 'win32') {
    console.error('[mxenv] shell-init is supported on macOS/Linux only; on Windows keep using explicit `mxenv run -- <command>`.')
    return 1
  }
  if (args.unknownFlags.length) {
    console.error(`[mxenv] shell-init: unrecognized flag(s): ${args.unknownFlags.join(', ')}`)
    return 1
  }
  if (args.home) {
    console.error('[mxenv] shell-init: --home belongs to `migrate` (global directory migration) and is not accepted here.')
    return 1
  }
  if (args.write && args.remove) {
    console.error('[mxenv] shell-init: --write and --remove are mutually exclusive.')
    return 1
  }
  try {
    return runShellInit(args)
  } catch (error) {
    // Filesystem failures (unwritable home, rc path is a directory, …) must
    // surface as actionable text, not a raw errno bubble.
    const code = (error as NodeJS.ErrnoException)?.code
    console.error(`[mxenv] shell-init failed${code ? ` (${code})` : ''}: check that your home directory and rc file are writable, then retry.`)
    return 1
  }
}

function runShellInit(args: Args): number {
  const layers = configLayers()
  const home = homedir()
  const rcPath = defaultRcPath(process.env.SHELL, home)

  if (args.remove) {
    const removed = removeAllShims(home)
    const rcOutcome = rcPath ? removeRcBlock(rcPath) : 'absent'
    console.log(`[mxenv] Removed ${removed.length} shim(s)${removed.length ? ` (${removed.join(', ')})` : ''}; rc block ${rcOutcome}${rcPath ? ` in ${rcPath}` : ''}.`)
    return 0
  }

  const problems = [
    ...validateShimList(layers.global.config.shims, layers.global.path),
    ...validateShimList(layers.project.config.shims, layers.project.path),
  ]
  if (problems.length) {
    for (const problem of problems) console.error(`[mxenv] ${problem}`)
    return 1
  }

  const commands = resolveShimCommands(layers, !args.noGlobal)
  const { written, removed, skipped } = writeShims(commands, home)
  console.log(`[mxenv] Shims ready in ${shimsDir(home)} (${commands.length} command(s): ${commands.join(', ') || 'none'}; ${written.length} written, ${removed.length} removed).`)

  for (const command of skipped) {
    console.warn(`[mxenv] Warning: "${command}" exists in the shims directory as a handmade file (no mxenv marker); refusing to overwrite. Remove or rename it by hand, then re-run shell-init.`)
  }
  for (const file of detectHandmadeReservedShims(home)) {
    console.warn(`[mxenv] Warning: "${file}" in the shims directory was not created by mxenv and shadows a reserved command; delete it by hand. Do not place files in ${shimsDir(home)} manually.`)
  }

  // Parity check against the pre-sanitization PATH captured at boot: each
  // declared command must resolve to its shim, or an earlier PATH entry
  // (volta, another tool) silently wins and nothing is injected.
  const { absent, shadowed } = findShadowedCommands(commands, bootInfo.originalPath, home)
  if (absent.length) {
    console.warn(`[mxenv] Note: ${absent.join(', ')} cannot be resolved on the current PATH yet — add the shims directory (below) and open a new shell.`)
  }
  if (shadowed.length) {
    console.warn(`[mxenv] Warning: these commands resolve to a different executable ahead of their shim: ${shadowed.join(', ')} — move ${shimsDir(home)} ahead of the entries that provide them.`)
  }

  if (args.write) {
    if (!rcPath) {
      console.error('[mxenv] shell-init: cannot infer an rc file from $SHELL (zsh/bash supported); add the PATH line manually.')
      return 1
    }
    const outcome = upsertRcBlock(rcPath, home)
    console.log(`[mxenv] rc block ${outcome} in ${rcPath}. Open a new shell to activate.`)
    return 0
  }

  console.log(`\nAdd the shims directory to PATH${rcPath ? ` (e.g. in ${rcPath})` : ''}:\n\n  export PATH="${shimsDir(home)}:$PATH"\n\nOr re-run with --write to let mxenv maintain a marked block in your rc file.`)
  return 0
}

function showHelp(): void {
  console.log(`
mxenv CLI (mxenv-cli) v${VERSION} — machine-level management face

Usage:
  mxenv-cli shell-init [--write|--remove]    Generate PATH shims for declared commands

Options:
  --write                  Also maintain a marked PATH block in your rc file
  --remove                 Remove every generated shim and the rc PATH block
  --no-global              Generate project-declared shims only (skip the global config list)
  --help, -h               Show this help
  --version                Show version

mxenv gui [status|close]   Panel-host session (machine-level keys view & safe
                           reveal; values never leave this machine; opens the
                           panel in a browser — distinct from the project
                           editor \`mxenv edit\`)

Project-level commands (run, export, inspect, edit, migrate, …) come from the
project-local install (node_modules/.bin); this CLI manages the machine only.
`)
}

/**
 * `mxenv gui`：面板宿主会话（panel-host）。无会话则起（detached 子进程
 * `gui serve`）并开浏览器；有会话则附着打印 URL。`gui status`/`gui close`
 * 管理生命周期。值红线：输出永不含值与 token。
 */
async function cmdGui(args: Args): Promise<number> {
  const sub = args.subArgs[0] || ''
  const homeDir = homedir()

  if (sub === 'status') {
    const st = hostStatus(homeDir)
    if (!st.running) {
      console.log('[mxenv] no running host session')
      return 1
    }
    const lock = await hostLockState(homeDir)
    const lockLabel = lock ? (lock.locked ? 'locked' : 'unlocked') : 'unknown (host not answering)'
    console.log(`[mxenv] host session running — port ${st.port}, started ${st.startedAt}, ${lockLabel}`)
    return 0
  }

  if (sub === 'close') {
    const session = readHostSession(homeDir)
    if (!session) {
      console.log('[mxenv] no running host session')
      return 0
    }
    // 优雅关闭：宿主 /shutdown 清文件退进程；本地双保险再清一次（幂等）。
    try {
      await fetch(`http://127.0.0.1:${session.port}/shutdown`, {
        method: 'POST',
        headers: { authorization: `Bearer ${session.token}` },
        signal: AbortSignal.timeout(3_000),
      })
    } catch { /* 宿主已亡则本地清理兜底 */ }
    clearHostSession(homeDir)
    releaseHostLock(homeDir)
    console.log('[mxenv] host session closed')
    return 0
  }

  if (sub === 'serve') {
    // 内部模式：detached 子进程持有会话（TTL/空闲/close 到期自清）。
    const layers = loadConfigLayers({ homeDir })
    const started = await startHostSession({ homeDir, cwd: process.cwd(), entries: collectEntries(layers) })
    if (!('runtime' in started)) return 0 // 竞态下已有会话：子进程即退（幂等）
    await new Promise<void>((resolve) => started.runtime.server.on('close', () => resolve()))
    return 0
  }

  // 默认：起或附着（spec：再次执行附着已运行会话，不产生第二实例）。
  // 会话判断走 runtime 发现文件；无会话则 spawn detached 子进程持有会话。
  const existing = readHostSession(homeDir)
  if (existing) {
    const url = `http://127.0.0.1:${existing.port}/${existing.token}`
    console.log(`[mxenv] attaching to running host session: ${url}`)
    openInBrowser(url)
    return 0
  }
  const child = spawn(process.execPath, [process.argv[1], 'gui', 'serve'], { detached: true, stdio: 'ignore' })
  child.unref()
  const deadline = Date.now() + 5_000
  let session = readHostSession(homeDir)
  while (!session && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100))
    session = readHostSession(homeDir)
  }
  if (!session) {
    console.error('[mxenv] host session did not come up within 5s')
    return 1
  }
  const url = `http://127.0.0.1:${session.port}/${session.token}`
  console.log(`[mxenv] host session up: ${url}`)
  openInBrowser(url)
  return 0
}

function openInBrowser(url: string): void {
  // spawn 对缺失命令抛异步 'error' 事件而非同步 throw——必须挂监听兜底。
  const child = spawn('open', [url], { stdio: 'ignore' })
  child.on('error', () => console.log(`[mxenv] open the panel manually: ${url}`))
  child.unref()
}

/** Wave B placeholders: reserved command names, deliberately not implemented. */
function cmdReserved(command: string): number {
  console.error(`[mxenv] "${command}" is reserved for a future release and is not implemented yet.`)
  return 1
}

/** L2 项目命令名：本 CLI 收到时给"去项目里跑"的直达指引（P10），而不是裸 Unknown command。 */
const PROJECT_COMMANDS = new Set([
  'run', 'fetch', 'export', 'render', 'inject', 'generate', 'gen',
  'inspect', 'migrate', 'audit', 'edit', 'doc', 'skill',
])

async function main(): Promise<number> {
  // Same boot discipline as the L2 CLI: strip shim PATH entries before any
  // work so nothing we spawn can recurse into a shim.
  Object.assign(bootInfo, sanitizeBootEnv())
  const args = parseArgs(process.argv)
  // --no-global 明确排除全局配置面：连兼容窗迁移提示也一并静音（P9a）。
  if (args.noGlobal) suppressLegacyHomeHint()
  // 子命令级 --help 全局短路（review F6）：任何命令带 --help 都给帮助、退出 0。
  if (args.help && args.command !== 'shell-init') {
    showHelp()
    return 0
  }
  switch (args.command) {
    case 'shell-init': return cmdShellInit(args)
    case 'gui': return cmdGui(args)
    // Wave B skeleton (package-split 4.3): reserved, not implemented.
    case 'global':
    case 'host': return cmdReserved(args.command)
    case '--help':
    case '-h':
    case 'help': showHelp(); return 0
    case '--version': console.log(VERSION); return 0
    default:
      if (args.command) {
        console.error(`[mxenv] Unknown command: ${args.command}`)
        // migrate 双面（review F3）：--home 是机器级操作，明文迁移才是项目命令。
        if (args.command === 'migrate') {
          console.error('[mxenv] `migrate --home` (machine-level global-directory migration) runs as `npx @morphixai/mxenv migrate --home` from anywhere; plaintext migration is a project command — run it inside a project.')
        } else if (PROJECT_COMMANDS.has(args.command)) {
          console.error(`[mxenv] "${args.command}" is a project command from @morphixai/mxenv — run it inside a project (\`npx mxenv ${args.command} …\` or an npm script). This CLI is the machine-level face only.`)
        }
      }
      showHelp()
      return args.command ? 1 : 0
  }
}

main()
  .then((code) => { process.exitCode = code })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : '[mxenv] Command failed.'
    console.error(message)
    process.exitCode = 1
  })
