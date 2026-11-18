import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import {
  buildLaunchdPlist,
  buildSystemdUnit,
  installDaemon,
  uninstallDaemon,
  daemonKind,
  installSummary,
  resolveCliBin,
  LAUNCHD_LABEL,
  launchdPlistPath,
  systemdUnitPath,
  type RunFn,
} from '../src/daemon'
import { readHostSession, writeHostSession } from '@morphixai/mxenv-core'
import { startHostSession, type HostRuntime } from '../src/host'

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'mxenv-daemon-test-'))
}

/** 记录型 run 替身：默认全成功，可按命令注入失败。 */
function fakeRun(failures: Record<string, string> = {}): { run: RunFn; calls: Array<{ file: string; args: string[] }> } {
  const calls: Array<{ file: string; args: string[] }> = []
  const run: RunFn = (file, args) => {
    calls.push({ file, args })
    const key = `${file} ${args.join(' ')}`
    for (const [needle, stderr] of Object.entries(failures)) {
      if (key.includes(needle)) return { status: 1, stdout: '', stderr }
    }
    return { status: 0, stdout: '', stderr: '' }
  }
  return { run, calls }
}

const PROGRAM = ['/usr/local/bin/node', '/opt/mxenv/dist/cli.js']

describe('unit file builders', () => {
  it('launchd plist: RunAtLoad + KeepAlive + daemon args (+ optional fixed port)', () => {
    const plist = buildLaunchdPlist({ homeDir: '/Users/t', program: PROGRAM, port: 7654 })
    expect(plist).toContain(`<string>${LAUNCHD_LABEL}</string>`)
    expect(plist).toContain('<key>RunAtLoad</key>')
    expect(plist).toContain('<key>KeepAlive</key>')
    expect(plist).toContain('<string>/usr/local/bin/node</string>')
    expect(plist).toContain('<string>gui</string>')
    expect(plist).toContain('<string>serve</string>')
    expect(plist).toContain('<string>--daemon</string>')
    expect(plist).toContain('<string>--port</string>')
    expect(plist).toContain('<string>7654</string>')
    // 固定端口只作为参数出现；无 token、无值
    expect(plist).not.toMatch(/token/i)
  })

  it('launchd plist without a port omits --port entirely', () => {
    const plist = buildLaunchdPlist({ homeDir: '/Users/t', program: PROGRAM })
    expect(plist).not.toContain('--port')
  })

  it('launchd plist escapes XML-significant characters in paths', () => {
    const plist = buildLaunchdPlist({ homeDir: '/Users/t', program: ['/a b/mxenv & co/cli'] })
    expect(plist).toContain('<string>/a b/mxenv &amp; co/cli</string>')
  })

  it('systemd unit: Restart=always + daemon args (+ optional fixed port)', () => {
    const unit = buildSystemdUnit({ program: PROGRAM, port: 7654 })
    expect(unit).toContain('Restart=always')
    expect(unit).toContain('WantedBy=default.target')
    expect(unit).toContain(`ExecStart=${PROGRAM.join(' ')} gui serve --daemon --port 7654`)
    expect(unit).not.toMatch(/token/i)
  })

  it('systemd unit quotes arguments containing spaces', () => {
    const unit = buildSystemdUnit({ program: ['/opt/my mxenv/cli'] })
    expect(unit).toContain('ExecStart="/opt/my mxenv/cli" gui serve --daemon')
  })
})

describe('daemonKind platform gate', () => {
  it('maps darwin→launchd, linux→systemd, others unsupported', () => {
    expect(daemonKind('darwin')).toBe('launchd')
    expect(daemonKind('linux')).toBe('systemd')
    expect(daemonKind('win32')).toBeNull()
  })
})

