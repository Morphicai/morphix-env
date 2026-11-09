/**
 * L1 host-runtime：面板宿主会话的运行时发现文件（panel-host design 决策 2/8）。
 * `~/.mxenv/host/`（0700）下的 runtime.json（0600，port/pid/token/startedAt）
 * 随会话生灭——宿主消亡即清，不留常驻凭据。目录与文件权限由本能力单点保证
 * （ux 纪律"外部资源一律经 L1 能力访问"；面板经 API 消费，不读此文件）。
 */
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface HostRuntimeSession {
  port: number
  pid: number
  /** 会话 token：仅存于此 0600 文件与宿主内存/请求头，绝不进 argv、日志或审计。 */
  token: string
  startedAt: string
}

function hostDir(homeDir: string): string {
  return join(homeDir, '.mxenv', 'host')
}

function runtimePath(homeDir: string): string {
  return join(hostDir(homeDir), 'runtime.json')
}

function ensureDir(homeDir: string): void {
  mkdirSync(hostDir(homeDir), { recursive: true, mode: 0o700 })
}

/** 写运行时发现文件（0600；目录 0700）。覆盖任何旧文件。 */
export function writeHostSession(session: HostRuntimeSession, homeDir: string): void {
  ensureDir(homeDir)
  const path = runtimePath(homeDir)
  writeFileSync(path, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 })
  // writeFileSync 的 mode 只在新建时生效；显式再断言一次（幂等无害）。
  try { chmodSync(path, 0o600) } catch { /* 文件系统不支持时保持默认 */ }
}

/** 读运行时发现文件；缺失或结构不合法返回 null（不抛）。 */
export function readHostSession(homeDir: string): HostRuntimeSession | null {
  try {
    const parsed = JSON.parse(readFileSync(runtimePath(homeDir), 'utf8')) as Partial<HostRuntimeSession>
    if (typeof parsed.port !== 'number' || typeof parsed.pid !== 'number' || typeof parsed.token !== 'string' || !parsed.token) {
      return null
    }
    return {
      port: parsed.port,
      pid: parsed.pid,
      token: parsed.token,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
    }
  } catch {
    return null
  }
}

/** 清运行时发现文件（幂等）；会话终止即调用。 */
export function clearHostSession(homeDir: string): void {
  try { rmSync(runtimePath(homeDir), { force: true }) } catch { /* 幂等 */ }
}

/**
 * 启动互斥锁（O_EXCL 语义）：并发启动只产生一个会话（design 决策 2）。
 * 已锁返回 false；成功持锁返回 true。锁随会话释放（releaseHostLock），
 * 崩溃残留由下次 acquire 时的 pid 存活校验自愈（校验属调用方，见宿主启动序列）。
 */
export function acquireHostLock(homeDir: string): boolean {
  ensureDir(homeDir)
  try {
    // flag 'wx' = O_EXCL：存在即失败，一步创建+写入，无 check-then-act 窗口。
    writeFileSync(join(hostDir(homeDir), 'lock'), String(process.pid), { flag: 'wx', mode: 0o600 })
    return true
  } catch {
    return false
  }
}

/** 释放启动互斥锁（幂等）。 */
export function releaseHostLock(homeDir: string): void {
  try { rmSync(join(hostDir(homeDir), 'lock'), { force: true }) } catch { /* 幂等 */ }
}
