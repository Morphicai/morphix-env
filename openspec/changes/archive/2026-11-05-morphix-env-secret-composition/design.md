# Design

## Context

See [proposal.md](proposal.md) for motivation. Today `packages/morphix-env` parses one compact JSON configuration, loads Infisical directly into `process.env`, then lets dotenv files overwrite it before synchronously spawning a child process. The package has no provider-neutral intermediate representation, provenance, profile, editor, output-redaction, or short bin alias. Its documented precedence says `.env.local > Infisical > process.env`, but direct mutation during the existing Infisical load makes that contract easy to violate.

The package is an independently versioned Git submodule consumed by the API, web, and app-shell. It must not break their existing `morphix-env run` scripts. Provider values and credentials are prohibited from repository configuration, product storage, generated Skills, test fixtures, and normal diagnostic output.

## Goals / Non-Goals

**Goals:**

- Compose profile-selected *collections* of environment variables from existing providers and machine-local sources, with deterministic provenance and collisions.
- Discover a convenient user-level baseline at `~/.mx-env/` so personal/common sources are configured once and reused by default without defeating project reproducibility.
- Preserve legacy Infisical and local dotenv behavior while correcting it to match the documented precedence contract.
- Make `mx-env` the concise, documented human and Skill command while preserving the published long command.
- Give a present local user a visual editor that routes edits to the owning source and keeps values out of the invoking terminal, Agent result, audit log, and generated Skill.
- Reduce accidental context propagation from diagnostics and captured command output without overstating the protection offered by environment-variable injection.

**Non-Goals:**

- Store secret values, provider credentials, ownership records, or a second copy of provider metadata in Morphix databases or remote object storage.
- Reimplement provider RBAC, rotation, version history, approvals, or a generic cross-provider write/synchronization API.
- Provide Windows Credential Manager or Linux Secret Service in this change; the first OS-keychain adapter is explicitly macOS Keychain.
- Implement Trellis integration, an MCP server, an Agent credential broker/proxy, or a persistent visual management service.
- Claim that an Agent which can control an injected process cannot deliberately obtain its environment values.

## Decisions

### 1. Compose source collections behind a provider contract

Configuration will add an additive v2 shape:

```jsonc
{
  "sources": {
    "team": {
      "provider": "infisical",
      "paths": ["/shared", "/ai/api"]
    },
    "machine": {
      "provider": "os-keychain",
      "platform": "macos",
      "service": "com.morphix.env/global"
    },
    "project": {
      "provider": "doppler",
      "project": "morphicai-api",
      "config": "dev"
    },
    "local": {
      "provider": "local",
      "files": [".env.local"],
      "override": true
    }
  },
  "profiles": {
    "api-dev": ["team", "machine", "project", "local"]
  }
}
```

Internally, source loading returns an ephemeral collection of values plus non-value provenance (`key`, source name, provider, selector, precedence). The composition engine owns the final child environment; adapters do not mutate global `process.env`. `process.env` is copied once as the base layer, so a source cannot accidentally overwrite it before collision policy has run.

Provider credentials remain provider bootstrap inputs: e.g. Infisical machine identity, Doppler login or service token, and a dotenvx decryption key must come from the provider's normal local/CI authentication mechanism or another selected bootstrap source, never from committed profile configuration.

This separates the generic contract from incompatible provider domains: Infisical paths, Doppler project/configs, dotenvx files, and Keychain service/account namespaces are selectors, not a false universal `project/env` model.

**Alternatives considered:**

- A global `backend` option was rejected because one workload needs a remote team source, a project source, and local user overrides simultaneously.
- Per-key configuration was rejected as the primary model because a source collection is the scalable unit of provider authorization and administration. Per-key metadata can be added later as optional enrichment.
- Directly nesting `infisical run`, `doppler run`, and `dotenvx run` was rejected because it obscures ordering, provenance, conflict handling, and output handling.

### 1a. Load an optional user baseline before a project configuration

The CLI will always look for the conventional `~/.mx-env/.env`, then the optional `~/.mx-env/config.json`, before loading the project `mx-env.config.json`. The conventional dotenv file is the deliberately simple zero-configuration path:

```dotenv
# ~/.mx-env/.env — user-only file, never committed
PERSONAL_API_URL=https://localhost:4444
MY_DEVELOPMENT_TOKEN=...
```

A user only needs to create that one file once; every ordinary `mx-env` / `morphix-env` command gets it as a low-priority baseline. The loader checks that this value-bearing file is not group/world readable (the editor creates it with mode `0600`); an insecure file is refused unless the user deliberately supplies the documented insecure-file override. It is not copied into project configuration, command output, audit records, or generated Skills.

`~/.mx-env/config.json` is only needed for sources that cannot be expressed as dotenv key/value pairs. It can define, for example, a macOS Keychain collection, a global encrypted local file, or an authenticated shared provider profile:

