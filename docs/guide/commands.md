# Command reference

Project commands come from `@morphixai/mxenv` (project devDependency or global). Machine-level commands come from `@morphixai/mxenv-cli` (global). Full options: `mxenv --help`.

## Composition and consumption

### `mxenv run [--flags] -- <command>`

Compose the selected profile and run `<command>` in it. **The only injection path.** Injected values are redacted from the child's forwarded stdout/stderr, including across stream chunks; browser-public prefixes (`NEXT_PUBLIC_`, `VITE_`, `EXPO_PUBLIC_`) are exempt; values of 1–2 characters stay out of the redaction set, 3–4 character values redact with a high-collision warning on stderr.

| Flag | Effect |
|---|---|
| `-p`, `--profile <name>` | select a profile (default: project `defaultProfile`, else global default, else legacy path) |
| `-f`, `--env-file <path>` | append a final override file (repeatable) |
| `-e`, `--env <name>` | Infisical environment for this run |
| `--no-global` | exclude the global layer and `~/.mxenv/.env` baseline — reproducible project-only runs |
| `--no-infisical` | skip Infisical sources for this run |
| `--allow-insecure-global` | permit a plaintext `~/.mxenv/.env` baseline (it is rejected otherwise) |
| `--serve` | serve values over loopback instead of injecting them — see [Security → run --serve](./security.md#on-demand-values-run---serve) |
| `--warn-plaintext` | force the plaintext-baseline warning |
| `-v`, `--verbose` | per-source status in output |
| `--dry-run` | print resolved key/variable names only, never values |

Exit code is the child's exit code. Audit records `via: "cli"` (or `"shim"`).

### `mxenv fetch <KEY>`

Read one value from a `run --serve` child environment. Reads `MXENV_ENDPOINT` / `MXENV_TOKEN` from its own environment and prints the exact value with no trailing newline. The endpoint must be loopback — the token never leaves the machine. `401` without a valid token, `404` for unknown keys; nothing is logged.

### `mxenv export [--profile <name>] [--dry-run]`

Print the composed environment as eval-able `export KEY='value'` lines. Consume via `eval "$(mxenv export --profile dev)"` — values pass through stdout into eval, never into shell history.

### `mxenv render <template> <output> [--dry-run]`

Expand `${VAR}` placeholders from the composed environment into `<output>` (mode 0600). Warns about unresolved placeholders and non-git-ignored output paths before writing.

### `mxenv inject <template> <output> [--dry-run]`

Resolve `mxenv://profile/KEY` references into `<output>` (mode 0600) — the way MCP configs and dotenv templates stay in git without values. `run` / `export` / `render` / `generate` also resolve references found inside composed values. There is no escaping: any value containing the pattern is treated as a reference.

### `mxenv generate --out <file>`

Generate a browser runtime config from browser-public keys (`NEXT_PUBLIC_`, `VITE_`, `EXPO_PUBLIC_`).

### `mxenv inspect [--profile <name>] [-v]`

Key names, source provenance, availability status — **never values**. The Agent-facing state surface. Skipped sources are shown with a value-free reason.

### `mxenv audit [tail]`

Value-free audit journal: profile/source/key names, outcome, exit code, `via` channel (`cli` / `shim` / `host`), and the config path in effect. Never values, arguments, or provider stderr.

## Value maintenance

### `mxenv edit [--profile <name>] [--source <name>] [--print-editor-url]`

Session-based local visual editor. Loopback + random token in the URL path + 15-minute TTL; session survives individual saves and ends via an explicit action or TTL. Browse key names per source, reveal stored values one key at a time (dotenvx and Keychain sources), add/edit/delete keys, switch sources. Remote sources route to their provider-owned UI. On macOS the browser opens automatically and the URL is not printed unless `--print-editor-url`.

### `mxenv migrate [--to dotenvx|keychain] [--source <name>] [--service <name>] [--dry-run]`

Move plaintext `local` sources into encrypted storage. No `--to`: read-only plan (units, files, key names — never values). With `--to`: 0600 backup per file → encrypt → **value-level equivalence verification** → config rewrite → plaintext removal; any failure restores from backup. Scope: the global `~/.mxenv/.env` (dotenvx target only) plus every declared `local` source; legacy `.env.local`/`envFiles` are reported as hints — declare them as sources first. Two sources sharing one file are refused. Keychain target is macOS-only and takes an optional `--service` override (requires `--source`).

### `mxenv migrate --home`

One-time global directory migration `~/.mx-env` → `~/.mxenv`: copy → value-level equivalence verification → timestamped backup rename (`~/.mx-env.backup-<timestamp>`) → shim PATH rc-block rewiring. Idempotent; refuses to overwrite an existing `~/.mxenv` holding real data (auto-created scaffolding is folded in); interrupted runs self-heal on the next invocation. Value-free output throughout.

## Skills and docs

### `mxenv skill install --target global|project|trellis|hermes [--force] [--hermes-category <cat>]`

Install the packaged, value-free Agent Skill. Targets: `project` → `<repo>/.claude/skills/mxenv/`, `global` → `~/.claude/skills/mxenv/`, `trellis` → `~/.trellis/skills/mxenv/` (then `trellis sync skills`), `hermes` → `~/.hermes/skills/<category>/mxenv/` (default category `devops`). Idempotent; a customized skill file is never overwritten without `--force`. Preferred install remains `npx skills add Morphicai/morphix-env`.

### `mxenv skill show`

Report each target's install state and template drift.

### `mxenv doc [--profile <name>]`

Generate a value-free project skill (`.agents/skills/mxenv/SKILL.md`) listing this project's resolved key names and their winning sources — the per-project cheat sheet for agents.

## Global face (`@morphixai/mxenv-cli`)

### `mxenv-cli shell-init [--write] [--remove]`

Generate PATH shims for commands declared under `shims` in either config layer (union of both). Bare invocations become exactly `mxenv run -- <command>`: same composition, same redaction, same exit code; `run` removes the shims directory from the child's PATH before composing, so injection never recurses. `--write` maintains a marked rc block in `~/.zshrc` / `~/.bashrc`; `--remove` removes shims and the rc block. Idempotent; invalid names fail loudly here but only warn in composition paths.

**Boundary.** Shims buy convenience, not concealment — injected values live in the child's environment. When the consumer is an agent you do not trust with the values, use `run --serve`.

### `mxenv gui [status|close]`

Panel-host session: a machine-level keys view and safe single-key reveal. Loopback server, 4-hour session TTL, 30-minute idle auto-close; repeat invocations attach idempotently; `status` reports run state / port / lock state; `close` shuts the session down. Default locked — names-only until an explicit human unlock (15-minute window, 5-minute idle auto-lock). `/reveal` and `/unlock` accept only human-driven panel sessions; agents and scripts are confined to the names-only surface. Token lives in `~/.mxenv/host/runtime.json` (0600, created and cleared with the session).

`gui` / `global` / `host` are reserved for upcoming machine-level faces and currently rejected with guidance.
