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
import { startSecretServer, type SecretServer } from './serve'
import {
  defaultRcPath,
  detectHandmadeReservedShims,
  findShadowedCommands,
  removeAllShims,
  removeRcBlock,
  resolveShimCommands,
  sanitizeBootEnv,
  shimsDir,
  stripShimsFromPath,
  upsertRcBlock,
  validateShimList,
  writeShims,
} from './shims'
import { isPublicKey } from './sources'
import {
  findTemplateAnomalies,
  findTemplateVariables,
  isShellIdentifier,
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
  write: boolean
  remove: boolean
  /** Flags the parser did not recognize; shell-init fails on these instead of silently ignoring them. */
  unknownFlags: string[]
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: '', subArgs: [], positionals: [], envFiles: [], outFile: null, verbose: false,
    filter: null, noInfisical: false, env: null, profile: null, noGlobal: false,
    allowInsecureGlobal: false, printEditorUrl: false, source: null,
    target: null, force: false, dryRun: false, serve: false,
    write: false, remove: false, unknownFlags: [],
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
    } else if (arg === '--write') {
      args.write = true
    } else if (arg === '--remove') {
      args.remove = true
    } else if (arg === '--serve') {
      args.serve = true
    } else if (args.command === 'run') {
      args.subArgs = argv.slice(i)
      break
    } else if (!arg.startsWith('-')) {
      args.positionals.push(arg)
    } else {
      // Unknown flags are recorded, not silently dropped: shell-init refuses
      // to proceed with them so `shell-init --wirte` cannot degrade into a
      // silent no-op. Other commands keep their historical lenient behavior.
      args.unknownFlags.push(arg)
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

/** Once-per-process guard for the invalid-shims warning. */
let shimWarned = false

/**
 * Boot-time capture, set by main() before dispatch: whether this invocation
 * came through a PATH shim (audit `via` dimension) and the pre-sanitization
 * PATH (shell-init's per-command parity check needs the real one).
 */
const bootInfo: { viaShim: boolean; originalPath?: string } = { viaShim: false }

function resolveComposition(args: Args): Promise<EnvironmentComposition> {
  const layers = configLayers()
  // A broken `shims` list must never break composition: warn and ignore, and
  // let `shell-init` be the command that hard-fails on it (design decision 8).
  if (!shimWarned) {
    shimWarned = true
    const shimProblems = [
      ...validateShimList(layers.global.config.shims, layers.global.path),
      ...validateShimList(layers.project.config.shims, layers.project.path),
    ]
    if (shimProblems.length) {
      console.warn(`[morphix-env] Ignoring invalid "shims" entries (${shimProblems.length} problem(s)); run \`mx-env shell-init\` for the details.`)
    }
  }
  return composeEnvironment(layers, composeOptions(args))
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
    // Belt-and-braces: boot already sanitized this process's PATH, but SDK
    // consumers can hand us a baseEnvironment that still contains the shims
    // dir. Strip again so a child can never resolve back into a shim.
    if (composition.environment.PATH) {
      composition.environment.PATH = stripShimsFromPath(composition.environment.PATH) ?? composition.environment.PATH
    }
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
    via: bootInfo.viaShim ? 'shim' : 'cli',
  })
}

/**
 * `run --serve` (aws-vault `--ecs-server` style): snapshot the composed
 * values into a loopback server, strip non-public sourced values from the
 * child environment, and hand the child only the endpoint plus a random
 * bearer token. Browser-public keys stay in env (build tools inline them)
 * and remain servable too.
 */
async function startServeFor(composition: EnvironmentComposition, verbose: boolean): Promise<SecretServer> {
  const values: Record<string, string> = {}
  for (const key of Object.keys(composition.provenance)) {
    const value = composition.environment[key]
    if (value !== undefined) values[key] = value
  }

  const server = await startSecretServer(values)
  for (const key of Object.keys(values)) {
    if (!isPublicKey(key)) delete composition.environment[key]
  }
  composition.environment.MXENV_ENDPOINT = server.endpoint
  composition.environment.MXENV_TOKEN = server.token
  // The token is injected, so an accidental echo is redacted like any value.
  composition.redactionValues = [...new Set([...composition.redactionValues, server.token])]
  if (verbose) {
    console.error(`[morphix-env] Secret server listening on ${server.endpoint} (${Object.keys(values).length} keys; token is visible to the child only).`)
  }
  return server
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
    // Every resolved value joins the redaction set — including browser-public
    // keys: the exemption exists for deliberately public literals, but a
    // referenced value may be a real secret regardless of the key's prefix.
    const extra = changed
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
  const secretServer = args.serve ? await startServeFor(composition, args.verbose) : null
  try {
    const exitCode = await runChild(command, commandArgs, composition)
    writeRunAudit(composition, startedAt, exitCode === 0 ? 'success' : 'failure', exitCode)
    return exitCode
  } finally {
    // The server shares the child's lifetime: it is destroyed as soon as the
    // direct child exits (and dies with this process in any case).
    secretServer?.close()
  }
}

