#!/usr/bin/env node

import spawn from 'cross-spawn'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { writeAudit } from './audit'
import {
  collectRedactionValues,
  composeEnvironment,
  type ComposeOptions,
  type EnvironmentComposition,
} from './composition'
import { loadConfigLayers, type ConfigLayers } from './config'
import { launchEditor, startEditorServer } from './editor'
import { extractPublicVars } from './env'
import { StreamingRedactor } from './redaction'
import { hasMxEnvReference, findMxEnvReferences, ReferenceResolver, type UnresolvedReference } from './refs'
import { cmdSkill } from './skill'
import { isPublicKey } from './sources'
import {
  findTemplateVariables,
  renderTemplate,
  shellQuote,
  warnOutputGitRisk,
  writePrivateFile,
} from './template'
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
  force: boolean
  dryRun: boolean
  serve: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: '', subArgs: [], positionals: [], envFiles: [], outFile: null, verbose: false,
    filter: null, noInfisical: false, env: null, profile: null, noGlobal: false,
    allowInsecureGlobal: false, printEditorUrl: false, source: null,
    target: null, force: false, dryRun: false, serve: false,
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
    } else if (arg === '--force') {
      args.force = true
    } else if (arg === '--dry-run') {
      args.dryRun = true
    } else if (arg === '--serve') {
      args.serve = true
    } else if (args.command === 'run') {
      args.subArgs = argv.slice(i)
      break
    } else if (!arg.startsWith('-')) {
      args.positionals.push(arg)
    }
    i++
  }
  return args
}

function configLayers(): ConfigLayers {
  return loadConfigLayers({ cwd: process.cwd(), homeDir: homedir() })
}

function composeOptions(args: Args): ComposeOptions {
  return {
    profile: args.profile,
    noGlobal: args.noGlobal,
    noInfisical: args.noInfisical,
    envName: args.env,
    allowInsecureGlobal: args.allowInsecureGlobal,
    envFiles: args.envFiles,
    homeDir: homedir(),
  }
}

function resolveComposition(args: Args): Promise<EnvironmentComposition> {
  return composeEnvironment(configLayers(), composeOptions(args))
}

function generatedOptions(args: Args): { outFile: string; filter: string | null } {
  const config = loadConfigLayers({ cwd: process.cwd(), homeDir: homedir() }).project.config
  return {
    outFile: args.outFile || config.generate?.out || 'public/__env.js',
    filter: args.filter || config.generate?.filter || null,
  }
}

function generateClientEnv(outFile: string, filter: string | null, environment: NodeJS.ProcessEnv): void {
  let vars = extractPublicVars(environment)
  if (filter) vars = Object.fromEntries(Object.entries(vars).filter(([key]) => key.startsWith(filter)))
  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, `window.__ENV=${JSON.stringify(vars)};`)
  console.log(`[morphix-env] Generated ${outFile} (${Object.keys(vars).length} client vars)`)
}

async function runChild(command: string, commandArgs: string[], composition: EnvironmentComposition): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { env: composition.environment, stdio: ['inherit', 'pipe', 'pipe'] })
    const stdout = new StreamingRedactor(composition.redactionValues)
    const stderr = new StreamingRedactor(composition.redactionValues)

    child.stdout?.on('data', (chunk: Buffer) => process.stdout.write(stdout.write(chunk)))
    child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(stderr.write(chunk)))
    child.on('error', () => {
      console.error(`[morphix-env] Failed to execute: ${command}`)
      resolve(1)
    })
    child.on('close', (code) => {
      const stdoutFinal = stdout.flush()
      const stderrFinal = stderr.flush()
      if (stdoutFinal) process.stdout.write(stdoutFinal)
      if (stderrFinal) process.stderr.write(stderrFinal)
      resolve(code ?? 1)
    })
  })
}

function writeRunAudit(composition: EnvironmentComposition, startedAt: number, outcome: 'success' | 'failure', exitCode: number): void {
  writeAudit({
    timestamp: new Date().toISOString(),
    profile: composition.profileName,
    sources: composition.sourceStatuses.map((source) => source.name),
    keys: Object.keys(composition.provenance).sort(),
    outcome,
    exitCode,
    durationMs: Date.now() - startedAt,
  })
}

function warnUnresolvedReference(reference: UnresolvedReference, context: string): void {
  console.warn(`[morphix-env] Unresolved mx-env://${reference.profile}/${reference.key} reference ${context} (${reference.reason}); left as-is.`)
}

