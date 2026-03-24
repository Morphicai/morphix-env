#!/usr/bin/env node

import { loadEnvFiles, extractPublicVars, parseEnvFile } from './env'
import { getInfisicalConfig, fetchInfisicalSecrets } from './infisical'
import { loadConfig, type MxEnvConfig } from './config'
import spawn from 'cross-spawn'
import { writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'

const VERSION = '0.1.0'
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
  // 1. Infisical SDK 拉取（低优先级，不覆盖已有值）
  if (!args.noInfisical) {
    const infisicalConfig = config.infisical
      ? {
          clientId: process.env.INFISICAL_CLIENT_ID || '',
          clientSecret: process.env.INFISICAL_CLIENT_SECRET || '',
          projectId: config.infisical.projectId,
          environment: config.infisical.env || 'dev',
          paths: config.infisical.paths || ['/'],
          siteUrl: config.infisical.siteUrl,
        }
      : getInfisicalConfig()

    if (infisicalConfig && infisicalConfig.clientId && infisicalConfig.clientSecret) {
      try {
        const count = await fetchInfisicalSecrets(infisicalConfig)
        console.log(`[mx-env] Infisical: loaded ${count} secrets (${infisicalConfig.environment}: ${infisicalConfig.paths.join(', ')})`)
      } catch (e: any) {
        console.warn(`[mx-env] Infisical: failed - ${e.message}`)
      }
    } else if (args.verbose) {
      console.log('[mx-env] Infisical: skipped (no credentials)')
    }
  }

  // 2. .env 文件覆盖（高优先级，强制覆盖）
  const overrides = loadEnvFiles(args.envFiles)
  if (overrides.length > 0) {
    console.log(`[mx-env] Loaded ${overrides.length} overrides from ${args.envFiles.join(', ')}`)
    if (args.verbose) {
      for (const o of overrides) {
        console.log(`  ${o.key} (from ${o.source})`)
      }
    }
  }
}

// ─── 命令实现 ─────────────────────────────────────────────

/** mx-env run [options] -- <command> */
async function cmdRun(args: Args, config: MxEnvConfig) {
  if (args.subArgs.length === 0) {
    console.error('[mx-env] No command specified. Usage: mx-env run -- <command>')
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
    console.error(`[mx-env] Failed to execute: ${cmd}`, result.error.message)
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
  console.log(`[mx-env] Generated ${outFile} (${Object.keys(vars).length} client vars)`)
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
mx-env v${VERSION} — MorphixAI environment variable toolkit

Usage:
  mx-env run [options] -- <command>     Load env + exec command
  mx-env generate [options]             Generate __env.js for client-side runtime
  mx-env inspect [options]              Print env vars for debugging

Options:
  -f, --env-file <path>    Env file to load (default: .env.local, repeatable)
  -o, --out <path>         Output path for generate (default: public/__env.js)
  --filter <prefix>        Only include vars with this prefix
  --no-infisical           Skip Infisical SDK fetch
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
        console.error(`[mx-env] Unknown command: ${args.command}`)
      }
      showHelp()
      process.exit(args.command ? 1 : 0)
  }
}

main().catch(e => {
  console.error('[mx-env] Fatal:', e.message)
  process.exit(1)
})