describe('installDaemon / uninstallDaemon orchestration (launchd path)', () => {
  it('writes the plist, boots out stale instance, bootstraps, prints-ready result', () => {
    const home = tempHome()
    try {
      const { run, calls } = fakeRun()
      const result = installDaemon({ homeDir: home, platform: 'darwin', run, program: PROGRAM, port: 7654 })
      expect(result.kind).toBe('launchd')
      expect(result.unitPath).toBe(launchdPlistPath(home))
      expect(existsSync(launchdPlistPath(home))).toBe(true)
      const plist = readFileSync(launchdPlistPath(home), 'utf8')
      expect(plist).toContain('<string>7654</string>')
      const bootout = calls.find((c) => c.args.includes('bootout'))
      const bootstrap = calls.find((c) => c.args.includes('bootstrap'))
      expect(bootout?.args.join(' ')).toContain(LAUNCHD_LABEL)
      expect(bootstrap?.args[bootstrap.args.length - 1]).toBe(launchdPlistPath(home))
      // bootstrap 面向 gui/<uid> 域
      expect(bootstrap?.args[1]).toMatch(/^gui\/\d+$/)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('falls back to launchctl load when bootstrap is unavailable', () => {
    const home = tempHome()
    try {
      const { run, calls } = fakeRun({ 'bootstrap gui': 'Bootstrap failed: 5' })
      installDaemon({ homeDir: home, platform: 'darwin', run, program: PROGRAM })
      expect(calls.some((c) => c.args[0] === 'load' && c.args.includes('-w'))).toBe(true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('fails closed when both bootstrap and load fail', () => {
    const home = tempHome()
    try {
      const { run } = fakeRun({ 'bootstrap gui': 'no', 'load -w': 'no' })
      expect(() => installDaemon({ homeDir: home, platform: 'darwin', run, program: PROGRAM })).toThrowError(/launchctl bootstrap failed/)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('uninstall boots out, removes the plist, and clears session leftovers', () => {
    const home = tempHome()
    try {
      const { run: runInstall } = fakeRun()
      installDaemon({ homeDir: home, platform: 'darwin', run: runInstall, program: PROGRAM })
      // simulate a leftover session file (dead host)
      writeHostSession({ port: 41234, pid: 999999, token: `tok_${randomUUID()}`, startedAt: new Date().toISOString() }, home)
      const { run, calls } = fakeRun()
      uninstallDaemon({ homeDir: home, platform: 'darwin', run })
      expect(calls.some((c) => c.args.includes('bootout'))).toBe(true)
      expect(existsSync(launchdPlistPath(home))).toBe(false)
      expect(readHostSession(home)).toBeNull()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('unsupported platform fails with an explicit message', () => {
    expect(() => installDaemon({ homeDir: '/nope', platform: 'win32', run: fakeRun().run, program: PROGRAM })).toThrowError(/not supported/)
  })
})

describe('installDaemon (systemd path)', () => {
  it('writes the unit, reloads, enables --now', () => {
    const home = tempHome()
    try {
      const { run, calls } = fakeRun()
      const result = installDaemon({ homeDir: home, platform: 'linux', run, program: PROGRAM, port: 7654 })
      expect(result.kind).toBe('systemd')
      expect(result.unitPath).toBe(systemdUnitPath(home))
      expect(readFileSync(systemdUnitPath(home), 'utf8')).toContain('--port 7654')
      expect(calls.some((c) => c.args.join(' ').includes('daemon-reload'))).toBe(true)
      expect(calls.some((c) => c.args.join(' ').includes('enable --now mxenv-panel.service'))).toBe(true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('uninstall disables --now, removes the unit, clears the session', () => {
    const home = tempHome()
    try {
      const { run: runInstall } = fakeRun()
      installDaemon({ homeDir: home, platform: 'linux', run: runInstall, program: PROGRAM })
      writeHostSession({ port: 41234, pid: 999999, token: `tok_${randomUUID()}`, startedAt: new Date().toISOString() }, home)
      const { run, calls } = fakeRun()
      uninstallDaemon({ homeDir: home, platform: 'linux', run })
      expect(calls.some((c) => c.args.join(' ').includes('disable --now'))).toBe(true)
      expect(existsSync(systemdUnitPath(home))).toBe(false)
      expect(readHostSession(home)).toBeNull()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('installSummary', () => {
  it('names the manager, states loopback/idle-lock, and warns on fixed ports', () => {
    const withPort = installSummary({ kind: 'launchd', unitPath: '/x' }, 7654)
    expect(withPort).toContain('launchd')
    expect(withPort).toContain('127.0.0.1')
    expect(withPort).toContain('auto-locks')
    expect(withPort).toContain('FIXED')
    const random = installSummary({ kind: 'systemd', unitPath: '/x' })
    expect(random).toContain('random per start')
    expect(random).not.toContain('FIXED')
  })
})

describe('daemon host semantics', () => {
  it('daemon sessions never expire (idle/TTL walls only lock, not close)', async () => {
    const home = tempHome()
    const root = tempHome()
    try {
      mkdirSync(join(root, '.mxenv'), { recursive: true })
      const started = await startHostSession({ homeDir: home, cwd: root, daemon: true, entries: [] })
      if (!('runtime' in started)) throw new Error('fresh session expected')
      const runtime: HostRuntime = started.runtime
      const base = `http://127.0.0.1:${(runtime.server.address() as { port: number }).port}`
      // 把墙钟推到远超 TTL/空闲关：daemon 仍必须活着
      runtime.state.startedAt = Date.now() - 24 * 60 * 60_000
      runtime.state.lastActivityAt = Date.now() - 24 * 60 * 60_000
      const res = await fetch(`${base}/status`, { headers: { authorization: `Bearer ${runtime.state.token}` } })
      expect(res.status).toBe(200)
      expect(((await res.json()) as { locked: boolean }).locked).toBe(true)
      await runtime.close()
    } finally {
      rmSync(home, { recursive: true, force: true })
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('a fixed port is honored (fail-closed listener for daemon/tunnel use)', async () => {
    const home = tempHome()
    try {
      const port = 41000 + Math.floor(Math.random() * 1000)
      const started = await startHostSession({ homeDir: home, cwd: home, daemon: true, port, entries: [] })
      if (!('runtime' in started)) throw new Error('fresh session expected')
      expect((started.runtime.server.address() as { port: number }).port).toBe(port)
      await started.runtime.close()
      // 端口已释放后二次占用：应抛错而非静默改随机（fail-closed）
      const first = await startHostSession({ homeDir: mkdtempSync(join(tmpdir(), 'mxenv-daemon-test-')), cwd: home, daemon: true, port, entries: [] })
      if (!('runtime' in first)) throw new Error('unexpected')
      await expect(
        startHostSession({ homeDir: mkdtempSync(join(tmpdir(), 'mxenv-daemon-test-')), cwd: home, daemon: true, port, entries: [] }),
      ).rejects.toThrow()
      await first.runtime.close()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('daemon environment generality (no reliance on the installing shell)', () => {
  it('builders embed envVars dict — launchd EnvironmentVariables', () => {
    const plist = buildLaunchdPlist({
      homeDir: '/Users/t',
      program: PROGRAM,
      envVars: { PATH: '/usr/local/bin:/opt/homebrew/bin', MXENV_DOTENVX_BIN: '/Users/t/.volta/bin/dotenvx' },
    })
    expect(plist).toContain('<key>EnvironmentVariables</key>')
    expect(plist).toContain('<string>/usr/local/bin:/opt/homebrew/bin</string>')
    expect(plist).toContain('<string>/Users/t/.volta/bin/dotenvx</string>')
    expect(plist).not.toMatch(/token/i)
  })

  it('builders embed envVars — systemd Environment= lines', () => {
    const unit = buildSystemdUnit({ program: PROGRAM, envVars: { PATH: '/a:/b', MXENV_DOTENVX_BIN: '/home/u/.local/bin/dotenvx' } })
    expect(unit).toContain('Environment="PATH=/a:/b"')
    expect(unit).toContain('Environment="MXENV_DOTENVX_BIN=/home/u/.local/bin/dotenvx"')
  })

  it('builders omit the env block entirely when nothing to pin', () => {
    expect(buildLaunchdPlist({ homeDir: '/Users/t', program: PROGRAM })).not.toContain('EnvironmentVariables')
    expect(buildSystemdUnit({ program: PROGRAM })).not.toContain('Environment=')
  })

  it('resolveCliBin takes the first absolute which hit; null on miss', () => {
    const ok: RunFn = () => ({ status: 0, stdout: '/Users/t/.volta/bin/dotenvx\n', stderr: '' })
    expect(resolveCliBin('dotenvx', ok)).toBe('/Users/t/.volta/bin/dotenvx')
    const miss: RunFn = () => ({ status: 1, stdout: '', stderr: 'not found' })
    expect(resolveCliBin('dotenvx', miss)).toBeNull()
    const relative: RunFn = () => ({ status: 0, stdout: 'dotenvx\n', stderr: '' })
    expect(resolveCliBin('dotenvx', relative)).toBeNull()
  })

  it('installDaemon pins dotenvx via which and keeps PATH as fallback', () => {
    const home = tempHome()
    try {
      const base = fakeRun()
      const run: RunFn = (file, args) => {
        if (file === 'which' && args[0] === 'dotenvx') return { status: 0, stdout: '/Users/t/.volta/bin/dotenvx\n', stderr: '' }
        return base.run(file, args)
      }
      installDaemon({ homeDir: home, platform: 'darwin', run, program: PROGRAM })
      const plist = readFileSync(launchdPlistPath(home), 'utf8')
      expect(plist).toContain('<key>MXENV_DOTENVX_BIN</key>')
      expect(plist).toContain('<string>/Users/t/.volta/bin/dotenvx</string>')
      if (process.env.PATH) expect(plist).toContain('<key>PATH</key>')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('installDaemon survives without dotenvx installed (PATH-only unit)', () => {
    const home = tempHome()
    try {
      const base = fakeRun()
      const run: RunFn = (file, args) => {
        if (file === 'which') return { status: 1, stdout: '', stderr: 'not found' }
        return base.run(file, args)
      }
      installDaemon({ homeDir: home, platform: 'darwin', run, program: PROGRAM })
      const plist = readFileSync(launchdPlistPath(home), 'utf8')
      expect(plist).not.toContain('MXENV_DOTENVX_BIN')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
