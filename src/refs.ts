import { composeEnvironment, type ComposeOptions, type EnvironmentComposition } from './composition'
import type { ConfigLayers } from './config'

/**
 * 1Password-style reference (`op://vault/item/field`) for value-free files:
 * `mx-env://<profile>/<KEY>` is written into MCP configs and dotenv templates
 * and resolved at the consumption point (`mx-env inject` / `mx-env run`), so
 * those files can be committed without carrying a value.
 */
const MX_ENV_REFERENCE_SOURCE = 'mx-env:\\/\\/([A-Za-z0-9][A-Za-z0-9_-]*)\\/([A-Za-z0-9_][A-Za-z0-9_.-]*)'

function referencePattern(): RegExp {
  return new RegExp(MX_ENV_REFERENCE_SOURCE, 'g')
}

export interface MxEnvReference {
  profile: string
  key: string
}

export interface UnresolvedReference extends MxEnvReference {
  reason: 'missing' | 'cycle'
}

export interface ReferenceResolution {
  text: string
  missing: UnresolvedReference[]
}

/** Unique `mx-env://profile/KEY` references in declaration order. */
export function findMxEnvReferences(text: string): MxEnvReference[] {
  const found = new Map<string, MxEnvReference>()
  for (const match of text.matchAll(referencePattern())) {
    const reference: MxEnvReference = { profile: match[1], key: match[2] }
    found.set(`${reference.profile}/${reference.key}`, reference)
  }
  return [...found.values()]
}

export function hasMxEnvReference(text: string): boolean {
  return referencePattern().test(text)
}

/**
 * Resolves `mx-env://` references against composed profiles without mutating
 * process.env. Compositions are cached per resolver; the `chain` argument only
 * travels down one resolution path so a reference loop is reported as a cycle
 * instead of recursing forever.
 */
export class ReferenceResolver {
  private readonly compositions = new Map<string, Promise<EnvironmentComposition>>()

  constructor(private readonly layers: ConfigLayers, private readonly composeOptions: ComposeOptions) {}

  private compose(profile: string): Promise<EnvironmentComposition> {
    let pending = this.compositions.get(profile)
    if (!pending) {
      pending = composeEnvironment(this.layers, { ...this.composeOptions, profile })
      this.compositions.set(profile, pending)
    }
    return pending
  }

  /**
   * The value of KEY as `profile` composes it, resolving nested references.
   * The chain carries `profile/key` tokens of the current resolution path so
   * only a genuine loop (the same key re-entered) is a cycle — a nested lookup
   * of a different key in the same profile stays legal.
   */
  async valueOf(profile: string, key: string, chain: readonly string[] = []): Promise<{ value?: string; missing?: UnresolvedReference }> {
    const token = `${profile}/${key}`
    if (chain.includes(token)) return { missing: { profile, key, reason: 'cycle' } }
    let composition: EnvironmentComposition
    try {
      composition = await this.compose(profile)
    } catch {
      // An unknown profile or an unreachable source surfaces as an unresolved
      // reference; the caller reports names only, never provider errors.
      return { missing: { profile, key, reason: 'missing' } }
    }
    const raw = composition.environment[key]
    if (raw === undefined || raw === null) return { missing: { profile, key, reason: 'missing' } }
    if (!hasMxEnvReference(raw)) return { value: raw }
    const resolved = await this.resolveText(raw, [...chain, token])
    if (resolved.missing.length) return { missing: resolved.missing[0] }
    return { value: resolved.text }
  }

  /** Substitutes every resolvable reference; unresolvable ones stay literal. */
  async resolveText(text: string, chain: readonly string[] = []): Promise<ReferenceResolution> {
    const references = findMxEnvReferences(text)
    if (!references.length) return { text, missing: [] }

    const resolved = await Promise.all(references.map(async (reference) => ({
      reference,
      result: await this.valueOf(reference.profile, reference.key, chain),
    })))

    const values = new Map<string, string>()
    const missing: UnresolvedReference[] = []
    for (const { reference, result } of resolved) {
      if (result.value !== undefined) values.set(`${reference.profile}/${reference.key}`, result.value)
      else if (result.missing) missing.push(result.missing)
    }

    const output = text.replace(referencePattern(), (match, profile, key) => (
      values.get(`${profile}/${key}`) ?? match
    ))
    return { text: output, missing }
  }
}
