import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { LocalCliMissingError, resolveLocalCli, spawnLocalCliWrite } from '../src/local-cli'

// 4.2 项目态写操作 spawn 对齐（spec package-boundary「项目态写操作版本对齐」）：
// 全局 CLI 的项目写必须由项目本地 CLI 执行（钉定版本），解析序 cwd →
// node_modules/.bin → PATH；解析失败硬失败给安装指引，绝不以全局引擎改写。

const TMP = join(tmpdir(), `mx-env-localcli-${randomUUID()}`)
const PROJECT = join(TMP, 'project')

/** 桩 CLI：把每次执行记录到 marker，模拟“项目本地 0.12.x CLI 执行写入”。 */
function writeStubCli(dir: string, name: string, marker: string, who: string): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, `#!/bin/sh\necho "who:${who}" >> ${JSON.stringify(marker)}\necho "argv:$*" >> ${JSON.stringify(marker)}\n`)
  chmodSync(path, 0o755)
  return path
}

function readMarker(marker: string): string {
  return existsSync(marker) ? readFileSync(marker, 'utf8') : ''
}

/** 递归快照目录（路径+文件内容）：零写入断言用它抓 resolve 前的任何落盘。 */
function snapshotTree(dir: string): string[] {
  const out: string[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(current, entry.name)
      const rel = full.slice(dir.length)
      if (entry.isDirectory()) {
        out.push(`dir ${rel}`)
        walk(full)
      } else {
        out.push(`file ${rel} ${readFileSync(full, 'utf8')}`)
      }
    }
  }
  walk(dir)
  return out
}

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(PROJECT, { recursive: true })
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('resolveLocalCli', () => {
  it('prefers cwd node_modules/.bin over PATH (ensureCommand order)', () => {
    const marker = join(TMP, 'm1')
    const local = writeStubCli(join(PROJECT, 'node_modules', '.bin'), 'mx-env', marker, 'local')
    const pathDir = join(TMP, 'pathbin')
    writeStubCli(pathDir, 'mx-env', marker, 'path')
    expect(resolveLocalCli(PROJECT, { PATH: pathDir })).toBe(local)
  })

  it('新名 mxenv 优先于旧名 alias（本地并存时取新名）', () => {
    const marker = join(TMP, 'm4')
    const binDir = join(PROJECT, 'node_modules', '.bin')
    const primary = writeStubCli(binDir, 'mxenv', marker, 'new-name')
    writeStubCli(binDir, 'mx-env', marker, 'legacy-name')
    expect(resolveLocalCli(PROJECT, { PATH: '' })).toBe(primary)
  })

  it('falls back to PATH when the project has no local install', () => {
    const marker = join(TMP, 'm2')
    const pathDir = join(TMP, 'pathbin')
    const onPath = writeStubCli(pathDir, 'mx-env', marker, 'path')
    expect(resolveLocalCli(PROJECT, { PATH: pathDir })).toBe(onPath)
  })

  it('resolves the morphix-env alias bin and returns null when nothing resolves', () => {
    const marker = join(TMP, 'm3')
    const alias = writeStubCli(join(PROJECT, 'node_modules', '.bin'), 'morphix-env', marker, 'alias')
    expect(resolveLocalCli(PROJECT, { PATH: '' })).toBe(alias)
    // 清掉本地 stub 后什么也不应解析到（同一 tmp 夹具须先移除再断言 null）。
    rmSync(join(PROJECT, 'node_modules'), { recursive: true })
    expect(resolveLocalCli(PROJECT, { PATH: '/nonexistent-dir' })).toBeNull()
  })
})

describe('spawnLocalCliWrite', () => {
  it('项目写走本地版本：写操作由项目本地 CLI 执行，PATH 干扰项不接手', () => {
    const marker = join(TMP, 'write-marker')
    writeStubCli(join(PROJECT, 'node_modules', '.bin'), 'mx-env', marker, 'project-local-0.12.x')
    const decoyDir = join(TMP, 'decoybin')
    writeStubCli(decoyDir, 'mx-env', marker, 'path-decoy')

    const status = spawnLocalCliWrite(['edit', '--source', 'local'], {
      cwd: PROJECT,
      env: { PATH: decoyDir },
    })
    expect(status).toBe(0)
    const log = readMarker(marker)
    expect(log).toContain('who:project-local-0.12.x')
    expect(log).toContain('argv:edit --source local')
    expect(log).not.toContain('path-decoy')
  })

  it('无本地 CLI 明确失败：硬失败带安装指引，不做任何写入', () => {
    const marker = join(TMP, 'write-marker')
    const before = snapshotTree(PROJECT)
    // PATH 里也没有任何 mx-env/morphix-env。
    expect(() => spawnLocalCliWrite(['edit'], { cwd: PROJECT, env: { PATH: '/usr/bin:/bin' } }))
      .toThrowError(LocalCliMissingError)
    try {
      spawnLocalCliWrite(['edit'], { cwd: PROJECT, env: { PATH: '/usr/bin:/bin' } })
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('npm i -D @morphixai/mxenv')
      expect(message).toContain('Refusing to write project data')
    }
    expect(readMarker(marker)).toBe('')
    // 全目录快照对比：不只 marker——任何 resolve 前落盘（审计/缓存）都判红。
    expect(snapshotTree(PROJECT)).toEqual(before)
  })

  it('子进程退出码原样返回（写失败不吞）', () => {
    const dir = join(PROJECT, 'node_modules', '.bin')
    mkdirSync(dir, { recursive: true })
    const failing = join(dir, 'mx-env')
    writeFileSync(failing, '#!/bin/sh\nexit 9\n')
    chmodSync(failing, 0o755)
    expect(spawnLocalCliWrite(['edit'], { cwd: PROJECT, env: { PATH: '' } })).toBe(9)
  })
})