```jsonc
// ~/.mx-env/config.json
{
  "sources": {
    "machine-keychain": {
      "provider": "os-keychain",
      "platform": "macos",
      "service": "com.morphix.env/global"
    },
    "personal-defaults": {
      "provider": "local",
      "files": ["~/.mx-env/env/default.env"]
    }
  },
  "profiles": {
    "developer-default": { "sources": ["machine-keychain", "personal-defaults"] }
  },
  "defaultProfile": "developer-default"
}
```

Resolution is deliberately layered: inherited process environment → `~/.mx-env/.env` → selected global default profile → project configuration → explicit CLI selection. A project profile can extend a global profile by name and append project sources, for example:

```jsonc
{
  "sources": {
    "api": { "provider": "infisical", "paths": ["/ai/api"] },
    "local": { "provider": "local", "files": [".env.local"], "override": true }
  },
  "profiles": {
    "api-dev": {
      "extends": "developer-default",
      "sources": ["api", "local"]
    }
  },
  "defaultProfile": "api-dev"
}
```

When no project profile is declared, the global default remains a baseline rather than replacing existing configuration: an implicit legacy project profile is appended after it. Thus today's Infisical and `.env.local` settings remain active and `.env.local` remains the high-priority legacy override. A project-local `defaultProfile` replaces the global default only when it explicitly selects a project profile. Projects cannot silently mutate the user's file.

`--no-global` ignores both user-level discovery files and makes commands reproducible in CI, troubleshooting, or unfamiliar repositories. For an existing project it restores today's project-only legacy behavior. `--profile` is highest priority and can name either a resolved global profile or project profile. Missing either user-level discovery file is normal and silent. High-value values are better placed in the selected Keychain source, but the conventional `~/.mx-env/.env` exists for the convenient user-global case.

**Alternatives considered:**

- Requiring every project to `extends: ~/.mx-env/config.json` was rejected because it preserves the repetition problem and makes the common path configuration-heavy.
- Loading arbitrary `~/.mx-env/*.env` files implicitly was rejected because a hidden source list is difficult to audit. Only the exact conventional `~/.mx-env/.env` is implicit; every other value-bearing file/provider source is declared in `config.json`.
- Automatic global loading with no opt-out was rejected because it makes CI/debugging and third-party repositories non-reproducible.

### 2. Use fail-closed collision policy with an explicit local override

Profile order is low to high precedence. The first occurrence of a key becomes the candidate value. A later source is an error unless it declares `override: true`; an approved override replaces the candidate and records both provenance entries. A source failure is fatal by default; optionality must be explicit and is limited to a missing local source, never a failed remote authentication.

The legacy configuration is compiled at load time into an implicit profile containing the configured Infisical source followed by configured local files with override authority. This preserves user-facing compatibility while moving all behavior through one composition engine. Client environment generation reads the final composed environment but continues to select only its supported public prefixes.

**Alternatives considered:**

- Last-value-wins was rejected because it can silently send a process to the wrong database, provider, or deployment environment.
- Treating all missing sources as warnings was rejected because partial secret environments create misleading downstream failures.

### 3. Provider adapters are value resolvers; provider UI remains authoritative

The first release defines adapters for:

- `infisical`: refactors the existing SDK/CLI machine-identity and local-login routes into a value resolver.
- `local`: parses explicit dotenv files without writing values to disk or global process state.
- `dotenvx`: resolves selected encrypted files through a non-logging, provider-supported runtime path; its private key remains outside configuration.
- `os-keychain` on macOS: reads a service-scoped generic-password collection where `service` is the configured namespace and `account` is the environment-key name.
- `doppler`: resolves one configured project/config through the installed Doppler CLI's normal local login or least-privilege workload authentication.

Adapters expose source availability, names, and provenance to the editor. A provider-managed source routes value editing to the provider's native UI/authorized workflow; it does not expose a common `upsert(value)` interface. The editor can directly edit only the selected local dotenv, dotenvx, or Keychain source.

The macOS implementation uses a Security.framework-compatible collection query rather than treating a Keychain source as a long list of project-declared keys. Platform-specific native implementation choices are isolated behind the adapter.

**Alternatives considered:**

- Building a Morphix Vault or generic remote write API was rejected because it duplicates the security-critical capabilities providers already own.
- Treating an arbitrary home-directory file as implicit configuration was rejected. `~/.mx-env/config.json` is the one documented discovery point; it is inspectable, has defined precedence, and can be disabled with `--no-global`. Its configured sources are intentional rather than arbitrary home-directory injection.

### 4. A one-shot loopback editor is the visual control plane

`edit` starts a short-lived server bound only to loopback, creates a high-entropy one-time session, opens the user's browser when possible, and expires when editing completes or times out. The CLI reports only an editor URL/status and never serializes editor values to terminal output.

