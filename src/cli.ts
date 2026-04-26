#!/usr/bin/env node

import { loadEnvFiles, extractPublicVars, parseEnvFile } from './env'
import { getInfisicalConfig, fetchInfisicalSecrets, hasInfisicalCLI, fetchSecretsViaCLI, readInfisicalJson, isInfisicalLoggedIn } from './infisical'
import { loadConfig, type MxEnvConfig } from './config'
import spawn from 'cross-spawn'
import { writeFileSync, mkdirSync, readFileSync } from 'fs'
import { dirname, resolve } from 'path'

function getVersion() {
  try {
    const packageJsonPath = resolve(__dirname, '..', 'package.json')
    return JSON.parse(readFileSync(packageJsonPath, 'utf8')).version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

const VERSION = getVersion()
const DEFAULT_ENV_FILE = '.env.local'

// ─── 参数解析 ─────────────────────────────────────────────

interface Args {
  command: string
  subArgs: string[]
  envFiles: string[]
  outFile: string | null
  verbose: boolean
  filter: string | null
  noInfisical: boolean
  env: string | null
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: '',
    subArgs: [],
    envFiles: [],
    outFile: null,
    verbose: false,
    filter: null,
    noInfisical: false,
    env: null,
  }

  let i = 2 // skip node, script
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
      i++
      if (argv[i]) args.envFiles.push(argv[i])
    } else if (arg === '--out' || arg === '-o') {
      i++
      if (argv[i]) args.outFile = argv[i]
    } else if (arg === '--filter') {
      i++
      if (argv[i]) args.filter = argv[i]
    } else if (arg === '--env' || arg === '-e') {
      i++
      if (argv[i]) args.env = argv[i]
    } else if (arg === '--verbose' || arg === '-v') {
      args.verbose = true
    } else if (arg === '--no-infisical') {
      args.noInfisical = true
    } else {
      // run 命令没有 -- 分隔符时，剩余全部是子命令
      if (args.command === 'run') {
        args.subArgs = argv.slice(i)
        break
      }
    }

    i++
  }

  return args
}

/** 合并 CLI 参数和配置文件 */
function mergeWithConfig(args: Args, config: MxEnvConfig): Args {
  // envFiles: CLI 指定的优先，没有则用配置文件的，都没有则用默认
  if (args.envFiles.length === 0) {
    args.envFiles = config.envFiles || [DEFAULT_ENV_FILE]
  }

  // outFile: CLI 优先，没有则用配置文件的
  if (!args.outFile && config.generate) {
    args.outFile = config.generate.out
  }

  // filter: CLI 优先
  if (!args.filter && config.generate?.filter) {
    args.filter = config.generate.filter
  }

  return args
}

// ─── 核心流程：加载所有 env ──────────────────────────────────

