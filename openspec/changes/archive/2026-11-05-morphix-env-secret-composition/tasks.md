# Tasks

## 1. Baseline and configuration contract

- [x] 1.1 Record the current `morphix-env` CLI/config behavior with unit tests for Infisical, local dotenv precedence, public-env generation, and legacy consumer configs; verify `pnpm test` passes before refactoring.
- [x] 1.2 Extend the configuration schema with named `sources`, ordered `profiles`, explicit source override authority, and provider-specific selector validation; verify invalid source/profile references fail without exposing values.
- [x] 1.3 Add automatic `~/.mx-env/.env` discovery with user-only permission checks, plus `~/.mx-env/config.json` discovery, global/default-profile resolution, project profile extension, legacy-project overlay rules, and `--no-global`; verify the global dotenv works with no configuration, absent global files are silent, global defaults are reused without project duplication, legacy Infisical/local sources remain active above the global baseline, insecure global dotenv files are refused, and `--no-global` excludes every global source.
- [x] 1.4 Compile legacy `infisical`, `envFiles`, and `generate` configuration into an implicit profile; verify existing API, web, and app-shell configuration fixtures resolve identically to the documented `.env.local > Infisical > process.env` contract.
- [x] 1.5 Add a value-free provenance/result model that carries key names, source identity, precedence, configured state, and conflicts separately from ephemeral values; verify serialized config/index/audit model tests contain no runtime-generated sentinel value.

## 2. Profile composition and command compatibility

- [x] 2.1 Implement ordered profile composition over a copied parent environment with fail-closed duplicate detection and explicit later-source override; verify unit tests cover inherited process values, allowed override, rejected conflict, and fatal unavailable remote source.
- [x] 2.2 Refactor the existing Infisical and local dotenv loaders into composition adapters that do not mutate global `process.env` while resolving; verify the resolved child environment follows the legacy precedence contract.
- [x] 2.3 Add `--profile` selection to `run`, `generate`, and `inspect`; verify a temporary fixture profile injects only its selected collection and unknown profiles fail before spawn.
- [x] 2.4 Publish `mx-env` as a second package bin that uses the same entry point as `morphix-env`; verify both names have identical `--version`, `--help`, legacy `run`, and profile `run` behavior.

## 3. Provider source adapters

- [x] 3.1 Finish the Infisical adapter around existing SDK Machine Identity and local CLI login behavior; verify provider failures are value-free and do not silently fall through to a partial environment.
- [x] 3.2 Implement the `local` adapter for explicit dotenv files, including source-level optional missing files and explicit override authority; verify optional missing local files are skipped while a malformed declared file fails safely.
- [x] 3.3 Select and implement a non-logging dotenvx bridge for encrypted source files; verify an encrypted temporary fixture resolves at runtime without creating plaintext files or emitting its runtime-generated sentinel to test output.
- [x] 3.4 Implement the macOS `os-keychain` adapter as a service-scoped collection with platform gating; verify collection provenance in automated tests and perform a documented macOS manual test that creates then removes a one-off test item.
- [x] 3.5 Implement the Doppler project/config adapter using the normal Doppler authentication path without accepting raw tokens in project config; verify contract tests with a controlled CLI boundary and a documented opt-in manual Doppler login/service-token test.
- [x] 3.6 Add adapter capability, availability, and authentication-error tests for all providers; verify no test source contains a real credential or a committed credential-shaped fixture.

## 4. Context-hygiene and safe diagnostics

- [x] 4.1 Replace value-bearing `inspect` behavior with profile/source/key/status/provenance diagnostics that never print full or partial values; verify short and long runtime-generated values are absent from captured output.
- [x] 4.2 Add value-free safe formatting for provider errors, configuration errors, and audit events; verify raw provider stderr and resolved values cannot appear in audit or error snapshots.
- [x] 4.3 Replace inherited child stdio forwarding with a streaming exact-value redactor for captured output, including chunk-boundary handling; verify stdout, stderr, and non-zero child exits preserve status while removing runtime-generated sentinel values.
- [x] 4.4 Preserve public-client generation as an explicit exception and keep non-public values out of diagnostics; verify generated `NEXT_PUBLIC_`, `VITE_`, and `EXPO_PUBLIC_` fixtures remain available while secret diagnostics stay value-free.

## 5. One-shot visual editing

- [x] 5.1 Implement `edit --profile` and `edit --source` command parsing plus a loopback-only, expiring one-shot editor session; verify the CLI response contains no values and unknown targets do not create a listener.
- [x] 5.2 Build the value-free merged profile view with key name, source, precedence, configured state, and conflict state; verify explicit overrides and unresolved collisions render correctly without a value or prefix.
- [x] 5.3 Route Infisical and Doppler editing to their provider-owned editing experiences; verify source routing opens the expected target metadata without copying values between providers.
- [x] 5.4 Implement interactive editing constrained to selected local dotenv, dotenvx, and macOS Keychain sources; verify a saved runtime-generated value changes only the selected temporary source and CLI/audit output remains value-free.
- [x] 5.5 Add editor session security checks for loopback binding, one-time session expiry, and no-value terminal/audit output; verify automated coverage plus a documented macOS browser smoke test.

## 6. Skill, documentation, and consumer migration

- [x] 6.1 Add value-free Skill generation or maintained workflow text that instructs Agents to use `mx-env edit --profile` and never solicit, print, or paste secret values; verify generated text contains no resolved values or prefixes.
- [x] 6.2 Update `README.md` with profiles, source precedence, provider bootstrap rules, `mx-env`, edit workflow, context-hygiene limits, and a Doppler comparison; verify all documented commands match CLI help.
- [x] 6.3 Update root package and getting-started references to show the long-command compatibility path and the new short command; verify stale priority and old config-shape claims are removed or explicitly marked legacy.
- [ ] 6.4 Create opt-in profile migrations for API, web, and app-shell on their respective submodule branches; verify each migrated application preserves dev, build/start, and public-env behavior before changing its root submodule pointer.
- [x] 6.5 Package the maintained Agent Skill inside the CLI itself so agents can bootstrap from npm (`npx morphix-env skill install [--target global|project|trellis]`); verify the template ships in `dist/SKILL.md`, installs are idempotent with no-clobber/`--force` semantics, `skill show` reports per-target drift, README/package description document it, and the full suite passes. (0.7.0-beta.1)

## 7. Integration, release, and rollback verification

- [x] 7.1 Run the full `packages/morphix-env` test suite and production build, including all provider-contract, composition, redaction, and editor-session tests; verify both succeed on supported macOS development tooling.
- [x] 7.2 Verify legacy and profile commands against disposable local fixtures plus each available Morphix consumer configuration without displaying secret values; record the commands and value-free outcomes in the change verification notes.
- [x] 7.3 Prepare a package release with semver-compatible dual-bin support and migration notes; verify consumers can roll back by pinning the prior package version or removing `--profile` while provider values remain unchanged. (Published 0.6.0-beta.1/beta.2 then stable 0.6.0 to npm `latest` via tag-driven Release workflow; dual bin `mx-env`/`morphix-env`; global-install smoke verified in ~/www/mx-env-demo; rollback = pin `morphix-env@0.5.0`.)
- [x] 7.4 After package release and consumer verification, commit the package submodule change on its package branch and update root submodule pointers through the normal review workflow; verify `git submodule status` records only intended pointers. (morphix-env main @ d6cdacc released; root pointer bump + this change dir committed to root main.)
