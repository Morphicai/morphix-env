# Spec Delta

## Purpose

Define how an application assembles one runtime environment from ordered whole-source collections while retaining existing Morphix Infisical and local-override workflows without storing secret values in composition configuration.

## ADDED Requirements

### Requirement: Named source collections and profiles
The system SHALL allow a project configuration to declare named source collections and named profiles. A profile SHALL reference source collections in an explicit order and SHALL be usable by runtime commands without enumerating each secret key in the project configuration.

Each source definition SHALL identify its provider and provider-specific selector or file location, but SHALL NOT contain a secret value. A project MAY declare multiple sources backed by the same provider.

#### Scenario: Profile composes team, machine, and project sources
- **WHEN** a user runs a command with a profile that orders an Infisical source, a macOS Keychain source, and a project-local source
- **THEN** the command receives the composed environment from those complete source collections in the declared order

#### Scenario: Profile refers to an unknown source
- **WHEN** a profile names a source that is not declared in its resolved configuration
- **THEN** the command fails before starting its child process and identifies the profile and unknown source name without printing secret values

### Requirement: Default user-level configuration discovery
The system SHALL discover `~/.mx-env/.env` and `~/.mx-env/config.json` before resolving a project configuration. `~/.mx-env/.env` SHALL be an implicit user-level dotenv source, so a user can put `KEY=value` in that file without creating any project or global configuration. `~/.mx-env/config.json` SHALL be optional and MAY declare further sources, profiles, and non-value defaults.

The implicit global dotenv source and a selected global default profile SHALL be lower precedence than project configuration and explicit command options. The system SHALL only load the conventional `~/.mx-env/.env` file automatically; any other value-bearing user file SHALL be explicitly declared by `~/.mx-env/config.json`. Before loading the implicit file, the system SHALL reject or require an explicit insecure-file opt-in for a file readable by group or other users.

A project configuration SHALL be able to select a user-level profile by name, extend it with project sources, override it through the documented collision policy, or opt out of all user-level configuration through a command option. The system SHALL treat the user-level baseline as lower precedence than project configuration and explicit command options.

When a legacy project configuration is present and no project profile is selected, the system SHALL compose the discovered user-level default profile first and then the project's implicit legacy Infisical/local profile. `--no-global` SHALL restore the legacy project's current project-only behavior.

#### Scenario: Project uses a default global profile without repeating sources
- **WHEN** `~/.mx-env/config.json` defines a `developer-default` profile and a project has no secret-composition configuration
- **THEN** a normal environment command resolves the `developer-default` profile when it is present without requiring the project to redeclare its sources

#### Scenario: User defines a global variable with no configuration
- **WHEN** `~/.mx-env/.env` contains `PERSONAL_API_URL=https://localhost:4444` and neither global nor project configuration declares that key
- **THEN** a normal environment command provides `PERSONAL_API_URL` to its child process without the user adding the key to a project config

#### Scenario: Project extends a global profile
- **WHEN** a project selects a user-level profile and adds a project-local source with explicit override authority
- **THEN** the resolved profile contains the user-level sources followed by the project-local source and uses the project-local value only for explicitly overridden duplicate keys

#### Scenario: Existing project receives the global baseline
- **WHEN** `~/.mx-env/config.json` defines a default profile and an existing project contains only legacy Infisical plus `.env.local` configuration
- **THEN** the command composes the global default before the project's legacy sources and preserves `.env.local` as the higher-priority legacy override

#### Scenario: Reproducible command opts out of user-level configuration
- **WHEN** a user invokes an environment command with `--no-global`
- **THEN** `~/.mx-env/config.json` and all of its sources are ignored while the project configuration and explicit command options remain available

#### Scenario: User-level configuration is absent
- **WHEN** neither `~/.mx-env/.env` nor `~/.mx-env/config.json` exists
- **THEN** the command continues with project or legacy configuration without warning or failure

