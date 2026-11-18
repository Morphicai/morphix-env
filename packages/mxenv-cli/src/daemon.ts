/**
 * 常驻模式（gui install/uninstall）：launchd（macOS）/ systemd --user（Linux）
 * 单元生成与装载。设计（openspec 2026-11-18-mxenv-global-panel D5）：
 * - daemon TTL 无限、空闲只锁不关——KeepAlive 会把退出进程重新拉起，
 *   宿主"到点自杀"与常驻语义不自洽，因此 daemon 模式下 TTL/空闲关一律不触发，
 *   会话终结只经显式 shutdown/uninstall。
 * - 端口默认随机（发现走 ~/.mxenv/host/runtime.json，0600）；--port 显式固定
 *   是更大的暴露面（可预测端点），仅供隧道/远程登记场景，install 输出警示。
 * - 值红线不变：单元文件/日志/输出永不含 token 与值；token 每次会话轮换，
 *   只活在 runtime.json（0600）。
 */
import { spawnSync } from 'child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, realpathSync, chmodSync } from 'fs'
import { dirname, join } from 'path'
import { clearHostSession, readHostSession, releaseHostLock } from '@morphixai/mxenv-core'

export const LAUNCHD_LABEL = 'dev.mxenv.panel'
export const SYSTEMD_UNIT = 'mxenv-panel.service'

export type DaemonKind = 'launchd' | 'systemd'

/** launchd 的 GUI 域目标（darwin-only 路径；getuid 在类型面上跨平台可缺）。 */
function guiDomain(): string {
  return `gui/${typeof process.getuid === 'function' ? process.getuid() : 0}`
}

/** 注入面：真实执行走 spawnSync；测试注入记录型替身。 */
export type RunFn = (file: string, args: string[]) => { status: number | null; stdout: string; stderr: string }

