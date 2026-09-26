import { execFileSync } from 'child_process'
import { existsSync, statSync } from 'fs'
import { delimiter, dirname, isAbsolute, resolve } from 'path'
import { parse as dotenvParse } from 'dotenv'
import {
  type DotenvxSource,
  expandHomePath,
  type InfisicalSource,
  type KeychainSource,
  type LocalSource,
  type SecretSource,
  type DopplerSource,
} from './config'
import { parseEnvFile } from './env'
import {
  fetchSecretsViaCLI,
  hasInfisicalCLI,
  isInfisicalLoggedIn,
  readInfisicalJson,
  resolveInfisicalSecrets,
} from './infisical'

export type SourceAvailability = 'loaded' | 'missing-optional' | 'skipped'

export interface SourceEntry {
  name: string
  source: SecretSource
  baseDir: string
  /** Internal conventional source. Never emitted as a user configuration declaration. */
  globalImplicit?: boolean
  /** Legacy compatibility sources are allowed to skip missing Infisical setup. */
  legacy?: boolean
}

export interface SourceContext {
  homeDir: string
  envName?: string | null
  noInfisical?: boolean
  allowInsecureGlobal?: boolean
  /** Values already composed at a lower precedence. Needed by dotenvx bootstrap only. */
  environment: NodeJS.ProcessEnv
}

export interface LoadedSource {
  name: string
  provider: SecretSource['provider']
  values: Record<string, string>
  availability: SourceAvailability
}

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

export function isPublicKey(key: string): boolean {
  return key.startsWith('NEXT_PUBLIC_') || key.startsWith('VITE_') || key.startsWith('EXPO_PUBLIC_')
}

function assertSafeGlobalFile(file: string, context: SourceContext, entry: SourceEntry): void {
  if (!entry.globalImplicit || context.allowInsecureGlobal || process.platform === 'win32') return
  const mode = statSync(file).mode
  if ((mode & 0o077) !== 0) {
    throw new SourceError(
      entry.name,
      'local',
      `[morphix-env] Global env file ${file} is readable by group or other users; set mode 0600 or pass --allow-insecure-global.`,
    )
  }
}

function resolveLocal(entry: SourceEntry, source: LocalSource, context: SourceContext): LoadedSource {
  const values: Record<string, string> = {}
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
    throw new SourceError(entry.name, source.provider, `[morphix-env] Local source "${entry.name}" has no available env file.`)
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
      throw new SourceError(entry.name, source.provider, `[morphix-env] Infisical source "${entry.name}" could not authenticate or load.`)
    }
  }

  if (!hasInfisicalCLI()) {
    if (entry.legacy) return { name: entry.name, provider: source.provider, values: {}, availability: 'skipped' }
    throw new SourceError(entry.name, source.provider, `[morphix-env] Infisical source "${entry.name}" needs Machine Identity credentials or an installed Infisical CLI.`)
  }

  if (!isInfisicalLoggedIn()) {
    if (entry.legacy) return { name: entry.name, provider: source.provider, values: {}, availability: 'skipped' }
    throw new SourceError(entry.name, source.provider, `[morphix-env] Infisical source "${entry.name}" is not logged in; run infisical login.`)
  }

  const result = fetchSecretsViaCLI(environment, source.paths, source.envPrefix)
  const firstError = result.errors[0]
  if (firstError) {
    if (entry.legacy) return { name: entry.name, provider: source.provider, values: {}, availability: 'skipped' }
    throw new SourceError(entry.name, source.provider, `[morphix-env] Infisical source "${entry.name}" could not load (${firstError.kind}).`)
  }

  return { name: entry.name, provider: source.provider, values: result.values, availability: 'loaded' }
}

function ensureCommand(command: string, sourceName: string, provider: SecretSource['provider']): string {
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
    throw new SourceError(sourceName, provider, `[morphix-env] ${provider} source "${sourceName}" requires the ${command} CLI.`)
  }
}

function resolveDotenvx(entry: SourceEntry, source: DotenvxSource, context: SourceContext): LoadedSource {
  const files = source.files.map((file) => resolveSourcePath(file, entry, context.homeDir))
  const existingFiles = files.filter(existsSync)
  if (!existingFiles.length) {
    if (source.optional) return { name: entry.name, provider: source.provider, values: {}, availability: 'missing-optional' }
    throw new SourceError(entry.name, source.provider, `[morphix-env] dotenvx source "${entry.name}" has no available env file.`)
  }
  if (existingFiles.length !== files.length) {
    throw new SourceError(entry.name, source.provider, `[morphix-env] dotenvx source "${entry.name}" is missing a declared env file.`)
  }

  const command = ensureCommand('dotenvx', entry.name, source.provider)
  const keys = [...new Set(existingFiles.flatMap((file) => Object.keys(parseEnvFile(file))))]
    .filter((key) => !key.startsWith('DOTENV_PUBLIC_KEY'))
  if (!keys.length) return { name: entry.name, provider: source.provider, values: {}, availability: 'loaded' }

  const helper = 'const keys=JSON.parse(process.argv[1]);const output={};for(const key of keys){if(process.env[key]!==undefined)output[key]=process.env[key]}process.stdout.write(JSON.stringify(output))'
  let stage = 'run'
  try {
    const output = execFileSync(
      command,
      ['run', '-f', existingFiles.join(','), '--', process.execPath, '-e', helper, JSON.stringify(keys)],
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
    throw new SourceError(entry.name, source.provider, `[morphix-env] dotenvx source "${entry.name}" could not decrypt or load (${stage}:${category}).`)
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
    throw new SourceError(entry.name, source.provider, `[morphix-env] os-keychain source "${entry.name}" is only available on macOS.`)
  }
  if (process.platform !== 'darwin') {
    throw new SourceError(entry.name, source.provider, `[morphix-env] os-keychain source "${entry.name}" is currently supported on macOS only.`)
  }

  const keytar = await loadKeytar()
  if (!keytar) {
    throw new SourceError(
      entry.name,
      source.provider,
      `[morphix-env] os-keychain source "${entry.name}" needs the optional native module "keytar", which is not usable on this machine. Reinstall morphix-env to rebuild it, or remove this source from the profile.`,
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
    throw new SourceError(entry.name, source.provider, `[morphix-env] os-keychain source "${entry.name}" could not be accessed.`)
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
    throw new SourceError(entry.name, source.provider, `[morphix-env] Doppler source "${entry.name}" could not authenticate or load.`)
  }
}

function parseDotenvText(text: string): Record<string, string> {
  // dotenv.parse requires no filesystem access and keeps provider values in memory only.
  return dotenvParse(text)
}

export async function loadSource(entry: SourceEntry, context: SourceContext): Promise<LoadedSource> {
  switch (entry.source.provider) {
    case 'local': return resolveLocal(entry, entry.source, context)
    case 'infisical': return resolveInfisical(entry, entry.source, context)
    case 'dotenvx': return resolveDotenvx(entry, entry.source, context)
    case 'os-keychain': return resolveKeychain(entry, entry.source)
    case 'doppler': return resolveDoppler(entry, entry.source, context)
  }
}
