# Changelog

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
