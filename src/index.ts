/**
 * Public SDK facade. Consumers (Trellis, app build scripts) import the pure
 * composition engine and the value-safe helpers directly instead of spawning
 * the CLI. The CLI entry (cli.ts) and the process-mutating legacy helpers
 * (loadEnvFiles, fetchInfisicalSecrets) are deliberately not re-exported.
 */
export { composeEnvironment, CompositionError } from './composition'
export type {
  ComposeOptions,
  EnvironmentComposition,
  KeyProvenance,
  SourceStatus,
} from './composition'
export { loadConfigLayers, validateConfig } from './config'
export type {
  ConfigLayers,
  LoadedConfig,
  LoadConfigOptions,
  MxEnvConfig,
  ProfileDefinition,
  ProfileInput,
  SecretSource,
} from './config'
export { StreamingRedactor } from './redaction'
export type { SourceEntry } from './sources'