#### Scenario: Insecure global dotenv file is refused
- **WHEN** `~/.mx-env/.env` is readable by group or other users and the caller has not explicitly allowed insecure global files
- **THEN** the command does not load that file and reports the file-permission problem without printing its contents

### Requirement: Provider-backed source collections
The system SHALL support source collections from Infisical, local dotenv files, dotenvx encrypted files, macOS Keychain, and Doppler project/configs. A provider SHALL expose source availability and key provenance to the composition layer without persisting resolved values outside the active command or an intentional interactive editing session.

The system SHALL preserve provider-native authentication and authorization behavior. It SHALL report a provider, authentication, platform, or selector failure distinctly enough for a user to remediate it without exposing a credential.

#### Scenario: Existing Infisical collection is used as a source
- **WHEN** an Infisical source is selected by a profile and the current user or workload has provider access
- **THEN** the system loads the source collection using the provider's normal authentication flow and labels resulting keys with that source's provenance

#### Scenario: macOS Keychain source is requested on another platform
- **WHEN** a profile selects a macOS Keychain source on a platform where it is unavailable
- **THEN** the system fails before starting the child process with an actionable platform-unavailable error and does not silently substitute a file source

#### Scenario: Doppler source cannot authenticate
- **WHEN** a profile selects a Doppler source and no valid Doppler local login or configured workload credential is available
- **THEN** the system reports that the Doppler source could not authenticate and does not start the requested command with a partial environment

### Requirement: Deterministic composition and collision handling
The system SHALL compose sources in profile order over the existing process environment, which is the lowest-priority input. A duplicate key between resolved sources SHALL fail the command by default. A later source SHALL replace an earlier key only when that later source explicitly declares override authority.

The composed result SHALL retain the winning source and all conflicting source names for status and editor views. It SHALL NOT serialize resolved values into configuration, index, provenance, or audit records.

#### Scenario: Explicit local override wins
- **WHEN** a profile loads a team source containing `API_URL` followed by a local source with explicit override authority containing `API_URL`
- **THEN** the child process receives the local value and status views identify the local source as the winner

#### Scenario: Undeclared duplicate is rejected
- **WHEN** two profile sources provide the same key and the later source has not declared override authority
- **THEN** the command exits before launching its child process and reports the key name and conflicting source names without reporting either value

#### Scenario: Existing process environment is retained when no source supplies a key
- **WHEN** the parent process supplies a key that no selected source supplies
- **THEN** the child process retains that parent-process value

### Requirement: Legacy configuration compatibility
The system SHALL continue to accept existing `mx-env.config.json` files that use `infisical`, `envFiles`, and `generate` without a profile declaration. It SHALL interpret such a configuration as an implicit legacy profile with documented precedence: local env files override Infisical values, which override neither an existing process value unless the configuration explicitly grants override authority.

Existing `run`, `generate`, and public-client environment behavior SHALL remain available during the migration to named profiles.

#### Scenario: Existing application config runs unchanged
- **WHEN** an application with only its existing `infisical.paths` and `envFiles` configuration invokes `morphix-env run`
- **THEN** it executes using the legacy Infisical-plus-local behavior without requiring a new profile or source declaration

#### Scenario: Legacy local file overrides Infisical
- **WHEN** a legacy config's Infisical source and `.env.local` both provide the same key
- **THEN** the child process receives the `.env.local` value

### Requirement: Command compatibility and short alias
The system SHALL expose `mx-env` as a short command with behavior equivalent to `morphix-env`. Existing `morphix-env` invocations SHALL remain valid and all profile-aware subcommands SHALL be available through both command names.

#### Scenario: Existing long command remains valid
- **WHEN** a project script invokes `morphix-env run -- <command>`
- **THEN** the command continues to run with its prior-compatible behavior

#### Scenario: Short command selects a profile
- **WHEN** a user invokes `mx-env run --profile api-dev -- <command>`
- **THEN** the requested command runs with the `api-dev` composed environment