async function loadAllEnv(args: Args, config: MxEnvConfig) {
  // 1. Infisical 拉取（低优先级，不覆盖已有值）
  if (!args.noInfisical) {
    const env = args.env || process.env.DEPLOY_ENV || process.env.INFISICAL_ENV || 'prod'
    const paths = config.infisical?.paths || ['/']

    // 优先尝试 Machine Identity（SDK）— Docker/CI 场景
    // projectId 解析优先级: INFISICAL_PROJECT_ID > config.infisical.projectId > .infisical.json workspaceId
    const resolvedProjectId: string = process.env.INFISICAL_PROJECT_ID
      || config.infisical?.projectId
      || readInfisicalJson().workspaceId
      || ''

    const infisicalConfig = config.infisical
      ? {
          clientId: process.env.INFISICAL_CLIENT_ID || '',
          clientSecret: process.env.INFISICAL_CLIENT_SECRET || '',
          projectId: resolvedProjectId,
          environment: env,
          paths,
          siteUrl: config.infisical.siteUrl,
        }
      : getInfisicalConfig()

    const envPrefix = config.infisical?.envPrefix

    if (infisicalConfig && infisicalConfig.clientId && infisicalConfig.clientSecret) {
      try {
        const count = await fetchInfisicalSecrets(infisicalConfig, envPrefix)
        console.log(`[morphix-env] Infisical SDK: loaded ${count} secrets (${env}: ${paths.join(', ')})${envPrefix ? ` [prefix: ${envPrefix}]` : ''}`)
      } catch (e: any) {
        failHardWithSdkError(e)
      }
    }
    // Fallback: 尝试 infisical CLI（本地开发场景，用户手动 login）
    else if (hasInfisicalCLI()) {
      // 进入 CLI 流程前先做登录态检查，避免后续每个 path 都报同一个错
      if (!isInfisicalLoggedIn()) {
        failNotLoggedIn(env)
      }

      const { count, errors } = fetchSecretsViaCLI(env, paths, envPrefix)
      const notLoggedIn = errors.find((e) => e.kind === 'not-logged-in')
      const noProject = errors.find((e) => e.kind === 'no-project')

      if (notLoggedIn) {
        failNotLoggedIn(env)
      }
      if (noProject) {
        failNoProject(noProject.stderr)
      }

      if (count > 0) {
        console.log(`[morphix-env] Infisical CLI: loaded ${count} secrets (${env}: ${paths.join(', ')})${envPrefix ? ` [prefix: ${envPrefix}]` : ''}`)
        if (errors.length > 0 && args.verbose) {
          for (const e of errors) {
            console.warn(`[morphix-env] Infisical CLI: path "${e.path}" failed (${e.kind}): ${e.stderr.trim()}`)
          }
        }
      } else {
        // count=0 且没有可识别的登录/项目错误：要么所有 path 都没 secrets，要么是其他 CLI 错误
        const otherErr = errors.find((e) => e.kind === 'other')
        if (otherErr) {
          console.error(`[morphix-env] Infisical CLI: failed for env="${env}", path="${otherErr.path}"`)
          console.error(otherErr.stderr.trim())
          process.exit(1)
        }
        // 真的就是没 secret，给个温和的告警，让 .env.local 兜底
        console.warn(`[morphix-env] Infisical CLI: no secrets found for env="${env}" (paths: ${paths.join(', ')})`)
      }
    } else if (args.verbose) {
      console.log('[morphix-env] Infisical: skipped (no SDK credentials, no CLI)')
    } else {
      // 非 verbose 也要让用户知道走了"裸跑"路径，否则缺 env 时排查很痛苦
      console.warn('[morphix-env] Infisical: skipped (no SDK credentials, no `infisical` CLI installed)')
      console.warn('[morphix-env] Hint: install CLI with `brew install infisical/get-cli/infisical` and then `infisical login`')
    }
  }

  // 2. .env 文件覆盖（高优先级，强制覆盖）
  const overrides = loadEnvFiles(args.envFiles)
  if (overrides.length > 0) {
    console.log(`[morphix-env] Loaded ${overrides.length} overrides from ${args.envFiles.join(', ')}`)
    if (args.verbose) {
      for (const o of overrides) {
        console.log(`  ${o.key} (from ${o.source})`)
      }
    }
  }
}

/** 未登录时打印明确指引并退出 */
function failNotLoggedIn(env: string): never {
  console.error('')
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.error('[morphix-env] Infisical 未登录或登录已过期')
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.error('')
  console.error('  请运行下面的命令登录后重试：')
  console.error('')
  console.error('    infisical login')
  console.error('')
  console.error(`  当前环境: ${env}`)
  console.error('')
  console.error('  如未安装 CLI: brew install infisical/get-cli/infisical')
  console.error('  CI / Docker：设置 INFISICAL_CLIENT_ID + INFISICAL_CLIENT_SECRET')
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.error('')
  process.exit(1)
}

/** 项目未配置时打印指引 */
function failNoProject(stderr: string): never {
  console.error('')
  console.error('[morphix-env] Infisical 项目未配置')
  console.error('  缺少 .infisical.json 或 INFISICAL_PROJECT_ID 环境变量')
  console.error('  在项目根运行: infisical init')
  console.error('  原始错误: ' + stderr.trim())
  process.exit(1)
}

/** SDK (Machine Identity) 错误 */
function failHardWithSdkError(e: any): never {
  console.error(`[morphix-env] Infisical SDK 认证失败: ${e?.message || e}`)
  console.error('  检查 INFISICAL_CLIENT_ID / INFISICAL_CLIENT_SECRET / INFISICAL_PROJECT_ID 是否正确')
  process.exit(1)
}

// ─── 命令实现 ─────────────────────────────────────────────

/** mx-env run [options] -- <command> */
async function cmdRun(args: Args, config: MxEnvConfig) {
  if (args.subArgs.length === 0) {
    console.error('[morphix-env] No command specified. Usage: mx-env run -- <command>')
    process.exit(1)
  }

  await loadAllEnv(args, config)

  // 如果配置了 generate，在启动命令前生成 __env.js
  if (args.outFile) {
    generateClientEnv(args.outFile, args.filter)
  }

  const [cmd, ...cmdArgs] = args.subArgs
  const result = spawn.sync(cmd, cmdArgs, {
    stdio: 'inherit',
    env: process.env,
  })

  if (result.error) {
    console.error(`[morphix-env] Failed to execute: ${cmd}`, result.error.message)
    process.exit(1)
  }
  process.exit(result.status ?? 1)
}

