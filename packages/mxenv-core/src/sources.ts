import { execFileSync } from 'child_process'
import { existsSync, statSync } from 'fs'
import { delimiter, dirname, isAbsolute, join, resolve } from 'path'
import { parse as dotenvParse } from 'dotenv'
import {
  type DotenvxSource,
  type InfisicalSource,
  isPublicKey,
  type KeychainSource,
  type LoadedSource,
  type LocalSource,
  type PluginSource,
  type SecretSource,
  type SourceAvailability,
  type SourceContext,
  type SourceEntry,
  type DopplerSource,
} from './contracts'
import { expandHomePath } from './config'
import { parseEnvFile } from './env'
import {
  fetchSecretsViaCLI,
  hasInfisicalCLI,
  isInfisicalLoggedIn,
  readInfisicalJson,
  resolveInfisicalSecrets,
} from './infisical'

// 结构类型与 isPublicKey 规则已抽至 ./contracts（L0）；re-export 保持原导出面。
export { isPublicKey } from './contracts'
export type { LoadedSource, SourceAvailability, SourceContext, SourceEntry } from './contracts'

export class SourceError extends Error {
  constructor(
    readonly sourceName: string,
    readonly provider: SecretSource['provider'],
    message: string,
  ) {
    super(message)
    this.name = 'SourceError'
  }
}

function resolveSourcePath(path: string, entry: SourceEntry, homeDir: string): string {
  const expanded = expandHomePath(path, homeDir)
  return isAbsolute(expanded) ? expanded : resolve(entry.baseDir, expanded)
}

function assertSafeGlobalFile(file: string, context: SourceContext, entry: SourceEntry): void {
  if (!entry.globalImplicit || context.allowInsecureGlobal || process.platform === 'win32') return
  const mode = statSync(file).mode
  if ((mode & 0o077) !== 0) {
    throw new SourceError(
      entry.name,
      entry.source.provider,
      `[mxenv] Global env file ${file} is readable by group or other users; set mode 0600 or pass --allow-insecure-global.`,
    )
  }
}

function resolveLocal(entry: SourceEntry, source: LocalSource, context: SourceContext): LoadedSource {
  const values: Record<string, string> = Object.create(null)
  let found = false

  for (const rawFile of source.files) {
    const file = resolveSourcePath(rawFile, entry, context.homeDir)
    if (!existsSync(file)) continue
    found = true
    assertSafeGlobalFile(file, context, entry)
    Object.assign(values, parseEnvFile(file))
  }

  if (!found) {
    if (source.optional) {
      return { name: entry.name, provider: source.provider, values: {}, availability: 'missing-optional' }
    }
    throw new SourceError(entry.name, source.provider, `[mxenv] Local source "${entry.name}" has no available env file.`)
  }

  return { name: entry.name, provider: source.provider, values, availability: 'loaded' }
}

async function resolveInfisical(entry: SourceEntry, source: InfisicalSource, context: SourceContext): Promise<LoadedSource> {
  if (context.noInfisical) {
    return { name: entry.name, provider: source.provider, values: {}, availability: 'skipped' }
  }

  const environment = source.env || context.envName || process.env.DEPLOY_ENV || process.env.INFISICAL_ENV || 'prod'
  const projectId = source.projectId || process.env.INFISICAL_PROJECT_ID || readInfisicalJson().workspaceId || ''
  const clientId = process.env.INFISICAL_CLIENT_ID || ''
  const clientSecret = process.env.INFISICAL_CLIENT_SECRET || ''

  if (clientId && clientSecret && projectId) {
    try {
      const result = await resolveInfisicalSecrets({
        clientId,
        clientSecret,
        projectId,
        environment,
        paths: source.paths,
        siteUrl: source.siteUrl,
      }, source.envPrefix)
      return { name: entry.name, provider: source.provider, values: result.values, availability: 'loaded' }
    } catch {
      throw new SourceError(entry.name, source.provider, `[mxenv] Infisical source "${entry.name}" could not authenticate or load.`)
    }
  }

  if (!hasInfisicalCLI()) {
    if (entry.legacy) return { name: entry.name, provider: source.provider, values: {}, availability: 'skipped' }
    throw new SourceError(entry.name, source.provider, `[mxenv] Infisical source "${entry.name}" needs Machine Identity credentials or an installed Infisical CLI.`)
  }

  if (!isInfisicalLoggedIn()) {
    if (entry.legacy) return { name: entry.name, provider: source.provider, values: {}, availability: 'skipped' }
    throw new SourceError(entry.name, source.provider, `[mxenv] Infisical source "${entry.name}" is not logged in; run infisical login.`)
  }

  const result = fetchSecretsViaCLI(environment, source.paths, source.envPrefix)
  const firstError = result.errors[0]
  if (firstError) {
    if (entry.legacy) return { name: entry.name, provider: source.provider, values: {}, availability: 'skipped' }
    throw new SourceError(entry.name, source.provider, `[mxenv] Infisical source "${entry.name}" could not load (${firstError.kind}).`)
  }

  return { name: entry.name, provider: source.provider, values: result.values, availability: 'loaded' }
}