The profile screen is a value-free composition table: key name, configured/missing state, source precedence, winning source, and conflicts. Selecting an Infisical or Doppler source invokes a provider-native edit route. Selecting local, dotenvx, or Keychain sources opens the associated local editor after interactive confirmation; mutations are constrained to that one selected source.

The design is intentionally an ephemeral utility, not a server or a universal management dashboard. Its browser isolation minimizes accidental Agent transcript leakage but is not a security boundary against a local Agent with unrestricted browser and process control.

**Alternatives considered:**

- A persistent Morphix web dashboard was rejected for this phase: it introduces authentication, availability, and a new secret-adjacent attack surface before users need it.
- Opening `$EDITOR` was rejected as the sole flow because the requirement is a discoverable visual editor and provider source routing.

### 5. Context hygiene is output handling, not a new authorization claim

`inspect` becomes value-free; it reports only source and status. Profile loading, provider errors, and audit events pass through a safe error formatter. Audit events record profile/source names, key names, outcome, duration, and exit status, but never values, value prefixes, provider raw output, or child command arguments.

The child runner changes from inherited `stdio` to controlled forwarding when output can enter Agent/tool capture. It builds a per-invocation redaction set from resolved non-public values, replaces exact occurrences using a streaming redactor that handles chunk boundaries, and forwards only sanitized output. It preserves child exit codes. Public values deliberately emitted to a configured browser runtime file are outside this redaction set because they are declared public.

Skill generation emits command and operator-workflow guidance only: it directs an Agent to use `mx-env edit --profile` and forbids asking users to paste values into chat. It contains neither resolved values nor partial prefixes.

**Alternatives considered:**

- Relying only on instructions or regex secret scanners was rejected because accidental `console.log` and provider errors remain common routes into captured context.
- Promising complete exfiltration prevention was rejected: a process receiving environment variables can encode or send them elsewhere. A broker/proxy is the later, distinct solution for that higher-risk threat model.

## Risks / Trade-offs

- **[Provider semantic mismatch]** Doppler, Infisical, dotenvx, and Keychain use different selectors and authentication models. → Keep source selector configuration provider-specific and test each adapter against a fake/controlled command boundary.
- **[Bootstrap-secret recursion]** A Doppler or dotenvx bootstrap credential can itself become another unmanaged secret. → Require a documented bootstrap mechanism and support Keychain/CI workload identity; never allow raw provider tokens in project configuration.
- **[Native Keychain dependency]** macOS Keychain collection access needs platform-specific code and user authorization behavior. → Isolate it behind `os-keychain`, add platform-gated tests, and fail explicitly on unsupported platforms.
- **[Redaction false negatives]** Exact-value redaction cannot catch encodings, transformations, values shorter than a safe matching threshold, or external egress. → Describe this limitation prominently, test exact-output and chunk-boundary behavior, and defer broker/proxy decisions to a separate change.
- **[Redaction can affect interactive output]** Controlled forwarding may alter terminal streaming and progress displays. → Preserve stderr/stdout ordering as far as possible, retain exit semantics, and allow only a documented human-local bypass that never applies to Agent integration.
- **[Editor local attack surface]** A local browser editor could expose values if it binds broadly or leaves a reusable token. → Bind loopback only, use an expiring one-time session, never log values, and terminate on completion/timeout.
- **[Submodule release coordination]** Consumer migration and package release are separate repositories. → Build/test and commit the package on its package branch first, release/version it, then update consumer dependency and root submodule pointers through their normal workflow.

## Migration Plan

1. Add `~/.mx-env/.env` and user-level configuration discovery plus the composition engine behind the existing configuration shape; run tests for absent global files, global dotenv baseline, global default profile, project extension, file-permission protection, and `--no-global` alongside API, web, and shell legacy configurations without changing their scripts.
2. Add `mx-env` as a second bin pointing at the same CLI entry point and update new documentation/Skills to use it. Retain `morphix-env` indefinitely for backwards compatibility.
3. Add adapters incrementally with opt-in named sources: Infisical/local first, then macOS Keychain, dotenvx, and Doppler. A provider outage or missing authentication must never cause a legacy config to silently change source.
4. Add `edit`, value-free inspection/audit, and redacted forwarding; validate using runtime-generated, non-credential test sentinels that are never committed as secret fixtures.
5. Migrate one consumer profile at a time after its equivalent legacy command, client-env output, and test suite pass. Keep its legacy configuration available for rollback until its profile is verified.
6. Roll back a consumer by removing `--profile` or restoring its legacy configuration. Roll back the package by pinning the prior published version; provider values and ownership remain untouched throughout.

## Open Questions

- The one-shot editor's UI implementation technology is intentionally left to implementation, provided it satisfies loopback-only, single-session, and no-value-output behavior.
- The adapter's internal bridge for dotenvx will be selected during implementation based on the installed dotenvx API/CLI capabilities, provided it does not write plaintext values to files, logs, or ordinary stdout.