/**
 * Resolves `mx-env://` references inside composed values before a child run.
 * Resolved values join the redaction set so the new material is covered by the
 * same output redaction as directly composed values.
 */
async function resolveEnvironmentReferences(composition: EnvironmentComposition, args: Args): Promise<void> {
  const targets = Object.entries(composition.environment)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && hasMxEnvReference(entry[1]))
  if (!targets.length) return

  const resolver = new ReferenceResolver(configLayers(), composeOptions(args))
  const changed: string[] = []
  for (const [key, value] of targets) {
    // Start with an empty chain: a value may reference its own profile (the
    // common case). Repeated profiles deeper in the chain still terminate.
    const resolved = await resolver.resolveText(value)
    if (resolved.missing.length) {
      for (const reference of resolved.missing) warnUnresolvedReference(reference, `in key "${key}"`)
      continue
    }
    composition.environment[key] = resolved.text
    changed.push(key)
  }

  if (changed.length) {
    const extra = changed
      .filter((key) => !isPublicKey(key))
      .map((key) => composition.environment[key])
      .filter((value): value is string => Boolean(value))
    composition.redactionValues = [...new Set([
      ...collectRedactionValues(composition.environment, composition.provenance),
      ...extra,
    ])]
  }
}

async function cmdRun(args: Args): Promise<number> {
  if (!args.subArgs.length) {
    console.error('[morphix-env] No command specified. Usage: mx-env run -- <command>')
    return 1
  }
  const startedAt = Date.now()
  const composition = await resolveComposition(args)
  if (args.verbose) {
    for (const source of composition.sourceStatuses) {
      console.log(`[morphix-env] ${source.name}: ${source.availability} (${source.keyCount} keys)`)
    }
  }
  if (args.dryRun) {
    // Key names only: a dry run never composes a value into an output stream.
    console.log(`profile: ${composition.profileName}`)
    for (const key of Object.keys(composition.provenance).sort()) console.log(`  ${key}`)
    return 0
  }
  await resolveEnvironmentReferences(composition, args)
  if (args.outFile || generatedOptions(args).outFile) {
    const { outFile, filter } = generatedOptions(args)
    // Existing run behavior generates when a generate config is present or --out is supplied.
    const configured = Boolean(args.outFile || loadConfigLayers({ cwd: process.cwd(), homeDir: homedir() }).project.config.generate)
    if (configured) generateClientEnv(outFile, filter, composition.environment)
  }
  const [command, ...commandArgs] = args.subArgs
  const exitCode = await runChild(command, commandArgs, composition)
  writeRunAudit(composition, startedAt, exitCode === 0 ? 'success' : 'failure', exitCode)
  return exitCode
}

async function cmdGenerate(args: Args): Promise<number> {
  const composition = await resolveComposition(args)
  const { outFile, filter } = generatedOptions(args)
  generateClientEnv(outFile, filter, composition.environment)
  if (args.verbose) {
    for (const key of Object.keys(extractPublicVars(composition.environment)).sort()) console.log(`  ${key}`)
  }
  return 0
}

async function cmdInspect(args: Args): Promise<number> {
  const composition = await resolveComposition(args)
  console.log(`profile: ${composition.profileName}`)
  for (const source of composition.sourceStatuses) {
    console.log(`source: ${source.name} (${source.provider}) — ${source.availability}, ${source.keyCount} keys`)
  }
  for (const [key, provenance] of Object.entries(composition.provenance).sort(([a], [b]) => a.localeCompare(b))) {
    if (!args.filter || key.startsWith(args.filter)) {
      const overridden = provenance.overriddenSources.length ? `; overrides ${provenance.overriddenSources.join(', ')}` : ''
      console.log(`  ${key} — ${provenance.source} (${provenance.provider})${overridden}`)
    }
  }
  return 0
}

async function cmdExport(args: Args): Promise<number> {
  const startedAt = Date.now()
  const composition = await resolveComposition(args)
  const keys = Object.keys(composition.provenance).sort()
  if (args.dryRun) {
    for (const key of keys) console.log(key)
    return 0
  }
  // stdout carries eval-able statements only — any extra line would break
  // `eval "$(mx-env export --profile …)"`. Audit stays value-free as always.
  for (const key of keys) console.log(`export ${key}=${shellQuote(composition.environment[key] ?? '')}`)
  writeRunAudit(composition, startedAt, 'success', 0)
  return 0
}