export function ensureCommand(command: string, sourceName: string, provider: SecretSource['provider']): string {
  const localBinary = resolve(process.cwd(), 'node_modules', '.bin', command)
  try {
    if (existsSync(localBinary)) {
      execFileSync(localBinary, ['--version'], { stdio: ['ignore', 'ignore', 'ignore'] })
      return localBinary
    }
    execFileSync(command, ['--version'], { stdio: ['ignore', 'ignore', 'ignore'] })
    return command
  } catch {
    // Package-manager scripts normally put this on PATH. The explicit local
    // fallback keeps the adapter usable in direct Node/Vitest execution too.
    try {
      if (existsSync(localBinary)) {
        execFileSync(localBinary, ['--version'], { stdio: ['ignore', 'ignore', 'ignore'] })
        return localBinary
      }
    } catch {
      // Fall through to the value-free availability error below.
    }
    throw new SourceError(sourceName, provider, `[mxenv] ${provider} source "${sourceName}" requires the ${command} CLI.`)
  }
}

function resolveDotenvx(entry: SourceEntry, source: DotenvxSource, context: SourceContext): LoadedSource {
  const files = source.files.map((file) => resolveSourcePath(file, entry, context.homeDir))
  const existingFiles = files.filter(existsSync)
  if (!existingFiles.length) {
    if (source.optional) return { name: entry.name, provider: source.provider, values: {}, availability: 'missing-optional' }
    throw new SourceError(entry.name, source.provider, `[mxenv] dotenvx source "${entry.name}" has no available env file.`)
  }
  if (existingFiles.length !== files.length) {
    throw new SourceError(entry.name, source.provider, `[mxenv] dotenvx source "${entry.name}" is missing a declared env file.`)
  }
  // The implicit global file's `.env.keys` is the plaintext-equivalent secret
  // after migration — it gets the same 0600 gate the plaintext .env had.
  if (entry.globalImplicit && !context.allowInsecureGlobal && process.platform !== 'win32') {
    const keysFile = join(dirname(existingFiles[0]), '.env.keys')
    if (existsSync(keysFile) && (statSync(keysFile).mode & 0o077) !== 0) {
      throw new SourceError(
        entry.name,
        source.provider,
        `[mxenv] Global dotenvx keys file ${keysFile} is readable by group or other users; set mode 0600 or pass --allow-insecure-global.`,
      )
    }
  }

  const command = ensureCommand('dotenvx', entry.name, source.provider)
  const keys = [...new Set(existingFiles.flatMap((file) => Object.keys(parseEnvFile(file))))]
    .filter((key) => !key.startsWith('DOTENV_PUBLIC_KEY'))
  if (!keys.length) return { name: entry.name, provider: source.provider, values: {}, availability: 'loaded' }

  const helper = 'const keys=JSON.parse(process.argv[1]);const output={};for(const key of keys){if(process.env[key]!==undefined)output[key]=process.env[key]}process.stdout.write(JSON.stringify(output))'
  let stage = 'run'
  try {
    const output = execFileSync(
      // --overload aligns dotenvx with every other provider: composed file
      // values win over same-named variables already in the parent env.
      command,
      ['run', '--overload', '-f', existingFiles.join(','), '--', process.execPath, '-e', helper, JSON.stringify(keys)],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...context.environment,
          // dotenvx's executable is a node script; direct API callers may
          // provide an intentionally small environment, so retain a path to
          // the current Node runtime for its shebang.
          PATH: [dirname(process.execPath), context.environment.PATH || process.env.PATH || ''].filter(Boolean).join(delimiter),
        },
        // dotenvx locates .env.keys relative to its working directory.
        cwd: dirname(existingFiles[0]),
      },
    )
    // dotenvx versions differ on whether they emit a non-secret injection
    // notice before child stdout. The child always prints the final JSON line.
    stage = 'parse-output'
    const json = output.trim().split('\n').reverse().find((line) => line.trim().startsWith('{')) || ''
    const parsed = JSON.parse(json) as Record<string, unknown>
    const values = Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'string')) as Record<string, string>
    return { name: entry.name, provider: source.provider, values, availability: 'loaded' }
  } catch (error: any) {
    const category = typeof error?.code === 'string' ? error.code : 'failed'
    const sniffHint = entry.globalImplicit
      ? ' The global file looks dotenvx-encrypted; if it is actually plaintext, remove the DOTENV_PUBLIC_KEY / encrypted: markers.'
      : ''
    throw new SourceError(entry.name, source.provider, `[mxenv] dotenvx source "${entry.name}" could not decrypt or load (${stage}:${category}).${sniffHint}`)
  }
}

type KeytarModule = typeof import('keytar')
let keytarModule: KeytarModule | null | undefined

/**
 * keytar is an optional native module. Load it lazily so machines where the
 * native build is unavailable keep a fully working CLI for every non-keychain
 * source; only an actual os-keychain source reports the missing module.
 */
