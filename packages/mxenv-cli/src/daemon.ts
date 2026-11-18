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
import * as os from 'os'
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
 * - 入口是 .js/.cjs → 前缀当前 node（process.execPath）；
 * - npx 缓存入口（_npx / 临时目录）拒绝安装——缓存即焚，装进去的单元
 *   下次清理就变悬空指针，这是"各种安装情况"里唯一必须硬拒的形态。
 */
export function daemonProgram(): string[] {
  let entry = process.argv[1] || ''
  entry = realpathSync(entry)
  const tmp = typeof os.tmpdir === 'function' ? os.tmpdir() : '/tmp'
  if (entry.includes(`/_npx/`) || (tmp && entry.startsWith(tmp))) {
    throw new Error(
      `[mxenv] cannot install a daemon from an ephemeral entry (${entry}). Install the CLI persistently first (npm i -g mxenv-cli, or from your repo checkout), then run gui install again.`,
    )
  }
  if (/\.(js|cjs|mjs)$/.test(entry)) {
    chmodSync(entry, 0o755) // node 直跑需可执行位（launchd/systemd 不走 shell）
    return [process.execPath, entry]
  }
  return [entry]
}

/**
 * 安装时解析外部 CLI 的稳定绝对路径（which，不追 realpath：volta shim
 * ~/.volta/bin/dotenvx 跨 node 版本稳定，而 realpath 会落进带版本号的
 * image 目录，升级即失效）。解析不到 → 不钉定，靠 PATH 兜底并在摘要提示。
 */
export function resolveCliBin(command: string, run: RunFn = defaultRun): string | null {
  if (process.platform === 'win32') return null
  const r = run('which', [command])
  const out = (r.stdout || '').trim().split('\n').filter(Boolean)
  if (r.status === 0 && out.length && out[0].startsWith('/')) return out[0]
  return null
}

/** 守护环境需要的组合：PATH 兜底（未来 shell-out 型 provider/插件）+ 可钉定的外部 CLI。 */
export function daemonEnvVars(run: RunFn = defaultRun): Record<string, string> {
  const env: Record<string, string> = {}
  if (process.env.PATH) env.PATH = process.env.PATH
  const dotenvx = resolveCliBin('dotenvx', run)
  if (dotenvx) env.MXENV_DOTENVX_BIN = dotenvx
  return env
}

/** launchd plist（XML；RunAtLoad+KeepAlive=常驻；日志进 ~/.mxenv/host/）。 */
export function buildLaunchdPlist(options: { homeDir: string; program: string[]; port?: number; expose?: boolean; envVars?: Record<string, string> }): string {
  const args = [...options.program, 'gui', 'serve', '--daemon']
  if (options.port) args.push('--port', String(options.port))
  if (options.expose) args.push('--expose')
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // launchd 环境的 PATH 是系统默认（/usr/bin:/bin:...）——volta/nvm/homebrew
  // 装的 dotenvx 等 CLI 解析不到。通用化处理：不猜环境，把安装时确定的
  // 事实钉进单元（MXENV_*_BIN 显式钉定 + PATH 兜底），换工具链后重跑
  // `gui install` 即刷新。
  const envVars = options.envVars && Object.keys(options.envVars).length
    ? `  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(options.envVars).map(([k, v]) => `    <key>${esc(k)}</key>\n    <string>${esc(v)}</string>`).join('\n')}
  </dict>
`
    : ''
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
${envVars}  <key>RunAtLoad</key>
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
export function buildSystemdUnit(options: { program: string[]; port?: number; expose?: boolean; envVars?: Record<string, string> }): string {
  const exec = [...options.program, 'gui', 'serve', '--daemon']
  if (options.port) exec.push('--port', String(options.port))
  if (options.expose) exec.push('--expose')
  // systemd 单元值里的空格需转义（ExecStart 逐词切分）
  const execLine = exec.map((a) => (a.includes(' ') ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ')
  // 同 launchd：守护环境无用户 PATH——安装时钉定（MXENV_*_BIN + PATH 兜底）。
  const envLines = options.envVars
    ? Object.entries(options.envVars).map(([k, v]) => `Environment="${k}=${String(v).replace(/"/g, '\\"')}"`).join('\n') + '\n'
    : ''
  return `[Unit]
Description=mxenv panel host (daemon)
After=network.target

[Service]
ExecStart=${execLine}
${envLines}Restart=always

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
  expose?: boolean
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
    writeFileSync(plist, buildLaunchdPlist({ homeDir: options.homeDir, program, port: options.port, expose: options.expose, envVars: daemonEnvVars(run) }), { mode: 0o644 })
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
  writeFileSync(unit, buildSystemdUnit({ program, port: options.port, expose: options.expose, envVars: daemonEnvVars(run) }), { mode: 0o644 })
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

/**
 * 本机首个非内部 IPv4（远程访问提示用）。names-only：只取地址本身，
 * 不探测任何端口/服务；没有可用地址（离线/仅 loopback）返回 null。
 */
export function primaryLanIPv4(interfaces: Readonly<Record<string, ReadonlyArray<{ address: string; family: string; internal: boolean }> | undefined>> = os.networkInterfaces()): string | null {
  for (const list of Object.values(interfaces)) {
    for (const ni of list || []) {
      if (!ni.internal && ni.family === 'IPv4') return ni.address
    }
  }
  return null
}

/** install 的安全摘要（names-only；含固定端口/对外暴露警示）。 */
export function installSummary(result: InstallResult, port?: number, expose?: boolean): string {
  const lines = [
    `[mxenv] daemon installed (${result.kind === 'launchd' ? 'launchd' : 'systemd --user'}: ${result.kind === 'launchd' ? LAUNCHD_LABEL : SYSTEMD_UNIT})`,
    expose
      ? `  bind      0.0.0.0 (EXPOSED — reachable from other machines via this host's IP)`
      : `  bind      127.0.0.1 only`,
    port
      ? `  port      ${port} (FIXED — predictable endpoint; intended for remote/tunnel access, treat as wider exposure)`
      : `  port      random per start (discovery: ~/.mxenv/host/runtime.json, 0600)`,
    `  idle      auto-locks (daemon never expires; values stay behind the unlock window)`,
  ]
  if (expose) {
    const lan = primaryLanIPv4()
    lines.push(
      `  share     http://${lan || '<host-ip>'}:${'{port}'}/<token>/  (run \`mxenv gui status\` / \`mxenv gui --print-editor-url\` on this machine)`,
      `  warning   HTTP is cleartext: the token and any revealed value are readable by`,
      `            on-path network observers. Use only on networks you trust (LAN/VPN),`,
      `            never expose this directly to the public internet.`,
    )
  }
  lines.push(`  open      mxenv gui`, `  remove    mxenv gui uninstall`)
  return lines.join('\n')
}