/**
 * Thin client for the `run --serve` secret server: reads the endpoint and
 * token from its own environment (child or grandchild) and prints exactly one
 * value to stdout, with no trailing newline so redirection is lossless.
 */
async function cmdFetch(args: Args): Promise<number> {
  const key = args.positionals[0]
  if (!key) {
    console.error('[morphix-env] Usage: mx-env fetch <key-name>')
    return 1
  }
  const endpoint = process.env.MXENV_ENDPOINT
  const token = process.env.MXENV_TOKEN
  if (!endpoint || !token) {
    console.error('[morphix-env] mx-env fetch needs MXENV_ENDPOINT and MXENV_TOKEN; run it inside "mx-env run --serve -- <command>".')
    return 1
  }
  // The token authorizes reads of composed secrets, so it must never leave
  // this machine: a poisoned or hand-set endpoint pointing off-loopback would
  // carry it into a remote server's logs via the Authorization header.
  let endpointUrl: URL
  try {
    endpointUrl = new URL(endpoint)
  } catch {
    console.error('[morphix-env] MXENV_ENDPOINT is not a valid URL.')
    return 1
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpointUrl.hostname)) {
    console.error('[morphix-env] MXENV_ENDPOINT is not a loopback address; refusing to send the fetch token off-machine.')
    return 1
  }
  try {
    const response = await fetch(`${endpoint}/key/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (response.ok) {
      process.stdout.write(await response.text())
      return 0
    }
    if (response.status === 404) {
      console.error(`[morphix-env] Unknown key on the secret server: ${key}`)
      return 1
    }
    console.error(`[morphix-env] Secret server rejected the request (HTTP ${response.status}).`)
    return 1
  } catch {
    console.error('[morphix-env] Secret server is unreachable; the parent process may have exited.')
    return 1
  }
}

async function cmdGenerate(args: Args): Promise<number> {
  const composition = await resolveComposition(args)
  // Resolve mx-env:// references first: a generated client env must contain
  // the same values a run child would receive, not literal reference strings.
  await resolveEnvironmentReferences(composition, args)
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
  // Resolve mx-env:// references so export matches run's semantics: consumers
  // of `eval "$(mx-env export)"` get the same values a run child would.
  await resolveEnvironmentReferences(composition, args)
  // stdout carries eval-able statements only — any extra line would break
  // `eval "$(mx-env export --profile …)"`. Keys that are not shell
  // identifiers (FOO-BAR, 1LEAD — legal in dotenv, illegal in shell) would be
  // silently dropped by eval, so they are warned about on stderr and skipped.
  for (const key of keys) {
    if (!isShellIdentifier(key)) {
      console.warn(`[morphix-env] Warning: key "${key}" is not a valid shell identifier; skipped in export output.`)
      continue
    }
    console.log(`export ${key}=${shellQuote(composition.environment[key] ?? '')}`)
  }
  writeRunAudit(composition, startedAt, 'success', 0)
  return 0
}

async function cmdRender(args: Args): Promise<number> {
  const startedAt = Date.now()
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

  // Warn before rendering: unresolved names and unsupported constructs stay
  // literal in the output, so neither may pass silently.
  if (missing.length) console.warn(`[morphix-env] Missing variables: ${missing.join(', ')} (left unresolved)`)
  for (const anomaly of findTemplateAnomalies(template)) console.warn(`[morphix-env] ${anomaly}`)

  if (args.dryRun) {
    for (const name of names) console.log(`${name}: ${missing.includes(name) ? 'missing' : 'resolved'}`)
    return 0
  }

  // Resolve mx-env:// references so rendered output matches run's semantics
  // instead of embedding literal reference strings.
  await resolveEnvironmentReferences(composition, args)
  const { output } = renderTemplate(template, composition.environment)
  warnOutputGitRisk(outPath)
  writePrivateFile(outPath, output)
  writeRunAudit(composition, startedAt, 'success', 0)
  console.log(`[morphix-env] Rendered ${templatePath} -> ${outPath} (${names.length} variables, ${missing.length} unresolved)`)
  return 0
}

async function cmdInject(args: Args): Promise<number> {
  const startedAt = Date.now()
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
  warnOutputGitRisk(outPath)
  writePrivateFile(outPath, resolved.text)
  // Audit through the same value-free mechanism as run/export. Inject has no
  // single composition, so the record names the profiles and keys whose
  // references were materialized — never the values.
  writeAudit({
    timestamp: new Date().toISOString(),
    profile: [...new Set(references.map((reference) => reference.profile))].join(',') || 'none',
    sources: [],
    keys: [...new Set(references.map((reference) => reference.key))].sort(),
    outcome: 'success',
    exitCode: 0,
    durationMs: Date.now() - startedAt,
  })
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

/**
 * `shell-init`: generate PATH shims for the declared command list (global ∪
 * project), optionally write/remove the rc PATH block. Hard-fails on invalid
 * `shims` entries — this is the command whose whole job is the list, unlike
 * composition paths which only warn. Value-free by construction: the list is
 * command names, never secrets.
 */
function cmdShellInit(args: Args): number {
  if (args.unknownFlags.length) {
    console.error(`[morphix-env] shell-init: unrecognized flag(s): ${args.unknownFlags.join(', ')}`)
    return 1
  }
  if (args.write && args.remove) {
    console.error('[morphix-env] shell-init: --write and --remove are mutually exclusive.')
    return 1
  }
  const layers = configLayers()
  const home = homedir()
  const rcPath = defaultRcPath(process.env.SHELL, home)

  if (args.remove) {
    const removed = removeAllShims(home)
    const rcOutcome = rcPath ? removeRcBlock(rcPath) : 'absent'
    console.log(`[morphix-env] Removed ${removed.length} shim(s)${removed.length ? ` (${removed.join(', ')})` : ''}; rc block ${rcOutcome}${rcPath ? ` in ${rcPath}` : ''}.`)
    return 0
  }

  const problems = [
    ...validateShimList(layers.global.config.shims, layers.global.path),
    ...validateShimList(layers.project.config.shims, layers.project.path),
  ]
  if (problems.length) {
    for (const problem of problems) console.error(`[morphix-env] ${problem}`)
    return 1
  }

  const commands = resolveShimCommands(layers, !args.noGlobal)
  const { written, removed } = writeShims(commands, home)
  console.log(`[morphix-env] Shims ready in ${shimsDir(home)} (${commands.length} command(s): ${commands.join(', ') || 'none'}; ${written.length} written, ${removed.length} removed).`)

  for (const file of detectHandmadeReservedShims(home)) {
    console.warn(`[morphix-env] Warning: "${file}" in the shims directory was not created by mx-env and shadows a reserved command; delete it by hand. Do not place files in ${shimsDir(home)} manually.`)
  }

  // Parity check against the pre-sanitization PATH captured at boot: each
  // declared command must resolve to its shim, or an earlier PATH entry
  // (volta, another tool) silently wins and nothing is injected.
  const shadowed = findShadowedCommands(commands, bootInfo.originalPath, home)
  if (shadowed.length) {
    console.warn(`[morphix-env] Warning: these commands do not resolve to their shim on the current PATH: ${shadowed.join(', ')} — move ${shimsDir(home)} ahead of the entries that provide them.`)
  }

  if (args.write) {
    if (!rcPath) {
      console.error('[morphix-env] shell-init: cannot infer an rc file from $SHELL (zsh/bash supported); add the PATH line manually.')
      return 1
    }
    const outcome = upsertRcBlock(rcPath, home)
    console.log(`[morphix-env] rc block ${outcome} in ${rcPath}. Open a new shell to activate.`)
    return 0
  }

  console.log(`\nAdd the shims directory to PATH${rcPath ? ` (e.g. in ${rcPath})` : ''}:\n\n  export PATH="${shimsDir(home)}:$PATH"\n\nOr re-run with --write to let mx-env maintain a marked block in your rc file.`)
  return 0
}

function cmdAudit(args: Args): number {  const file = join(homedir(), '.mx-env', 'audit', `${new Date().toISOString().slice(0, 10)}.jsonl`)
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
  mx-env fetch <key-name>                 Print one value from a run --serve secret server
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
  mx-env shell-init [--write|--remove]    Generate PATH shims for declared commands

Both mx-env and morphix-env are supported.

Options:
  -p, --profile <name>     Select a named source profile
  -f, --env-file <path>    Local override file (repeatable)
  -e, --env <name>         Infisical environment override
  -o, --out <path>         Client __env.js output
  --filter <prefix>        Include public keys with this prefix
  --serve                  Keep composed values out of env; serve them to the child over loopback
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
  // Sanitize before anything composes: provider subprocesses spawned during
  // composition inherit PATH, so a shimmed provider CLI would recurse
  // shim → run → provider → shim. See design decision 3.
  Object.assign(bootInfo, sanitizeBootEnv())
  const args = parseArgs(process.argv)
  switch (args.command) {
    case 'run': return cmdRun(args)
    case 'fetch': return cmdFetch(args)
    case 'export': return cmdExport(args)
    case 'render': return cmdRender(args)
    case 'inject': return cmdInject(args)
    case 'generate':
    case 'gen': return cmdGenerate(args)
    case 'inspect': return cmdInspect(args)
    case 'audit': return cmdAudit(args)
    case 'edit': return cmdEdit(args)
    case 'doc': return cmdDoc(args)
    case 'shell-init': return cmdShellInit(args)
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