async function cmdRender(args: Args): Promise<number> {
  const [templatePath, outPath] = args.positionals
  if (!templatePath || !outPath) {
    console.error('[morphix-env] Usage: mx-env render <template-file> <output-file> [options]')
    return 1
  }
  if (!existsSync(templatePath)) {
    console.error(`[morphix-env] Template not found: ${templatePath}`)
    return 1
  }
  const template = readFileSync(templatePath, 'utf8')
  const composition = await resolveComposition(args)
  const names = findTemplateVariables(template)
  const missing = names.filter((name) => composition.environment[name] === undefined || composition.environment[name] === null)

  // Warn before rendering: unresolved names stay literal in the output.
  if (missing.length) console.warn(`[morphix-env] Missing variables: ${missing.join(', ')} (left unresolved)`)

  if (args.dryRun) {
    for (const name of names) console.log(`${name}: ${missing.includes(name) ? 'missing' : 'resolved'}`)
    return 0
  }

  const { output } = renderTemplate(template, composition.environment)
  writePrivateFile(outPath, output)
  warnOutputGitRisk(outPath)
  console.log(`[morphix-env] Rendered ${templatePath} -> ${outPath} (${names.length} variables, ${missing.length} unresolved)`)
  return 0
}

async function cmdInject(args: Args): Promise<number> {
  const [templatePath, outPath] = args.positionals
  if (!templatePath || !outPath) {
    console.error('[morphix-env] Usage: mx-env inject <template-file> <output-file> [options]')
    return 1
  }
  if (!existsSync(templatePath)) {
    console.error(`[morphix-env] Template not found: ${templatePath}`)
    return 1
  }
  const template = readFileSync(templatePath, 'utf8')
  const resolver = new ReferenceResolver(configLayers(), composeOptions(args))
  const references = findMxEnvReferences(template)

  if (args.dryRun) {
    for (const reference of references) {
      const result = await resolver.valueOf(reference.profile, reference.key)
      const status = result.value !== undefined ? 'resolved' : (result.missing?.reason ?? 'missing')
      console.log(`${reference.profile}/${reference.key}: ${status}`)
    }
    return 0
  }

  const resolved = await resolver.resolveText(template)
  for (const reference of resolved.missing) warnUnresolvedReference(reference, `in ${templatePath}`)
  writePrivateFile(outPath, resolved.text)
  warnOutputGitRisk(outPath)
  console.log(`[morphix-env] Injected ${templatePath} -> ${outPath} (${references.length} references, ${resolved.missing.length} unresolved)`)
  return 0
}

async function cmdEdit(args: Args): Promise<number> {
  if (!args.profile && !args.source) {
    console.error('[morphix-env] Specify --profile <name> or --source <name> to open the editor.')
    return 1
  }
  const composition = await resolveComposition(args)
  if (args.source && !composition.sourceEntries.some((entry) => entry.name === args.source)) {
    const layers = loadConfigLayers({ cwd: process.cwd(), homeDir: homedir() })
    const declared = layers.project.config.sources?.[args.source]
      ? { source: layers.project.config.sources[args.source], baseDir: layers.project.baseDir }
      : (!args.noGlobal && layers.global.config.sources?.[args.source]
        ? { source: layers.global.config.sources[args.source], baseDir: layers.global.baseDir }
        : null)
    if (!declared) {
      console.error(`[morphix-env] Unknown source "${args.source}".`)
      return 1
    }
    composition.sourceEntries.push({ name: args.source, ...declared })
    composition.sourceStatuses.push({ name: args.source, provider: declared.source.provider, availability: 'skipped', keyCount: 0 })
  }
  const editor = await launchEditor(__filename, composition, args.source || undefined)
  if (args.printEditorUrl) console.log(`[morphix-env] Local editor URL: ${editor.url}`)
  else if (editor.opened) console.log('[morphix-env] Opened local editor in your browser.')
  else console.log('[morphix-env] Local editor started. Run again with --print-editor-url to display its one-time URL.')
  console.log('[morphix-env] Values remain in the provider or browser session and are not printed here.')
  return 0
}

