import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')

interface ProbeOutput {
  resolved: string
  calls: { label: string; arg?: string }[]
  unpatched: string[]
  exports: string[]
}

// 探针只跑一次，多个用例共享快照（进程级 import 行为一次就够）。
let probeCache: ProbeOutput | null = null
function runProbe(): ProbeOutput {
  if (probeCache) return probeCache
  // 探针跑在干净的 node 子进程：vitest 自身的模块加载会碰 fs，进程内 spy 会假阳。
  // timeout 兜底：探针在进程退出时才输出快照，import 的模块若挂住事件循环
  // （如长 timer）则探针不退出——被挂住本身就是可疑信号，判红。
  const res = spawnSync(process.execPath, [path.join(here, 'support', 'noio-probe.cjs')], {
    cwd: pkgRoot,
    encoding: 'utf8',
    timeout: 10_000,
  })
  if (res.error) {
    throw new Error(
      `探针子进程失败（超时/启动错误）：${res.error.message}\n` +
        `signal: ${res.signal ?? 'none'}\nstdout: ${res.stdout ?? ''}\nstderr: ${res.stderr ?? ''}`,
    )
  }
  expect(res.status, res.stderr).toBe(0)

  let parsed: ProbeOutput
  try {
    parsed = JSON.parse(res.stdout)
  } catch (error) {
    // N1：被测模块 import 时向 stdout 打印会污染探针输出，报错必须带回原文才可定位
    throw new Error(
      `探针输出非 JSON：${(error as Error).message}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`,
    )
  }
  probeCache = parsed
  return parsed
}

describe('mxenv-core/contracts 入口', () => {
  it('包名自引用经 exports map 解析到 dist 产物，且 import 无 IO 副作用（仅允许加载器读取模块自身源文件）', () => {
    const out = runProbe()

    expect(out.resolved).toBe(path.join(pkgRoot, 'dist', 'contracts.js'))
    // S1：补丁自检——存在却未能包装的面会让探针退化为假绿，必须为空
    expect(out.unpatched).toEqual([])
    // 白名单：Node CJS 加载器读取模块自身源文件属机制性 IO（实证
    // node:internal/modules/cjs/loader：toRealPath → fs.realpathSync、
    // defaultLoadImpl → fs.readFileSync），不是模块代码的副作用；除此之外
    // 任何调用都算 import 触发了 IO。仅按 label + resolved 精确路径串匹配放行，
    // 不按 label 放宽。Node 版本敏感——加载器机制性调用形态若变，先看这里。
    const unexpected = out.calls.filter(
      (c) =>
        !(
          (c.label === 'fs.readFileSync' || c.label === 'fs.realpathSync') &&
          c.arg === out.resolved
        ),
    )
    expect(unexpected).toEqual([])
  })

  it('契约导出面不含值能力（compose/revealSingle 唯一实现留主入口）', () => {
    const out = runProbe()
    for (const name of ['compose', 'composeEnvironment', 'revealSingle']) {
      expect(out.exports, `/contracts 不应导出值能力 ${name}`).not.toContain(name)
    }
  })

  it('契约符号确实落在 /contracts 导出面', () => {
    const out = runProbe()
    for (const name of [
      'CONFIG_FILE',
      'normalizeProfile',
      'validateConfig',
      'isPublicKey',
      'CompositionError',
      'collectRedactionValues',
      'findMxEnvReferences',
      'hasMxEnvReference',
      'StreamingRedactor',
      'isRedactableValue',
      'highCollisionValueKeys',
      'infisicalEnvPins',
      'LEGACY_INFISICAL_SOURCE',
      'MIN_REDACTABLE_VALUE_LENGTH',
      'SHORT_VALUE_WARN_LENGTH',
    ]) {
      expect(out.exports, `/contracts 应导出契约符号 ${name}`).toContain(name)
    }
  })

  it('导出面白名单闭合：任何新增导出必须显式登记（防别名绕过值能力黑名单）', () => {
    const out = runProbe()
    // 黑名单（上一用例）挡不住 `export { composeEnvironment as composeEnv }` 这类别名；
    // 导出面增长必须落在此清单的显式变更里（referencePattern 等已登记在册）。
    const expected = [
      'CONFIG_FILE',
      'CompositionError',
      'GLOBAL_CONFIG_DIR',
      'GLOBAL_CONFIG_FILE',
      'GLOBAL_ENV_FILE',
      'LEGACY_INFISICAL_SOURCE',
      'StreamingRedactor',
      'collectRedactionValues',
      'findMxEnvReferences',
      'hasMxEnvReference',
      'highCollisionValueKeys',
      'infisicalEnvPins',
      'isPublicKey',
      'isRedactableValue',
      'MIN_REDACTABLE_VALUE_LENGTH',
      'SHORT_VALUE_WARN_LENGTH',
      'normalizeProfile',
      'referencePattern',
      'validateConfig',
    ].sort()
    expect([...out.exports].sort()).toEqual(expected)
  })

  it('双入口产物齐备（exports map 接线）', () => {
    for (const f of [
      'dist/index.js',
      'dist/index.d.ts',
      'dist/contracts.js',
      'dist/contracts.d.ts',
    ]) {
      expect(existsSync(path.join(pkgRoot, f)), `${f} 缺失（test 脚本应已先 build）`).toBe(true)
    }
  })
})