export async function loadKeytar(): Promise<KeytarModule | null> {
  if (keytarModule !== undefined) return keytarModule
  try {
    const imported = await import('keytar')
    keytarModule = (imported as unknown as { default?: KeytarModule }).default ?? imported
  } catch {
    keytarModule = null
  }
  return keytarModule
}

async function resolveKeychain(entry: SourceEntry, source: KeychainSource): Promise<LoadedSource> {
  if (source.platform === 'macos' && process.platform !== 'darwin') {
    throw new SourceError(entry.name, source.provider, `[mxenv] os-keychain source "${entry.name}" is only available on macOS.`)
  }
  if (process.platform !== 'darwin') {
    throw new SourceError(entry.name, source.provider, `[mxenv] os-keychain source "${entry.name}" is currently supported on macOS only.`)
  }

  const keytar = await loadKeytar()
  if (!keytar) {
    throw new SourceError(
      entry.name,
      source.provider,
      `[mxenv] os-keychain source "${entry.name}" needs the optional native module "keytar", which is not usable on this machine. Reinstall @morphixai/mxenv to rebuild it, or remove this source from the profile.`,
    )
  }

  try {
    const credentials = await keytar.findCredentials(source.service)
    return {
      name: entry.name,
      provider: source.provider,
      values: Object.fromEntries(credentials.map(({ account, password }) => [account, password])),
      availability: 'loaded',
    }
  } catch {
    throw new SourceError(entry.name, source.provider, `[mxenv] os-keychain source "${entry.name}" could not be accessed.`)
  }
}

function resolveDoppler(entry: SourceEntry, source: DopplerSource, context: SourceContext): LoadedSource {
  const command = ensureCommand('doppler', entry.name, source.provider)
  try {
    const output = execFileSync(
      command,
      ['secrets', 'download', '--no-file', '--format', 'dotenv', '--project', source.project, '--config', source.config],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: context.environment },
    )
    return { name: entry.name, provider: source.provider, values: parseDotenvText(output), availability: 'loaded' }
  } catch {
    throw new SourceError(entry.name, source.provider, `[mxenv] Doppler source "${entry.name}" could not authenticate or load.`)
  }
}

function parseDotenvText(text: string): Record<string, string> {
  // dotenv.parse requires no filesystem access and keeps provider values in memory only.
  return dotenvParse(text)
}

const PLUGIN_TIMEOUT_MS = 30_000

/**
 * Runs `mxenv-provider-<plugin> <KEY>` once per declared key (legacy
 * `mx-env-provider-<plugin>` accepted as fallback while the 0.12.x shim window
 * lasts; new name wins when both exist). The plugin's stdout is the value (one
 * trailing line ending stripped); its stderr never reaches the terminal
 * because it may contain sensitive material.
 */
function resolvePlugin(entry: SourceEntry, source: PluginSource, context: SourceContext): LoadedSource {
  const primary = `mxenv-provider-${source.plugin}`
  const legacy = `mx-env-provider-${source.plugin}`
  // 首个成功执行的候选名对本源全程沿用，保证一次加载内行为一致。
  let command: string | null = null
  const values: Record<string, string> = Object.create(null)

  for (const key of source.keys) {
    let output: string | null = null
    const candidates: string[] = command ? [command] : [primary, legacy]
    for (const candidate of candidates) {
      try {
        output = execFileSync(candidate, [key], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, ...context.environment },
          timeout: PLUGIN_TIMEOUT_MS,
        })
        command = candidate
        break
      } catch (error: any) {
        if (error?.code === 'ENOENT') continue
        const reason = error?.signal
          ? `killed by signal ${error.signal}${error.killed ? ' (timeout or forced kill)' : ''}`
          : typeof error?.code === 'string' ? error.code : `exit ${error?.status ?? 'unknown'}`
        throw new SourceError(entry.name, source.provider, `[mxenv] plugin source "${entry.name}" failed for key "${key}" (${reason}).`)
      }
    }
    if (output === null) {
      if (source.optional) return { name: entry.name, provider: source.provider, values: {}, availability: 'missing-optional' }
      throw new SourceError(entry.name, source.provider, `[mxenv] plugin source "${entry.name}" needs ${primary} on PATH (0.12.x 内旧名 ${legacy} 亦可).`)
    }
    values[key] = output.endsWith('\r\n') ? output.slice(0, -2) : output.endsWith('\n') ? output.slice(0, -1) : output
  }

  return { name: entry.name, provider: source.provider, values, availability: 'loaded' }
}

export async function loadSource(entry: SourceEntry, context: SourceContext): Promise<LoadedSource> {
  switch (entry.source.provider) {
    case 'local': return resolveLocal(entry, entry.source, context)
    case 'infisical': return resolveInfisical(entry, entry.source, context)
    case 'dotenvx': return resolveDotenvx(entry, entry.source, context)
    case 'os-keychain': return resolveKeychain(entry, entry.source)
    case 'doppler': return resolveDoppler(entry, entry.source, context)
    case 'plugin': return resolvePlugin(entry, entry.source, context)
  }
}
