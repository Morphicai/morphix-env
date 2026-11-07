<p align="center">

[本仓文档入口](./docs/README.md) · [本地工程约定](./docs/engineering.md)
  <img src="docs/logo.png" width="160" alt="mxenv" />
</p>

# mxenv

A secret composition CLI for local development, CI, and agent-assisted workflows. It is not another vault: Infisical, Doppler, macOS Keychain, dotenvx, and local files keep owning their values — `mxenv` composes the sources a profile selects into one short-lived child-process environment and keeps inspection, audit, and editor output free of secret values.

## Packages

The tool ships as three packages with strict layering (dependencies only point downward — see [UX 与架构升级](./docs/ux-architecture.md)):

| Package | Layer | Role | Install |
|---|---|---|---|
| `@morphixai/mxenv` | L2 run face | `run`/`export`/`inspect`/`render`/`inject`/`generate`, source management (custom upstreams), `edit`, `migrate`, skills | `npm i -D @morphixai/mxenv` in a project (or `npm i -g @morphixai/mxenv`) |
| `@morphixai/mxenv-cli` | L3 management face | machine-level extras: terminal shims (`shell-init`) today; global-key management and a local GUI next | `npm i -g @morphixai/mxenv-cli` |
| `@morphixai/mxenv-core` | L0/L1 shared layer | composition engine + pure contracts (`@morphixai/mxenv-core/contracts`) for SDK consumers (e.g. Trellis MCP) | `npm i @morphixai/mxenv-core` |

> 2026-11-07 注：npm 的名称相似度政策拒绝 unscoped `mxenv`（与 exenv/osenv 过近），包名走 `@morphixai/*` scope；目录名（`packages/mxenv*`）、bin 命令（`mxenv`/`mx-env`/`morphix-env`/`mxenv-cli`）、配置与 scheme 命名均不变。

A project-only install is fully functional; installing the global CLI only adds capabilities — it never changes project commands.

## Quick start

**With an Agent (recommended):** install the packaged skill, commit it, and let the agent do the rest. The skill carries the safety rules, the full configuration schema, onboarding steps, and troubleshooting — so this README does not have to:

```bash
npx @morphixai/mxenv@latest skill install --target project   # writes .claude/skills/mxenv/ — commit it with the repo
```

Then tell your agent something like "set up this project's environment with mxenv". The agent reads the skill and drives configuration, validation, and editing; nobody pastes a secret value into chat.

**Without an Agent:**

```bash
npm install -g @morphixai/mxenv
mxenv run -- pnpm dev      # compose the project profile and run
mxenv inspect              # key names, sources, status — never values
```

Optionally create `~/.mxenv/.env` (chmod 600) for personal machine-wide defaults; they join every run at low precedence unless `--no-global`.

## How it works

A profile lists sources from low to high; the composed environment follows a fixed baseline:

```text
inherited process.env
→ ~/.mxenv/.env
→ global default profile
→ project profile (or legacy Infisical config)
→ explicit -f override file
```

The same key from two sources fails by default; the later source must declare `"override": true` to replace the earlier value. The `~/.mxenv/.env` baseline is always stacked; when a project (or explicit) profile is selected it takes the profile stage on its own — the global default profile applies only when no project profile exists, and a profile can pull global sources in deliberately via `extends`. Configuration never contains values — only wiring:

```jsonc
// project/mxenv.config.json
{
  "sources": {
    "team":   { "provider": "infisical", "paths": ["/ai/api"] },
    "doppler": { "provider": "doppler", "project": "morphicai-api", "config": "dev" },
    "local":  { "provider": "local", "files": [".env.local"], "optional": true, "override": true }
  },
  "profiles": { "dev": { "sources": ["team", "doppler", "local"] } },
  "defaultProfile": "dev"
}
```

Providers: `infisical` · `doppler` · `os-keychain` (macOS) · `dotenvx` (encrypted files) · `local` (plaintext dotenv files — **development only**; move them to encrypted storage with `mxenv migrate`). Provider login and bootstrap stay on the provider side (`infisical login`, `doppler login`, dotenvx key bootstrap) and never enter repository config.

## Compared with existing secret management

`mxenv` is a composition layer, not a fifth vault:

