/**
 * L1 项目注册表（global-panel design 决策 D1）：`~/.mxenv/projects.json`（0600）
 * 是"这台机器被 mxenv 托管过的项目"的诚实清单——**登记而非发现**（不扫盘）。
 *
 * - 登记时机：项目级 run/edit 首次成功组合后幂等登记（registerProject）。
 * - 资格线：目录内存在项目接线层——`mxenv.config.json`（现代/legacy 字段都
 *   算"被托管"）或 `.mxenv/` 目录；一次性 CI/临时目录不进表。
 * - `lastSeenAt` 每次组合刷新，写节流 60s（同路径短时间重复 run 不重复写盘）。
 * - `MXENV_NO_PROJECT_REGISTRY=1` 全局旁路（读返回空清单，写直接跳过）。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { basename, join, resolve } from 'path'
import { CONFIG_FILE } from './contracts'

export interface ProjectRegistryEntry {
  /** 显示名 = basename(path)；路径不同重名时加后缀 -2/-3… */
  name: string
  /** 项目根（config 层 baseDir），绝对路径。同路径幂等。 */
  path: string
  addedAt: string
  lastSeenAt: string
}

/** lastSeenAt 刷新的写节流窗口：同路径 60s 内不重复写盘。 */
const LAST_SEEN_THROTTLE_MS = 60_000

function registryPath(homeDir: string): string {
  return join(homeDir, '.mxenv', 'projects.json')
}

function registryDisabled(): boolean {
  return process.env.MXENV_NO_PROJECT_REGISTRY === '1'
}

function readEntries(path: string): ProjectRegistryEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { projects?: ProjectRegistryEntry[] }
    if (!Array.isArray(parsed.projects)) return []
    return parsed.projects.filter(
      (e): e is ProjectRegistryEntry =>
        typeof e?.name === 'string' && typeof e?.path === 'string' && typeof e?.addedAt === 'string',
    )
  } catch {
    return []
  }
}

/** 读注册表（旁路或损坏 → 空清单，绝不抛：注册表故障不得影响 run/edit）。 */
export function readProjectRegistry(homeDir = homedir()): ProjectRegistryEntry[] {
  if (registryDisabled()) return []
  return readEntries(registryPath(homeDir))
}

/** 目录是否有托管资格：存在项目接线层——`mxenv.config.json`（主）或 `.mxenv/` 目录。 */
export function isRegistryEligible(baseDir: string): boolean {
  if (existsSync(join(baseDir, CONFIG_FILE))) return true
  return existsSync(join(baseDir, '.mxenv'))
}

/** 同名不同路径时取未占用的后缀名（demo → demo-2 → demo-3…）。 */
function uniqueName(entries: ProjectRegistryEntry[], base: string, selfPath: string): string {
  const taken = new Set(entries.filter((e) => e.path !== selfPath).map((e) => e.name))
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * 幂等登记/刷新（首次成功组合后调用）：
 * - 新路径 → 追加（name 冲突加后缀）；既有路径 → 仅刷新 lastSeenAt（60s 节流）。
 * - 返回是否发生了写盘（便于测试断言节流）。
 */
export function registerProject(baseDir: string, homeDir = homedir()): boolean {
  if (registryDisabled()) return false
  const path = registryPath(homeDir)
  const entries = readEntries(path)
  const absolute = resolve(baseDir)
  const now = new Date().toISOString()
  const existing = entries.find((e) => e.path === absolute)
  if (existing) {
    if (Date.now() - Date.parse(existing.lastSeenAt || existing.addedAt) < LAST_SEEN_THROTTLE_MS) return false
    existing.lastSeenAt = now
  } else {
    entries.push({ name: uniqueName(entries, basename(absolute) || absolute, absolute), path: absolute, addedAt: now, lastSeenAt: now })
  }
  mkdirSync(join(homeDir, '.mxenv'), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ projects: entries }, null, 2)}\n`, { mode: 0o600 })
  try { chmodSync(path, 0o600) } catch { /* 文件系统不支持时保持默认 */ }
  return true
}

/** 显式移除（按路径或显示名，幂等）；返回是否写盘。 */
export function removeProject(target: string, homeDir = homedir()): boolean {
  if (registryDisabled()) return false
  const path = registryPath(homeDir)
  const entries = readEntries(path)
  const absolute = target.startsWith('/') ? resolve(target) : null
  const next = entries.filter((e) => (absolute ? e.path !== absolute : e.name !== target))
  if (next.length === entries.length) return false
  if (next.length === 0) {
    try { rmSync(path, { force: true }) } catch { /* 幂等 */ }
    return true
  }
  writeFileSync(path, `${JSON.stringify({ projects: next }, null, 2)}\n`, { mode: 0o600 })
  try { chmodSync(path, 0o600) } catch { /* 同上 */ }
  return true
}

/** 清除 path 已不存在的条目（注册表膨胀兜底）；返回被清除的路径。 */
export function pruneProjects(homeDir = homedir()): string[] {
  if (registryDisabled()) return []
  const path = registryPath(homeDir)
  const entries = readEntries(path)
  const stale = entries.filter((e) => !existsSync(e.path))
  if (stale.length === 0) return []
  const next = entries.filter((e) => existsSync(e.path))
  writeFileSync(path, `${JSON.stringify({ projects: next }, null, 2)}\n`, { mode: 0o600 })
  try { chmodSync(path, 0o600) } catch { /* 同上 */ }
  return stale.map((e) => e.path)
}
