# Proposal

## Why

`morphix-env` currently couples a project to one Infisical fetch plus local dotenv overrides. That is sufficient for today's startup commands but cannot compose team, project, developer-machine, encrypted-file, and alternative-provider sources through one predictable profile, nor give a user a safe visual route to edit the source they own. Normal development and Agent-assisted work also need a default that keeps values out of command output, inspection output, generated Skills, and conversation context wherever possible.

The project already depends on Infisical and must retain that working path. The opportunity is to make `morphix-env` a provider-neutral secret *composition and delivery* layer, while leaving secret storage, RBAC, rotation, version history, and value-editing authority with the underlying providers.

## What Changes

- Add ordered, named secret sources and named runtime profiles. A profile composes whole source collections rather than requiring projects to enumerate each secret; it produces one final environment for `run` and client-env generation.
- Add an automatically discovered user-level baseline at `~/.mx-env/`. `~/.mx-env/.env` is a zero-configuration global environment source, while optional `~/.mx-env/config.json` declares Keychain, encrypted-file, or provider-backed global sources. Projects retain the ability to select a global profile, extend it, override it, or opt out of global loading for reproducible commands.
- Introduce a provider adapter contract and ship compatible adapters for the existing Infisical path, local dotenv files, macOS Keychain, dotenvx encrypted files, and Doppler project/config sources. Existing `mx-env.config.json` files SHALL continue to work as an implicit Infisical-plus-local profile.
- Make source precedence and collisions explicit: duplicate keys fail by default and only a declared later source may override an earlier source. The result SHALL retain source provenance without persisting values.
- Add `mx-env` as the supported short CLI alias while retaining `morphix-env` unchanged. Add profile-oriented `run`, safe `inspect`, and `edit` commands.
- Add a one-shot local visual editor invoked by `edit --profile` or `edit --source`. It shows source/provenance/configuration state without returning values to the invoking Agent; it routes provider-backed editing to the provider and supports intentional user editing of approved local sources.
- Establish context-hygiene behavior: normal CLI output, inspection, audit records, generated Skill instructions, and captured child-process output avoid emitting secret values. This is best-effort leakage minimization, not a claim that an Agent which controls an injected child process is cryptographically unable to retrieve a value.
- Define provider-owned metadata and lifecycle as optional enrichment. The first release SHALL NOT create a new value vault, generic provider write API, Trellis integration, or an Agent credential proxy.

## Capabilities

### New Capabilities

- `environment-secret-composition`: Named source collections, provider adapters, ordered profiles, deterministic collision handling, and compatibility with the existing Infisical/local flow.
- `environment-secret-editor`: A user-owned, one-shot visual edit flow for assembled profiles and individual sources without exposing values through Agent-facing CLI output.
- `environment-secret-context-hygiene`: Safe CLI/Skill/audit/output behavior that minimizes accidental propagation of injected values into Agent context.

### Modified Capabilities

- None.

## Impact

- **Code:** `packages/morphix-env` becomes the primary implementation surface: CLI parsing, configuration loading, source composition, the current Infisical loader, local env handling, tests, README, and package bin entries. Consumer applications remain compatible and can migrate to profiles incrementally.
- **Dependencies and platform:** adapter implementations may invoke installed provider CLIs and the macOS Keychain APIs; their availability, authentication, and error messages must remain provider-specific and explicit. The change must not embed provider credentials or secret values in project configuration.
- **Developer workflow:** users gain `mx-env run --profile <name> -- <command>` and `mx-env edit`; generated Skills describe only the safe workflow. Existing `morphix-env` scripts continue to function.
- **Security boundary:** Providers remain the source of truth for values and provider-side RBAC/audit/rotation. This change records no secret values and does not expand product database or remote-storage scope.