| | dotenv / direnv | dotenvx | Infisical / Doppler CLI | 1Password CLI / Vault | mxenv |
|---|---|---|---|---|---|
| Values live in | plaintext local files | encrypted local files | provider cloud | the vault | **nowhere new** — every system above stays the value owner |
| Composing multiple sources | ✗ | ✗ | own product only | own product only | ✓ one profile mixes any of them, plus a global baseline |
| Same-key collision | silently shadowed | silently shadowed | n/a | n/a | hard error unless an explicit `"override": true` |
| Agent context hygiene | `cat .env` leaks | partial | `secrets --plain` leaks | `op read` leaks | inspect / audit / editor are value-free; `run` redacts injected values from child output |

Choosing between Infisical and Doppler still depends on each provider's own identity, audit, rotation, and pricing — `mxenv` does not replace that decision. It composes whichever you already use (or several, plus local sources) behind one stable `mxenv run --profile` interface.

## Value safety

- `mxenv inspect` reports key names, source provenance, and configured state only.
- `mxenv edit` opens a short-lived, loopback-only browser editor (optionally scoped with `--profile <name>` or `--source <name>`): browse existing key names per source, reveal stored values one key at a time on explicit request (dotenvx and Keychain; values stay in the browser session), edit/add/delete keys, and switch sources. The session survives individual saves for multi-step maintenance and ends via an explicit action or the 15-minute TTL. Remote sources route to their provider-owned UI, and on macOS the one-time editor URL is not printed to the terminal unless `--print-editor-url`.
- `mxenv run` is the only injection path. Exact injected values are redacted from forwarded child output, including across stream chunks; browser-public prefixes (`NEXT_PUBLIC_`, `VITE_`, `EXPO_PUBLIC_`) are a deliberate exception.
- Audit events carry profile/source/key names, outcome, and exit code — never values, command arguments, or provider stderr.

This is leakage minimization, not a cryptographic boundary: a process that receives a secret can still transform or exfiltrate it deliberately. For a high-risk agent capability, use a provider proxy/broker as a separate security design rather than passing that credential through `run`.

## On-demand secrets with `run --serve`