const defaultRun: RunFn = (file, args) => {
  const r = spawnSync(file, args, { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }
}

export function daemonKind(platform: string = process.platform): DaemonKind | null {
  if (platform === 'darwin') return 'launchd'
  if (platform === 'linux') return 'systemd'
  return null
}

export function launchdPlistPath(homeDir: string): string {
  return join(homeDir, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`)
}

export function systemdUnitPath(homeDir: string): string {
  return join(homeDir, '.config', 'systemd', 'user', SYSTEMD_UNIT)
}

/**
 * 守护进程的启动命令：解析当前 CLI 入口为绝对稳定路径。
 * - 入口是可执行 shim（volta/bin 等）→ 直接执行（shim 自带解释器定位）；
 * - 入口是 .js/.cjs → 前缀当前 node（process.execPath）。
 */
export function daemonProgram(): string[] {
  let entry = process.argv[1] || ''
  entry = realpathSync(entry)
  if (/\.(js|cjs|mjs)$/.test(entry)) {
    chmodSync(entry, 0o755) // node 直跑需可执行位（launchd/systemd 不走 shell）
    return [process.execPath, entry]
  }
  return [entry]
}

/** launchd plist（XML；RunAtLoad+KeepAlive=常驻；日志进 ~/.mxenv/host/）。 */
export function buildLaunchdPlist(options: { homeDir: string; program: string[]; port?: number }): string {
  const args = [...options.program, 'gui', 'serve', '--daemon']
  if (options.port) args.push('--port', String(options.port))
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${esc(a)}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${esc(options.homeDir)}</string>
  <key>StandardOutPath</key>
  <string>${esc(join(options.homeDir, '.mxenv', 'host', 'daemon.out.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${esc(join(options.homeDir, '.mxenv', 'host', 'daemon.err.log'))}</string>
</dict>
</plist>
`
}

/** systemd --user 单元（Restart=always=常驻）。 */
export function buildSystemdUnit(options: { program: string[]; port?: number }): string {
  const exec = [...options.program, 'gui', 'serve', '--daemon']
  if (options.port) exec.push('--port', String(options.port))
  // systemd 单元值里的空格需转义（ExecStart 逐词切分）
  const execLine = exec.map((a) => (a.includes(' ') ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ')
  return `[Unit]
Description=mxenv panel host (daemon)
After=network.target

[Service]
ExecStart=${execLine}
Restart=always

[Install]
WantedBy=default.target
`
}

export interface InstallResult {
  kind: DaemonKind
  unitPath: string
}

export function installDaemon(options: {
  homeDir: string
  port?: number
  platform?: string
  run?: RunFn
  program?: string[]
}): InstallResult {
  const kind = daemonKind(options.platform)
  if (!kind) throw new Error(`[mxenv] gui install is not supported on "${options.platform}" (macOS launchd / Linux systemd --user only)`)
  const run = options.run || defaultRun
  const program = options.program || daemonProgram()

  if (kind === 'launchd') {
    const plist = launchdPlistPath(options.homeDir)
    mkdirSync(dirname(plist), { recursive: true })
    writeFileSync(plist, buildLaunchdPlist({ homeDir: options.homeDir, program, port: options.port }), { mode: 0o644 })
    const guiDomainTarget = guiDomain()
    // 已装载的旧实例先卸（幂等重装）
    run('launchctl', ['bootout', `${guiDomainTarget}/${LAUNCHD_LABEL}`])
    const boot = run('launchctl', ['bootstrap', guiDomainTarget, plist])
    if (boot.status !== 0) {
      // 旧语法回退（老 macOS 的 launchctl 没有 bootstrap）
      const legacy = run('launchctl', ['load', '-w', plist])
      if (legacy.status !== 0) {
        throw new Error(`[mxenv] launchctl bootstrap failed: ${(boot.stderr || legacy.stderr).trim()}`)
      }
    }
    return { kind, unitPath: plist }
  }

  const unit = systemdUnitPath(options.homeDir)
  mkdirSync(dirname(unit), { recursive: true })
  writeFileSync(unit, buildSystemdUnit({ program, port: options.port }), { mode: 0o644 })
  run('systemctl', ['--user', 'daemon-reload'])
  const enable = run('systemctl', ['--user', 'enable', '--now', SYSTEMD_UNIT])
  if (enable.status !== 0) {
    throw new Error(`[mxenv] systemctl --user enable failed: ${(enable.stderr || '').trim()} (loginctl enable-linger <user> 可让单元脱离登录会话存活)`)
  }
  return { kind, unitPath: unit }
}

export function uninstallDaemon(options: { homeDir: string; platform?: string; run?: RunFn }): InstallResult {
  const kind = daemonKind(options.platform)
  if (!kind) throw new Error(`[mxenv] gui uninstall is not supported on "${options.platform}"`)
  const run = options.run || defaultRun

  // 优雅先行：能找到活会话先 /shutdown（清 runtime.json/锁再退），装卸失败再兜底清理。
  const session = readHostSession(options.homeDir)
  if (session) {
    try {
      spawnSync(
        process.execPath,
        ['-e', `fetch("http://127.0.0.1:${session.port}/shutdown",{method:"POST",headers:{authorization:"Bearer ${session.token}"}}).catch(()=>{})`],
        { timeout: 3_000 },
      )
    } catch {
      /* 宿主已死：本地清理兜底 */
    }
  }

  if (kind === 'launchd') {
    const plist = launchdPlistPath(options.homeDir)
    run('launchctl', ['bootout', `${guiDomain()}/${LAUNCHD_LABEL}`])
    if (existsSync(plist)) rmSync(plist)
  } else {
    const unit = systemdUnitPath(options.homeDir)
    run('systemctl', ['--user', 'disable', '--now', SYSTEMD_UNIT])
    run('systemctl', ['--user', 'daemon-reload'])
    if (existsSync(unit)) rmSync(unit)
  }
  // 幂等双保险（与 gui close 同纪律）
  clearHostSession(options.homeDir)
  releaseHostLock(options.homeDir)
  return { kind, unitPath: kind === 'launchd' ? launchdPlistPath(options.homeDir) : systemdUnitPath(options.homeDir) }
}

/** install 的安全摘要（names-only；含固定端口警示）。 */
export function installSummary(result: InstallResult, port?: number): string {
  const lines = [
    `[mxenv] daemon installed (${result.kind === 'launchd' ? 'launchd' : 'systemd --user'}: ${result.kind === 'launchd' ? LAUNCHD_LABEL : SYSTEMD_UNIT})`,
    `  bind      127.0.0.1 only`,
    port
      ? `  port      ${port} (FIXED — predictable endpoint; intended for tunnels/remote registration, treat as wider exposure)`
      : `  port      random per start (discovery: ~/.mxenv/host/runtime.json, 0600)`,
    `  idle      auto-locks (daemon never expires; values stay behind the unlock window)`,
    `  open      mxenv gui`,
    `  remove    mxenv gui uninstall`,
  ]
  return lines.join('\n')
}
