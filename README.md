<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/mxenv-lockup-dark.svg" />
    <img src="docs/assets/mxenv-lockup.svg" width="460" alt="mxenv — secret composition for processes and agents" />
  </picture>

### Your secret managers, composed.

**mxenv** adopts the secret managers you already use — Infisical, Doppler, the OS keychain, dotenvx — composes them per profile, and keeps values out of every prompt.

[Quick start](#quick-start) · [How it works](#how-it-works) · [Security model](docs/guide/security.md) · [Full guide](docs/guide/getting-started.md)

[![CI](https://github.com/Morphicai/morphix-env/actions/workflows/ci.yml/badge.svg)](https://github.com/Morphicai/morphix-env/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40morphixai%2Fmxenv?label=npm)](https://www.npmjs.com/package/@morphixai/mxenv)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

</div>

## How it works

A profile selects sources low → high. mxenv loads them only when needed, fails closed on undeclared key collisions, and gives each consumer the narrowest useful surface.

<img src="docs/assets/secret-flow.svg" alt="Secret flow: providers retain ownership, mxenv composes a profile on your machine, and agents, processes and code consume values through controlled paths." width="100%" />

```text
inherited process.env
→ ~/.mxenv/.env           (personal baseline, optional)
→ global default profile  (optional)
→ project profile
→ --env-file override
```

- **No fifth vault** — repository configuration contains wiring, never values; custom stores plug in via `mxenv-provider-*` executables.
- **No silent shadowing** — the same key from two sources is a hard error unless the later source declares `"override": true`.
- **No secrets in the prompt** — inspection, skills, and audit expose key names and provenance only; `run` redacts injected values from forwarded child output.

## Quick start

**With an agent (recommended):**

```bash
npx skills add Morphicai/morphix-env
```

Then tell your agent: *"Set up this project's environment with mxenv."* It inspects and configures the project; nobody pastes a secret value into chat.

**Without an agent:**

```bash
npm install -D @morphixai/mxenv
npx mxenv inspect              # key names, sources, status — never values
npx mxenv doctor               # one-shot health check
npx mxenv run -- pnpm dev      # compose the project profile and run
```

**Untrusted consumers:** keep values out of every process environment and fetch them one at a time — `npx mxenv run --serve -- pnpm dev`, then `npx mxenv fetch KEY` inside the child. See the [security model](docs/guide/security.md).

## Compared

| | Values live in | Composes multiple sources | Same-key collision | Agent context hygiene |
|---|---|---|---|---|
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/dotenv-dark.svg" /><img src="docs/assets/brand/dotenv.svg" height="18" alt="dotenv" /></picture> dotenv / direnv | plaintext files | ✗ | silently shadowed | `cat .env` leaks |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/dotenvx.svg" /><img src="docs/assets/brand/dotenvx.svg" height="18" alt="dotenvx" /></picture> dotenvx | encrypted files | ✗ | silently shadowed | partial |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/infisical-dark.svg" /><img src="docs/assets/brand/infisical.svg" height="18" alt="Infisical" /></picture> <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/doppler.svg" /><img src="docs/assets/brand/doppler.svg" height="18" alt="Doppler" /></picture> Infisical / Doppler CLI | provider cloud | own product only | n/a | `--plain` leaks |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/onepassword-dark.svg" /><img src="docs/assets/brand/onepassword.svg" height="18" alt="1Password" /></picture> <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/vault-dark.svg" /><img src="docs/assets/brand/vault.svg" height="18" alt="Vault" /></picture> 1Password CLI / Vault | the vault | own product only | n/a | `op read` leaks |
| <img src="docs/assets/brand/mxenv.svg" height="18" alt="mxenv" /> **mxenv** | **nowhere new** | ✓ any mix + global baseline | hard error unless `override: true` | value-free surfaces; `run` redacts output |

## Documentation

| | |
|---|---|
| [Getting started](docs/guide/getting-started.md) | install paths, first composed run, the editor, shims, packages |
| [Configuration reference](docs/guide/configuration.md) | sources, profiles, precedence, legacy compatibility |
| [Providers](docs/guide/providers.md) | Infisical, Doppler, dotenvx, Keychain, local, plugin protocol |
| [Command reference](docs/guide/commands.md) | every command and flag |
| [Security model](docs/guide/security.md) | redaction rules, `run --serve`, value reveal, honest boundaries |
| [Recipes](docs/guide/recipes.md) | CI, Docker/PaaS, monorepo, agents, MCP injection, rotation |

Embedding or scripting on top of the engine? `npm i @morphixai/mxenv-core` — pure contracts at `@morphixai/mxenv-core/contracts`. This is leakage minimization, not a cryptographic boundary — the [security model](docs/guide/security.md#honest-boundaries) states the limits plainly.

## Known issues

- `npm install` currently reports high-severity advisories in transitive dependencies of `@infisical/sdk` (e.g. `zod`, `axios`); no fixed upstream release exists yet. They affect the provider client, not the composition engine's value handling.

## License

MIT — see [LICENSE](./LICENSE). Security reports: [SECURITY.md](./SECURITY.md).