// ─── 短值脱敏豁免与碰撞告警（issue #31）─────────────────

import {
  collectRedactionValues,
  highCollisionValueKeys,
  type KeyProvenance,
} from '../src/contracts'

describe('redaction value policy (issue #31)', () => {
  const prov = (key: string): KeyProvenance => ({
    key, source: 'test', provider: 'local', precedence: 0, overriddenSources: [],
  })
  const environment = {
    SHORT_ONE: '1',
    SHORT_TWO: 'ab',
    SHORT_THREE: 'xyz',
    LONG: 'a-real-long-secret-value',
    EMPTY: '',
    NEXT_PUBLIC_SHORT: 'sh',
  } as unknown as NodeJS.ProcessEnv
  const provenance = {
    SHORT_ONE: prov('SHORT_ONE'),
    SHORT_TWO: prov('SHORT_TWO'),
    SHORT_THREE: prov('SHORT_THREE'),
    NEXT_PUBLIC_SHORT: prov('NEXT_PUBLIC_SHORT'),
    LONG: prov('LONG'),
    EMPTY: prov('EMPTY'),
  }

  it('collectRedactionValues 丢弃 ≤2 字符值，保留 ≥3 字符值', () => {
    expect(collectRedactionValues(environment, provenance).sort()).toEqual(['a-real-long-secret-value', 'xyz'])
  })

  it('highCollisionValueKeys 只点名 1–4 字符的非公开 key；空值与公开前缀不含', () => {
    expect(highCollisionValueKeys(environment, provenance)).toEqual(['SHORT_ONE', 'SHORT_THREE', 'SHORT_TWO'])
  })
})

// ─── Infisical env 钉定分析（doctor / inspect 预警） ─────────

import { infisicalEnvPins, LEGACY_INFISICAL_SOURCE, type MxEnvConfig } from '../src/contracts'

describe('infisicalEnvPins', () => {
  const config: MxEnvConfig = {
    infisical: { paths: ['/ai'] },
    sources: {
      named: { provider: 'infisical', paths: ['/team'], env: 'staging' },
      local: { provider: 'local', files: ['.env.local'], optional: true },
    },
  }

  it('报告 legacy 块与命名 source，忽略非 infisical source', () => {
    const pins = infisicalEnvPins(config, { processEnv: {} })
    expect(pins.map((p) => p.name)).toEqual([LEGACY_INFISICAL_SOURCE, 'named'])
  })

  it('配置钉定 env：pinned，优先级高于一切运行时来源', () => {
    const [legacy, named] = infisicalEnvPins(config, { envName: 'dev', processEnv: { DEPLOY_ENV: 'prod' } })
    expect(named).toEqual({ name: 'named', pinned: true, env: 'staging', resolvedVia: 'pinned' })
    expect(legacy.pinned).toBe(false)
  })

  it('未钉定时按 --env → DEPLOY_ENV → INFISICAL_ENV 顺序解析', () => {
    const viaCli = infisicalEnvPins(config, { envName: 'dev', processEnv: {} })[0]
    expect(viaCli).toMatchObject({ pinned: false, env: 'dev', resolvedVia: 'cli-env' })
    const viaDeploy = infisicalEnvPins(config, { processEnv: { DEPLOY_ENV: 'prod', INFISICAL_ENV: 'other' } })[0]
    expect(viaDeploy).toMatchObject({ env: 'prod', resolvedVia: 'deploy-env' })
    const viaInfisical = infisicalEnvPins(config, { processEnv: { INFISICAL_ENV: 'dev' } })[0]
    expect(viaInfisical).toMatchObject({ env: 'dev', resolvedVia: 'infisical-env' })
  })

  it('全部来源缺失时 fail-closed：env 为 null', () => {
    const [legacy] = infisicalEnvPins(config, { processEnv: {} })
    expect(legacy).toEqual({ name: LEGACY_INFISICAL_SOURCE, pinned: false, env: null, resolvedVia: null })
  })

  it('空配置返回空数组', () => {
    expect(infisicalEnvPins({}, { processEnv: {} })).toEqual([])
  })
})
