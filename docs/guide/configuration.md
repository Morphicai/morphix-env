# Configuration reference

mxenv loads two configuration layers and never stores values in either:

| Layer | File | Purpose |
|---|---|---|
| Global | `~/.mxenv/config.json` | machine-wide sources, default profile, shims |
| Project | `mxenv.config.json` (repo root, resolved from cwd) | per-project sources, profiles, default profile |

Both share the same schema. The global layer can be excluded per run with `--no-global`.

```jsonc
{
  "sources": { ... },        // named source declarations (wiring only, never values)
  "profiles": { ... },       // named compositions of sources
  "defaultProfile": "dev",   // used when no --profile is given
  "shims": ["node", "pnpm"]  // terminal shim declarations (see [Commands](./commands.md#shell-init))
}
```

## sources

Each entry maps a name to a provider declaration. The name is how profiles reference the source, and how `inspect`, `audit`, and the editor identify it.

| Provider | Fields | Notes |
|---|---|---|
| `infisical` | `paths[]` (required) · `projectId?` · `siteUrl?` · `env?` · `envPrefix?` | auth comes from the Infisical side (see [Providers](./providers.md#infisical)) |
| `doppler` | `project` · `config` · `envPrefix?` | auth via `doppler login` |
| `dotenvx` | `files[]` | encrypted dotenv files; decryption keys via `.env.keys` |
| `os-keychain` | `service` (default `mxenv:<source>`) | macOS only; values under the named keychain service |
| `local` | `files[]` | plaintext dotenv — **development only**; migrate to dotenvx/keychain for storage |
| `plugin` | `plugin` · `keys[]` | external provider executable `mxenv-provider-<plugin>` |

Two booleans apply to every source:

- `"optional": true` — a missing/unavailable source composes as `missing-optional` (shown in `inspect`) instead of failing the run.
- `"override": true` — this source may replace keys that earlier sources already provided. Without it, a same-key collision **fails the run**.

### envPrefix (Infisical / Doppler)

Provider values keep their canonical names; `envPrefix` renames on compose so one Infisical entry serves a backend, a Next.js frontend (`NEXT_PUBLIC_`), and a Vite app (`VITE_`) without duplication:

```jsonc
{ "provider": "infisical", "paths": ["/frontend"], "envPrefix": "NEXT_PUBLIC_" }
```

## profiles

```jsonc
{
  "profiles": {
    "dev": { "sources": ["keychain", "infisical", "local"] },
    "ci":  { "sources": ["doppler"] },
    "full": { "extends": "dev", "sources": ["extra"] }
  },
  "defaultProfile": "dev"
}
```

- `sources` stack **low → high**; later sources win only with `"override": true`.
- `extends` pulls in another profile's sources first (circular chains are rejected).
- `defaultProfile` applies when no `--profile` is given. Without any project or global default, mxenv composes the implicit **legacy** path (global baseline + legacy `infisical`/`envFiles` config) so pre-sources projects keep working unchanged.

## Precedence

The composed environment follows a fixed baseline:

```text
inherited process.env
→ ~/.mxenv/.env           (implicit personal baseline; optional)
→ global default profile  (only when no project profile is selected)
→ project profile         (or legacy configuration)
→ --env-file override     (explicit, repeatable)
```

- The global baseline file is always stacked at the bottom of the profile stack; selecting a project/explicit profile replaces the *global default profile* stage, not the baseline. Pull global sources in deliberately via `extends`.
- The implicit baseline file is loaded through the dotenvx provider automatically when it has been encrypted in place — no config change involved.
- Collisions inside the stack are hard errors; `"override": true` on the later source is the explicit escape hatch.
- `--env-file` (-f, repeatable) appends a final local override source with override semantics.

## Environment selection for Infisical

An Infisical source with no environment specified **fails closed** with an actionable error — it never silently composes `prod`. Specify the environment in one of four ways, in increasing precedence:

1. `--env` / `-e` on the command
2. `INFISICAL_ENV` environment variable
3. `DEPLOY_ENV` environment variable
4. `"env": "dev"` on the source declaration (pins it in config)

Unpinned-but-saved runs are visible, not silent: composed commands (`run`/`export`/`render`/`inject`/`generate`) warn once on stderr when a source had no `env` pin but this run was saved by a flag or variable — later invocations without it fail closed. `inspect` annotates each Infisical source line with its resolution state (`[env: dev (pinned)]` vs `[env: dev (via --env, unpinned)]`), and `mxenv doctor` surfaces pinning as findings.

## Legacy configuration

Projects configured before named profiles — a top-level `infisical` block and `envFiles` — keep working unchanged and can also pin `"env"` on the legacy block. Migrate to `sources` / `profiles` when a project needs named profiles, multiple providers, or unified editing.

## Old-name compatibility (0.12.x → now)

- Only `mxenv.config.json` is read; a found `mx-env.config.json` is never read — a rename hint is printed instead.
- `~/.mx-env/` still reads until you run `mxenv migrate --home` (see [Commands → migrate --home](./commands.md#migrate---home)).
- `mx-env://profile/KEY` references are rejected with a rename hint.
- Keychain services named `mx-env:<source>` keep working — the name is carried in config, nothing to migrate.
