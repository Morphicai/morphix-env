/**
 * Public SDK facade. Consumers (Trellis, app build scripts) import the pure
 * composition engine and the value-safe helpers directly instead of spawning
 * the CLI. The CLI entry (cli.ts) and the process-mutating legacy helpers
 * (loadEnvFiles, fetchInfisicalSecrets) are deliberately not re-exported.
 */
export { composeEnvironment, CompositionError } from '@morphixai/mxenv-core'
export type {
  ComposeOptions,
  EnvironmentComposition,
  KeyProvenance,
  SourceStatus,
} from '@morphixai/mxenv-core'
export { loadConfigLayers, validateConfig } from '@morphixai/mxenv-core'
export type {
  ConfigLayers,
  LoadedConfig,
  LoadConfigOptions,
  MxEnvConfig,
  ProfileDefinition,
  ProfileInput,
  SecretSource,
} from '@morphixai/mxenv-core'
export { StreamingRedactor } from '@morphixai/mxenv-core'
export type { SourceEntry } from '@morphixai/mxenv-core'