async function cmdDoc(args: Args): Promise<number> {
  const composition = await resolveComposition(args)
  const outFile = args.outFile || join(process.cwd(), '.agents', 'skills', 'morphix-env', 'SKILL.md')
  const keyRows = Object.entries(composition.provenance)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, provenance]) => `| \`${key}\` | ${provenance.source} (${provenance.provider}) |`)
    .join('\n') || '| _No resolved keys_ | — |'
  const skill = `---
name: morphix-env
description: Safely use and edit this project's composed environment profiles without placing values in Agent context.
---

# Morphix environment workflow

Default profile context: \`${composition.profileName}\`.

## Operator-owned secret changes

When a user asks to add, modify, or rotate a credential:

1. Run \`mx-env edit --profile <profile>\` or \`mx-env edit --source <source>\`.
2. Tell the user to complete the change in the local visual editor or provider UI.
3. Do not ask the user to paste a value into chat.
4. Do not run \`env\`, \`printenv\`, \`cat .env\`, or any reveal command.
5. Validate only through \`mx-env inspect --profile <profile>\`; it reports names, source, and status without values.

## Running commands

Use \`mx-env run --profile <profile> -- <command>\` for normal runs.
Use \`mx-env run --no-global -- <command>\` when a project-only, reproducible environment is required.

## Available key names and sources

| Key | Winning source |
| --- | --- |
${keyRows}

Secret values and value prefixes do not belong in this Skill, command output, audit records, or conversation context.
`
  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, skill, { mode: 0o600 })
  console.log(`[morphix-env] Generated value-free workflow Skill: ${outFile}`)
  return 0
}

function cmdAudit(args: Args): number {
  const file = join(homedir(), '.mx-env', 'audit', `${new Date().toISOString().slice(0, 10)}.jsonl`)
  if (!existsSync(file)) {
    console.log('[morphix-env] No audit events for today.')
    return 0
  }
  const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)
  const selected = args.subArgs[0] === 'tail' ? lines.slice(-20) : lines
  for (const line of selected) console.log(line)
  return 0
}

function showHelp(): void {
  console.log(`
morphix-env v${VERSION} — secret composition and environment delivery

Usage:
  mx-env run [options] -- <command>       Compose env + execute command
  mx-env export [options]                 Print eval-able export KEY='value' lines
  mx-env render <template> <output>       Substitute \${VAR} into a file (mode 0600)
  mx-env inject <template> <output>       Resolve mx-env:// references into a file (mode 0600)
  mx-env generate [options]               Generate public __env.js
  mx-env inspect [options]                Print key names, sources, and status only
  mx-env doc [options]                    Generate a value-free project Skill
  mx-env audit [tail]                     Read value-free local audit events
  mx-env edit --profile <name>            Open the one-shot visual editor
  mx-env skill install [--target <t>]     Install the Agent Skill (global|project|trellis)
  mx-env skill show                       Show skill install status per target

Both mx-env and morphix-env are supported.

Options:
  -p, --profile <name>     Select a named source profile
  -f, --env-file <path>    Local override file (repeatable)
  -e, --env <name>         Infisical environment override
  -o, --out <path>         Client __env.js output
  --filter <prefix>        Include public keys with this prefix
  --dry-run                Report key/variable names only, never values
  --no-infisical           Do not load Infisical sources
  --no-global              Ignore ~/.mx-env/.env and ~/.mx-env/config.json
  --allow-insecure-global  Allow a global .env with permissive file mode
  --print-editor-url       Explicitly print the one-time local editor URL
  --target <scope>         Skill install target: global, project, or trellis
  --force                  Overwrite an installed skill that differs from this version
  -v, --verbose            Print source status and key counts only
  --help, -h               Show this help
  --version                Show version
`)
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv)
  switch (args.command) {
    case 'run': return cmdRun(args)
    case 'export': return cmdExport(args)
    case 'render': return cmdRender(args)
    case 'inject': return cmdInject(args)
    case 'generate':
    case 'gen': return cmdGenerate(args)
    case 'inspect': return cmdInspect(args)
    case 'audit': return cmdAudit(args)
    case 'edit': return cmdEdit(args)
    case 'doc': return cmdDoc(args)
    case 'skill': {
      const positional = process.argv.slice(3).find((arg) => !arg.startsWith('-')) ?? 'install'
      return cmdSkill(positional, { target: args.target, force: args.force })
    }
    case '--help':
    case '-h':
    case 'help': showHelp(); return 0
    case '--version': console.log(VERSION); return 0
    default:
      if (args.command) console.error(`[morphix-env] Unknown command: ${args.command}`)
      showHelp()
      return args.command ? 1 : 0
  }
}

if (process.argv[2] === '__mx_editor') {
  startEditorServer(process.argv[3])
    .catch(() => { process.exitCode = 1 })
} else {
  main()
    .then((code) => { process.exitCode = code })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : '[morphix-env] Failed to compose environment.'
      console.error(message)
      process.exitCode = 1
    })
}
