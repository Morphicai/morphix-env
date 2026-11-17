# mxenv documentation

mxenv composes the secret sources you already use into short-lived environments for processes and agents. Providers keep owning their values; repository configuration contains wiring, never values.

<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/mxenv-lockup-dark.svg" />
    <img src="./assets/mxenv-lockup.svg" width="460" alt="mxenv — secret composition for processes and agents" />
  </picture>
</div>

Start with the **[Getting started guide](./guide/getting-started.md)**.

## User guide (`guide/`)

| | |
|---|---|
| [Getting started](./guide/getting-started.md) | install paths, first composed run, the editor, shims |
| [Configuration reference](./guide/configuration.md) | sources, profiles, precedence, legacy compatibility |
| [Providers](./guide/providers.md) | Infisical, Doppler, dotenvx, Keychain, local, plugin protocol |
| [Command reference](./guide/commands.md) | every command and flag, verified against the CLI |
| [Security model](./guide/security.md) | redaction rules, `run --serve`, value reveal, honest boundaries |
| [Recipes](./guide/recipes.md) | CI, Docker/PaaS, monorepo, agents, MCP injection, rotation |

## How it fits together

The three posters embedded across the guide tell the product story in one image each. Editable SVG sources plus brand tokens live in [`assets/`](./assets/README.md):

| Poster | Used in | Story |
|---|---|---|
| [`secret-flow`](./assets/secret-flow.svg) | [Getting started](./guide/getting-started.md) | provider ownership → composition → controlled consumption → names-only model context |
| [`agent-boundary`](./assets/agent-boundary.svg) | [Security model](./guide/security.md) | `run --serve` capability flow: endpoint + token to the child, one value at a time |
| [`migration`](./assets/migration.svg) | [Recipes](./guide/recipes.md) | verified plaintext retirement: backup → encrypt → verify → switch |

## Contracts and tasks

- [Stable specs](../openspec/specs/) · [active changes](../openspec/changes/) · [archive](../openspec/changes/archive/)

## Source-side documents

- [Promotional narrative](../blog/env-management-best-practices.md) — the public-facing story and its promise list (Chinese today; English edition ships with the launch)
- [UX & architecture upgrade plan](./ux-architecture.md) — internal planning basis (Chinese)
- [Engineering & documentation conventions](./engineering.md) — read this before contributing

## History

The [archive index](./archive/README.md) preserves process documents and completed evidence; their commands/versions/TODOs do not describe the current implementation.
