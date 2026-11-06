#!/usr/bin/env node

import spawn from 'cross-spawn'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import {
  collectRedactionValues,
  composeEnvironment,
  extractPublicVars,
  findMxEnvReferences,
  hasMxEnvReference,
  isPublicKey,
  loadConfigLayers,
  ReferenceResolver,
  sanitizeBootEnv,
  StreamingRedactor,
  stripShimsFromPath,
  validateShimList,
  writeAudit,
  type ComposeOptions,
  type ConfigLayers,
  type EnvironmentComposition,
  type UnresolvedReference,
} from 'mxenv-core'
import { launchEditor, startEditorServer } from './editor'
import {
  discoverPlaintextUnits,
  executeUnit,
  legacyPlaintextHints,
  type MigrateTarget,
  type MigrationUnit,
  type UnitOutcome,
} from './migrate'
import { cmdSkill } from './skill'
import { startSecretServer, type SecretServer } from './serve'
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
  /** migrate: destination provider (dotenvx|keychain). */
  to: string | null
  /** migrate: keychain service override (requires --source). */
  service: string | null
  force: boolean
  dryRun: boolean
  serve: boolean
  write: boolean
  remove: boolean
  warnPlaintext: boolean
  /** Flags the parser did not recognize; migrate fails on these instead of silently ignoring them. */
  unknownFlags: string[]
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: '', subArgs: [], positionals: [], envFiles: [], outFile: null, verbose: false,
    filter: null, noInfisical: false, env: null, profile: null, noGlobal: false,
    allowInsecureGlobal: false, printEditorUrl: false, source: null,
    target: null, to: null, service: null, force: false, dryRun: false, serve: false,
    write: false, remove: false, warnPlaintext: false, unknownFlags: [],
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
    } else if (arg === '--to') {
      if (argv[++i]) args.to = argv[i]
    } else if (arg === '--service') {
      if (argv[++i]) args.service = argv[i]
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
    } else if (arg === '--warn-plaintext') {
      args.warnPlaintext = true
    } else if (args.command === 'run') {
      args.subArgs = argv.slice(i)
      break
    } else if (!arg.startsWith('-')) {
      args.positionals.push(arg)
    } else {
      // Unknown flags are recorded, not silently dropped: migrate refuses to
      // proceed with them so `migrate --wirte` cannot degrade into a silent
      // no-op. Other commands keep their historical lenient behavior. (The
      // same strictness guards shell-init in the mxenv-cli package.)
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

/**
 * Boot-time capture, set by main() before dispatch: whether this invocation
 * came through a PATH shim (audit `via` dimension). The pre-sanitization PATH
 * ride-along is consumed by shell-init in the mxenv-cli package.
 */
const bootInfo: { viaShim: boolean; originalPath?: string } = { viaShim: false }

/**
 * Once-per-process warning for invalid `shims` lists (design decision 8):
 * composition paths degrade to warn-and-ignore; only shell-init hard-fails.
 */
let shimWarned = false

function warnInvalidShims(layers: ConfigLayers, includeGlobal: boolean): void {
  if (shimWarned) return
  shimWarned = true
  const problems = [
    ...(includeGlobal ? validateShimList(layers.global.config.shims, layers.global.path) : []),
    ...validateShimList(layers.project.config.shims, layers.project.path),
  ]
  if (problems.length) {
    console.warn(`[morphix-env] Ignoring invalid "shims" entries (${problems.length} problem(s)); run \`mx-env shell-init\` for the details.`)
  }
}

function resolveComposition(args: Args): Promise<EnvironmentComposition> {
  const layers = configLayers()
  warnInvalidShims(layers, !args.noGlobal)
  return composeEnvironment(layers, composeOptions(args))
}

/**
 * Opt-in plaintext reminder (issue #7): off by default, enabled per-invocation
 * via --warn-plaintext or globally via MXENV_WARN_PLAINTEXT=1 (the env knob
 * exists because shimmed commands cannot take mx-env flags). Value-free: only
 * source names are mentioned. Once per process.
 */
let plaintextWarned = false

function warnPlaintextSources(composition: EnvironmentComposition, args: Args): void {
  if (plaintextWarned) return
  if (!args.warnPlaintext && process.env.MXENV_WARN_PLAINTEXT !== '1') return
  plaintextWarned = true
  const loaded = composition.sourceStatuses.filter(
    (source) => source.provider === 'local' && source.availability === 'loaded' && source.keyCount > 0,
  )
  if (!loaded.length) return
  console.warn(`[morphix-env] Plaintext local source(s) in use: ${loaded.map((source) => source.name).join(', ')} — local plaintext files are dev-only; run \`mx-env migrate\` to move them into encrypted storage.`)
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
  warnPlaintextSources(composition, args)
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
  warnPlaintextSources(composition, args)
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
    // local 明文源钉死"仅开发用"定位（issue #7）；dotenvx 加密文件不在此列。
    const plaintextMark = source.provider === 'local' ? ' [plaintext, dev-only]' : ''
    console.log(`source: ${source.name} (${source.provider}) — ${source.availability}, ${source.keyCount} keys${plaintextMark}`)
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
  warnPlaintextSources(composition, args)
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
  warnPlaintextSources(composition, args)
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
  const layers = configLayers()
  warnInvalidShims(layers, !args.noGlobal)
  const resolver = new ReferenceResolver(layers, composeOptions(args))
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
  // Bare `mx-env edit` opens the default composition (the implicit global on
  // config-less machines); --profile/--source narrow the scope.
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

1. Run \`mx-env edit\` (optionally with \`--profile <profile>\` or \`--source <source>\`).
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

/* `shell-init` moved to the mxenv-cli package (package-split 4.1). */


/**
 * `migrate`（issue #7）：local 明文 → dotenvx/keychain。无 --to 为纯只读
 * plan；--dry-run 与 --to 组合输出执行计划零写入。执行 = 备份(0600) → 写目标
 * → 值级等价验证 → 改写配置 → 清理明文；失败自动从备份还原。
 */
function printMigratePlan(units: MigrationUnit[], hints: string[], target: string | null): void {
  if (!units.length) {
    console.log('[morphix-env] No plaintext units in scope; nothing to migrate.')
  }
  for (const unit of units) {
    const where = unit.kind === 'global-implicit' ? 'global implicit' : `${unit.scope}, declared in ${unit.configPath}`
    console.log(`unit: ${unit.name} (${where})`)
    for (const file of unit.files) console.log(`  file: ${file}`)
    console.log(`  keys: ${unit.keyNames.join(', ') || '(none)'}`)
    console.log(`  --to dotenvx:  encrypt file(s) in place${unit.kind === 'declared' ? ' + rewrite provider in config' : ' (no config change; loading auto-detects encryption)'}`)
    console.log(unit.kind === 'global-implicit'
      ? '  --to keychain: not supported for the global implicit file'
      : '  --to keychain: move values to a keychain service, rewrite config, delete plaintext')
  }
  for (const hint of hints) {
    console.log(`legacy plaintext (not auto-migrated): ${hint} — declare it as a source in mx-env.config.json to migrate it.`)
  }
  if (units.length && !target) {
    console.log('\nPlan only. Re-run with --to dotenvx|keychain to execute; every unit gets a 0600 backup and a post-migration equivalence check before its config changes.')
  }
}

async function cmdMigrate(args: Args): Promise<number> {
  if (args.unknownFlags.length) {
    console.error(`[morphix-env] migrate: unrecognized flag(s): ${args.unknownFlags.join(', ')}`)
    return 1
  }
  if (args.to && args.to !== 'dotenvx' && args.to !== 'keychain') {
    console.error('[morphix-env] migrate: --to must be "dotenvx" or "keychain".')
    return 1
  }
  if (args.service && args.to !== 'keychain') {
    console.error('[morphix-env] migrate: --service is only valid with --to keychain.')
    return 1
  }
  if (args.service && !args.source) {
    console.error('[morphix-env] migrate: --service requires --source (one service per migrated source).')
    return 1
  }
  const layers = configLayers()
  const home = homedir()
  const units = discoverPlaintextUnits(layers, home)
  const hints = legacyPlaintextHints(layers, units, home)
  // Two units sharing one plaintext file cannot migrate independently (the
  // first migration deletes/encrypts the file under the second). Refuse with
  // the collision spelled out — merging units is a config decision for the
  // user. Plan mode only warns (it is read-only); duplicate files within one
  // unit are not a collision.
  const fileOwners = new Map<string, string>()
  const collisions: string[] = []
  for (const unit of units) {
    for (const file of unit.files) {
      const owner = fileOwners.get(file)
      if (owner && owner !== unit.name) {
        collisions.push(`file ${file} is shared by units "${owner}" and "${unit.name}"`)
      }
      if (!owner) fileOwners.set(file, unit.name)
    }
  }
  for (const collision of collisions) {
    if (!args.to || args.dryRun) console.warn(`[morphix-env] Warning: ${collision}; split them into separate files (or sources) before migrating.`)
    else {
      console.error(`[morphix-env] migrate: ${collision}; split them into separate files (or sources) before migrating.`)
      return 1
    }
  }
  const selected = args.source ? units.filter((unit) => unit.name === args.source) : units
  if (args.source && !selected.length) {
    console.error(`[morphix-env] migrate: no plaintext unit named "${args.source}" in scope (already migrated or unknown).`)
    return 1
  }

  if (!args.to || args.dryRun) {
    printMigratePlan(selected, hints, args.to)
    return 0
  }

  if (!selected.length) {
    console.log('[morphix-env] No plaintext units in scope; nothing to migrate.')
    return 0
  }

  const target = args.to as MigrateTarget
  const startedAt = Date.now()
  const outcomes: UnitOutcome[] = []
  for (const unit of selected) {
    const outcome = await executeUnit(unit, target, { service: args.service || undefined }, home)
    outcomes.push(outcome)
    if (outcome.status === 'migrated') {
      console.log(`[morphix-env] Migrated ${unit.name} -> ${target} (${unit.keyNames.length} keys).`)
      for (const warning of outcome.warnings) console.warn(warning)
      for (const backup of outcome.backups) console.log(`[morphix-env] Backup (0600): ${backup}`)
    } else if (outcome.status === 'skipped') {
      console.warn(`[morphix-env] Skipped ${unit.name}: ${outcome.detail}`)
    } else {
      console.error(`[morphix-env] Failed ${unit.name}: ${outcome.detail}`)
      for (const backup of outcome.backups) console.error(`[morphix-env] Backup retained (0600): ${backup} — delete it by hand once verified.`)
    }
  }
  const failed = outcomes.filter((outcome) => outcome.status === 'failed')
  const exitCode = failed.length ? 1 : 0
  writeAudit({
    timestamp: new Date().toISOString(),
    profile: 'migrate',
    sources: selected.map((unit) => unit.name),
    keys: [...new Set(selected.flatMap((unit) => unit.keyNames))].sort(),
    outcome: failed.length ? 'failure' : 'success',
    exitCode,
    durationMs: Date.now() - startedAt,
  })
  if (outcomes.some((outcome) => outcome.backups.length)) {
    console.log('[morphix-env] Backups are 0600 copies of the original plaintext — delete them once your workflows are verified.')
  }
  return exitCode
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
  mx-env fetch <key-name>                 Print one value from a run --serve secret server
  mx-env export [options]                 Print eval-able export KEY='value' lines
  mx-env render <template> <output>       Substitute \${VAR} into a file (mode 0600)
  mx-env inject <template> <output>       Resolve mx-env:// references into a file (mode 0600)
  mx-env generate [options]               Generate public __env.js
  mx-env inspect [options]                Print key names, sources, and status only
  mx-env migrate [--to dotenvx|keychain]  Move plaintext local sources into encrypted storage
  mx-env doc [options]                    Generate a value-free project Skill
  mx-env audit [tail]                     Read value-free local audit events
  mx-env edit [--profile|--source <name>] Open the visual editor (15-min session)
  mx-env skill install [--target <t>]     Install the Agent Skill (global|project|trellis)
  mx-env skill show                       Show skill install status per target

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
  --warn-plaintext         Warn once on stderr when plaintext local sources supply keys
  --print-editor-url       Explicitly print the one-time local editor URL
  --target <scope>         Skill install target: global, project, or trellis
  --to <provider>          migrate destination: dotenvx or keychain (omit for a read-only plan)
  --source <name>          edit/migrate: select a single source
  --service <name>         migrate --to keychain: keychain service override (requires --source)
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
    case 'migrate': return cmdMigrate(args)
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