/** 生成客户端 __env.js */
function generateClientEnv(outFile: string, filter: string | null) {
  let vars = extractPublicVars()

  if (filter) {
    vars = Object.fromEntries(
      Object.entries(vars).filter(([key]) => key.startsWith(filter))
    )
  }

  const js = `window.__ENV=${JSON.stringify(vars)};`
  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, js)
  console.log(`[morphix-env] Generated ${outFile} (${Object.keys(vars).length} client vars)`)
}

/** mx-env generate [options] */
async function cmdGenerate(args: Args, config: MxEnvConfig) {
  const outFile = args.outFile || 'public/__env.js'

  await loadAllEnv(args, config)
  generateClientEnv(outFile, args.filter)

  if (args.verbose) {
    const vars = extractPublicVars()
    for (const key of Object.keys(vars)) {
      console.log(`  ${key}`)
    }
  }
}

/** mx-env inspect [options] */
function cmdInspect(args: Args) {
  for (const file of args.envFiles.length > 0 ? args.envFiles : [DEFAULT_ENV_FILE]) {
    const vars = parseEnvFile(file)
    const keys = Object.keys(vars)

    if (keys.length === 0) {
      console.log(`${file}: (not found or empty)`)
      continue
    }

    console.log(`${file}: (${keys.length} vars)`)
    for (const [key, value] of Object.entries(vars)) {
      if (args.filter && !key.startsWith(args.filter)) continue
      const display = value.length > 8 ? value.slice(0, 4) + '***' : value
      console.log(`  ${key}=${display}`)
    }
  }

  const publicVars = extractPublicVars()
  const filtered = args.filter
    ? Object.entries(publicVars).filter(([k]) => k.startsWith(args.filter!))
    : Object.entries(publicVars)

  if (filtered.length > 0) {
    console.log(`\nprocess.env public vars: (${filtered.length})`)
    for (const [key, value] of filtered) {
      const display = value.length > 8 ? value.slice(0, 4) + '***' : value
      console.log(`  ${key}=${display}`)
    }
  }
}

function showHelp() {
  console.log(`
morphix-env v${VERSION} — MorphixAI environment variable toolkit

Usage:
  mx-env run [options] -- <command>     Load env + exec command
  mx-env generate [options]             Generate __env.js for client-side runtime
  mx-env inspect [options]              Print env vars for debugging

Options:
  -f, --env-file <path>    Env file to load (default: .env.local, repeatable)
  -o, --out <path>         Output path for generate (default: public/__env.js)
  -e, --env <name>         Infisical environment (dev/staging/prod), overrides config
  --filter <prefix>        Only include vars with this prefix
  --no-infisical           Skip Infisical fetch entirely
  -v, --verbose            Show loaded variable names
  --help, -h               Show this help
  --version                Show version

Config file (mx-env.config.json):
  {
    "infisical": {
      "projectId": "xxx",
      "paths": ["/ai/shared", "/ai/web"],
      "env": "$DEPLOY_ENV"
    },
    "envFiles": [".env.local"],
    "generate": {
      "out": "public/__env.js",
      "filter": "NEXT_PUBLIC_"
    }
  }

Env loading priority (high → low):
  1. .env.local (or --env-file)
  2. Infisical secrets
  3. Existing process.env

Examples:
  mx-env run -- next dev --turbo -p 3004
  mx-env run --no-infisical -- npm start
  mx-env run -f .env.staging -- npm start
  mx-env generate --out dist/__env.js
  mx-env inspect --filter VITE_
`)
}

// ─── 入口 ─────────────────────────────────────────────────

async function main() {
  const config = loadConfig()
  const args = mergeWithConfig(parseArgs(process.argv), config)

  switch (args.command) {
    case 'run':
      await cmdRun(args, config)
      break
    case 'generate':
    case 'gen':
      await cmdGenerate(args, config)
      break
    case 'inspect':
      cmdInspect(args)
      break
    case '--help':
    case '-h':
    case 'help':
      showHelp()
      break
    case '--version':
      console.log(VERSION)
      break
    default:
      if (args.command) {
        console.error(`[morphix-env] Unknown command: ${args.command}`)
      }
      showHelp()
      process.exit(args.command ? 1 : 0)
  }
}

main().catch(e => {
  console.error('[morphix-env] Fatal:', e.message)
  process.exit(1)
})
