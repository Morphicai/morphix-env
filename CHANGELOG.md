# Changelog

## 0.10.0

### Added

- **`mx-env migrate`** (issue #7): move plaintext `local` storage into encrypted storage — dotenvx encrypted files or the macOS Keychain. Bare `migrate` prints a read-only plan (units, files, key names — never values); `--to dotenvx|keychain` executes per unit with a 0600 backup, a value-level equivalence check (decrypt/keychain read-back vs plaintext snapshot), config rewrite, and automatic restore on failure. Scope: the global `~/.mx-env/.env` (dotenvx only — composition sniffs the encryption markers, no config change needed) plus declared `local` sources in global/project configs; legacy files are reported as hints. Migrations are recorded in the value-free audit (`profile: migrate`). Keychain verification is a subset check (unrelated accounts in the target service only warn), and a rollback writes overwritten same-named accounts back to their previous values — never a silent data loss.
- **Plaintext dev-only marking**: `mx-env inspect` appends `[plaintext, dev-only]` to `local` sources; `--warn-plaintext` (or `MXENV_WARN_PLAINTEXT=1`, for shimmed invocations) adds a once-per-process stderr reminder on composition paths pointing at `mx-env migrate`.

### Changed

- **dotenvx sources are file-value-wins** (`dotenvx run --overload`): a same-named variable already exported in the parent environment no longer shadows the file value. This aligns dotenvx with `local` semantics — migration now provably preserves what your commands see.
- dotenvx migrations pin the file model (`--no-native`): the private key lands in a 0600 `.env.keys` beside the file instead of the OS keychain, keeping the result portable and CI-friendly. An unignored `.env.keys` inside a git repo earns a warning.
- The implicit global dotenvx path (migrated `~/.mx-env/.env`) gates `.env.keys` at 0600, the same rule the plaintext file had (`--allow-insecure-global` waives; win32 exempt).

## 0.9.0

### Added

- **Terminal shims** (`mx-env shell-init [--write|--remove]`): declare `"shims": ["node", "pnpm"]` in the global and/or project config (unioned, case-insensitively deduplicated) and run declared commands bare — a PATH shim makes `pnpm dev` exactly `mx-env run -- pnpm dev`. `run` sanitizes the shims directory out of the child PATH before composing (provider subprocesses included), so injection happens exactly once with no recursion. Shim invocations are recorded in audit with `via: "shim"`. macOS/Linux. (#10)

## 0.8.0

### Added

- **Public SDK facade** (`src/index.ts`, package `exports`): `composeEnvironment`, `loadConfigLayers` / `validateConfig`, and `StreamingRedactor` are now importable as a library. The CLI entry and process-mutating legacy helpers are deliberately not re-exported. Intended for embedders such as Trellis and app build scripts. (#5)
- **`mx-env export` / `mx-env render`**: `export` prints the composed environment as eval-able shell statements; `render` expands `${VAR}` placeholders in a template into a private (0600) output file. (#5)
- **`mx-env://` references + `mx-env inject`**: a `mx-env://<profile>/<KEY>` reference syntax lets wiring-only config point at composed keys; `inject` materializes a template's references into a private output file, and `run`/`export`/`render`/`generate` resolve references found inside composed values. (#5)
- **`mx-env run --serve`** (modeled on aws-vault `--ecs-server`): starts a loopback HTTP server on 127.0.0.1 at a random port, sharing the child's lifetime. Composed non-public values never enter the child environment; the child receives only `MXENV_ENDPOINT` + a random `MXENV_TOKEN` (redacted like any injected value) and fetches values on demand via `mx-env fetch <KEY>` or `GET /key/<KEY>` with a Bearer token. The server is destroyed when the child exits. (#6)
- **Provider plugin protocol** (summon-style): any PATH executable named `mx-env-provider-<name>` is a provider, invoked once per declared key with the value on stdout. New remote stores (1Password, Bitwarden, Vault, …) need no changes to built-in provider code. (#6)

### Notes

- Browser-public prefixes (`NEXT_PUBLIC_`, `VITE_`, `EXPO_PUBLIC_`) stay in the child environment under `--serve` so build tools can inline them.
- Honest limitation: an environment-delivered `MXENV_TOKEN` is readable by same-uid processes via the child's `/proc/<pid>/environ` (same as aws-vault `--ecs-server`); composed values themselves appear in no process environment.

## 0.7.1 and earlier

See [GitHub Releases](https://github.com/Morphicai/morphix-env/releases).