`mxenv run --serve -- <command>` (modeled on aws-vault's `--ecs-server`) starts a loopback HTTP server on 127.0.0.1 at a random port that shares the child's lifetime:

- Composed non-public values never enter the child environment — not the direct child, its descendants, `/proc/<pid>/environ`, or core dumps. The child receives only `MXENV_ENDPOINT` and a random `MXENV_TOKEN`, and the token is redacted from child output like any injected value. Honest caveat on token visibility: an environment-delivered capability token is readable by same-uid processes on Linux via the child's `/proc/<pid>/environ` — the same inherent property as aws-vault's `--ecs-server`; the *values* themselves still appear in no process environment anywhere.
- The child fetches one value at a time: `mxenv fetch <KEY>` (thin client that reads endpoint/token from its own environment and prints the exact value with no trailing newline), or a direct `GET /key/<KEY>` with `Authorization: Bearer $MXENV_TOKEN`. The endpoint answers 401 without the token and 404 for unknown keys; no request or value is ever logged.
- Browser-public keys (`NEXT_PUBLIC_`, `VITE_`, `EXPO_PUBLIC_`) stay in the environment so build tools can inline them; they remain servable as well.
- The server is destroyed the moment the child exits (and dies with the parent process itself), so no listener outlives the run.

`mxenv run` without `--serve` is unchanged: values are injected into the environment and redacted from forwarded output.

## Terminal shims

For commands you run constantly, shims remove the `mxenv run --` prefix entirely. Declare a command list and generate shims once (shims are a machine-level capability of the global CLI):

```jsonc
// ~/.mxenv/config.json (global) and/or mxenv.config.json (project)
{ "shims": ["node", "pnpm"] }
```

```bash
mxenv-cli shell-init          # generate shims in ~/.mxenv/shims, print the PATH line
mxenv-cli shell-init --write  # also maintain a marked block in ~/.zshrc / ~/.bashrc
mxenv-cli shell-init --remove # remove shims and the rc block
```

After the PATH line is active, typing `pnpm dev` is exactly `mxenv run -- pnpm dev`: same composition, same redaction, same exit code. Undeclared commands are untouched.

- The effective list is the union of the global and project lists. A shim is only an entry hook: **what gets injected is always decided by the configuration in effect where the command runs**, so one `pnpm` shim serves every project's own profile.
- `run` removes the shims directory from the child's PATH before composing, so a tool invoked again inside the run (or by a provider plugin mid-composition) resolves to the real binary — injection happens exactly once, never recursively.
- `shell-init` is idempotent: re-running converges the directory to the declared list, `--write`/`--remove` use marked rc blocks and never touch your other lines or handmade files.
- Command names are validated (bare names only; mxenv's own command names are reserved). Invalid entries fail `shell-init` loudly but only warn in composition paths — a convenience layer never breaks `run`.
- Audit events record `via: "shim"` vs `"cli"` so the two channels stay distinguishable.

**Boundary.** Shims buy convenience, not concealment: injected values live in the child's environment and are visible to same-uid processes. When the consumer is an agent you do not trust with the values, use `run --serve` instead. macOS/Linux only; Windows keeps the explicit `run` form. Do not place files in `~/.mxenv/shims` by hand.

## Retiring plaintext: `mxenv migrate`

Plaintext dotenv files are a development convenience, not a storage end-state — file permissions do not protect them from a same-uid agent process. `mxenv migrate` moves them into encrypted storage (dotenvx encrypted files, or the macOS Keychain) with a backup and a value-level equivalence check at every step:

```bash
mxenv migrate                                 # read-only plan: units, files, key names (never values)
mxenv migrate --to dotenvx                    # encrypt in place; declared sources flip to provider dotenvx
mxenv migrate --to keychain --source mysource # values move to service mxenv:mysource; plaintext is deleted
```

Scope: the global `~/.mxenv/.env` (dotenvx target only) plus every declared `local` source in the global and project configs. Legacy `.env.local`/`envFiles` are reported as hints — declare them as sources first. Two sources sharing one file are refused: split them first.

- Every unit gets a **0600 backup** (`<file>.mxenv-backup-<timestamp>`) and a **post-migration equivalence check** — decrypted or keychain-read-back values must match the plaintext snapshot exactly — before any config is rewritten. On failure the plaintext and config are restored from backup and the backup paths printed. Backups stay until you delete them yourself.
- dotenvx migrations pin the file model (`--no-native`): the private key lands in a 0600 `.env.keys` beside the file — portable and CI-friendly — instead of the OS keychain. An unignored `.env.keys` inside a git repo earns a loud warning; the encrypted `.env` itself is safe to commit (that is the dotenvx model).
- The global file needs no config change: composition sniffs the encryption markers and loads it through the dotenvx provider automatically, with the same 0600 gate on `.env.keys` the plaintext file had.
- Verification goes through `dotenvx decrypt`, never `run`, so a same-named shell export cannot shadow the check. At compose time, dotenvx sources are file-value-wins (`--overload`) — the same semantics `local` had, so migration does not change what your commands see.
- Migrations are recorded in the value-free audit (`profile: migrate`).

`--dry-run` with `--to` prints the full execution plan without writing. The keychain target is macOS-only and serves declared sources; the dotenvx target needs the dotenvx CLI (`npm i -g @dotenvx/dotenvx` or a project devDependency).

## Provider plugins

Any executable on PATH named `mxenv-provider-<name>` is a provider — new remote stores need no changes to `config.ts` / `sources.ts` / `editor.ts`:

```jsonc
// mxenv.config.json
{
  "sources": {
    "vault": { "provider": "plugin", "plugin": "bitwarden", "keys": ["OPENAI_API_KEY"] }
  }
}
```

Plugin protocol (summon-style):

- Invoked as `mxenv-provider-<plugin> <KEY>`, once per declared key; exit 0 with the value on stdout (one trailing line ending stripped).
- A non-zero exit or a missing executable fails the source with a value-free error — the plugin's stderr is never surfaced because it may contain sensitive material. `optional: true` downgrades a missing executable to `missing-optional`.
- Plugins intentionally inherit the already-composed environment at their precedence position (inherited env → global baseline → profile sources loaded so far), so wrapper scripts can authenticate to their own backend without a second credential channel. Least-privilege consequence: a plugin can read every value composed before it — declare plugin sources only after the sources they need and keep each `keys` list minimal. Each key invocation times out after 30s.
- Login and bootstrap stay inside the plugin; repository config carries only wiring (plugin name + key names), never values.

The five built-in providers (`infisical`, `doppler`, `os-keychain`, `dotenvx`, `local`) are unchanged.

## Commands

```bash
mxenv run --profile dev -- <command>   # compose and run (the only injection path)
mxenv run --serve -- <command>         # serve values over loopback instead of injecting them into env
mxenv fetch <KEY>                      # read one value from a run --serve child environment
mxenv export [--profile agents]        # eval-able export KEY='value' lines (values in stdout only for eval)
mxenv render <template> <output>       # substitute ${VAR} into a config file (mode 0600)
mxenv inject <template> <output>       # resolve mxenv://profile/KEY references into a file (mode 0600)
mxenv inspect [--profile dev]          # key names + provenance, no values
mxenv migrate [--to dotenvx|keychain]  # move plaintext local sources into encrypted storage
mxenv edit [--profile dev | --source s] # session-based local visual editor (stays open across saves)
mxenv generate --out public/__env.js   # public browser runtime config
mxenv doc                              # write this project's key→source skill
mxenv skill install | show             # packaged Agent Skill (global / project / trellis)
mxenv audit tail                       # value-free audit events
```

`export`, `render`, `inject`, and `run` accept `--dry-run` (key/variable names only, never values). `eval "$(mxenv export --profile agents)"` injects a profile into the current shell without putting values in shell history. `render` and `inject` write mode-0600 outputs, warn about unresolved `${VAR}` / `mxenv://` references before writing, and warn when the output path is not git-ignored. `mxenv://profile/KEY` references (mirroring 1Password's `op://`) let MCP configs and dotenv templates stay in git without values: `mxenv inject` resolves them at the file level, `mxenv run` resolves them inside composed values before spawning.

Full options live in `mxenv --help`; the packaged skill mirrors the commands of the installed version.

## Agent workflow

The npm package ships a maintained, value-free Agent Skill (`dist/SKILL.md`) so agents adopt the whole workflow — safety red lines, the complete schema for all five providers, a command cheatsheet, project onboarding, troubleshooting — without a second distribution:

```bash
mxenv skill install --target project   # <repo>/.claude/skills/mxenv/ — commit it with the repo
mxenv skill install --target global    # ~/.claude/skills/mxenv/ — every project on this machine
mxenv skill install --target trellis   # ~/.trellis/skills/mxenv/ — then `trellis sync skills`
```

Installs are idempotent, and a skill file the user has customized is never overwritten without `--force`. `mxenv skill show` reports each target's install state and template drift.

When the consumer is an agent, prefer `mxenv run --serve -- <command>`: values never enter any process environment, and the agent fetches them one at a time over loopback. Keep secrets in encrypted storage (`mxenv migrate`) and this forms the chain where an agent never touches plaintext — at rest or in env. (Once native keychain ACLs land, the keychain itself can additionally gate access behind Touch ID.)

For project-specific guidance, `mxenv doc --profile <name>` generates a value-free skill listing this project's resolved key names and their winning sources (`.agents/skills/mxenv/SKILL.md`).

## Legacy configuration

Existing `infisical` + `envFiles` config keeps working unchanged. Migrate to `sources` / `profiles` when a project needs named profiles, multiple providers, or a source editable through the unified entry point.

## Migrating from `morphix-env` / `mx-env`

0.12.x renames everything to the `mxenv` family in one breaking window:

| Old | New |
|---|---|
| `mx-env` / `morphix-env` (bin) | `mxenv` |
| `morphix-env` (npm) | `mxenv` (run face) · `mxenv-cli` (global) · `mxenv-core` (SDK) |
| `mx-env.config.json` | `mxenv.config.json` |
| `~/.mx-env/` | `~/.mxenv/` |
| `mx-env://profile/KEY` | `mxenv://profile/KEY` |
| `mx-env-provider-<name>` | `mxenv-provider-<name>` |
| keychain service `mx-env:<source>` | `mxenv:<source>` (existing services keep working — the name is carried in config) |
| `mx-env shell-init` | `mxenv-cli shell-init` |

Compatibility shims last one minor cycle (0.12.x) and warn on stderr: old bin names still run, `mx-env.config.json` / `~/.mx-env/` / `mx-env-provider-*` are still read when the new name is absent, and writes always use the new names. `mx-env://` references are rejected with a rename hint (no silent compatibility). Move the global store with `mxenv migrate --home`: copies the store, verifies value-level equivalence, then renames the old directory to `~/.mx-env.backup-<timestamp>` as the rollback backup — never prints values, idempotent, and refuses to overwrite an existing `~/.mxenv/`.

The npm package `morphix-env` ships one final release and is deprecated in favor of the three packages above; the repository rename follows separately.

Two migration caveats: **do not install `mxenv` and `mxenv-cli` globally side by side** — both register the `mxenv`/`mx-env`/`morphix-env` bin names and the later install silently takes over the symlinks (pick `mxenv-cli` for machine-level management, or `mxenv` as a project devDependency); and **the global CLI no longer ships project commands** — `run`/`export`/`inspect`/`migrate`/`edit` come from the project-facing `mxenv` package, so the 0.11 `mx-env run …`-from-global pattern becomes a project-local invocation.

## License

MIT — see [LICENSE](./LICENSE). Security reports: [SECURITY.md](./SECURITY.md).
