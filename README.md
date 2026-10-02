<p align="center">

[本仓文档入口](./docs/README.md) · [本地工程约定](./docs/engineering.md)
  <img src="docs/logo.png" width="160" alt="morphix-env" />
</p>

# morphix-env

A secret composition CLI for local development, CI, and agent-assisted workflows. It is not another vault: Infisical, Doppler, macOS Keychain, dotenvx, and local files keep owning their values — `mx-env` composes the sources a profile selects into one short-lived child-process environment and keeps inspection, audit, and editor output free of secret values.

## Quick start

**With an Agent (recommended):** install the packaged skill, commit it, and let the agent do the rest. The skill carries the safety rules, the full configuration schema, onboarding steps, and troubleshooting — so this README does not have to:

```bash
npx morphix-env@latest skill install --target project   # writes .claude/skills/morphix-env/ — commit it with the repo
```

Then tell your agent something like "set up this project's environment with mx-env". The agent reads the skill and drives configuration, validation, and editing; nobody pastes a secret value into chat.

**Without an Agent:**

```bash
npm install -g morphix-env
mx-env run -- pnpm dev      # compose the project profile and run
mx-env inspect              # key names, sources, status — never values
```

Optionally create `~/.mx-env/.env` (chmod 600) for personal machine-wide defaults; they join every run at low precedence unless `--no-global`.

## How it works

A profile lists sources from low to high; the composed environment follows a fixed baseline:

```text
inherited process.env
→ ~/.mx-env/.env
→ global default profile
→ project profile (or legacy Infisical config)
→ explicit -f override file
```

The same key from two sources fails by default; the later source must declare `"override": true` to replace the earlier value. Configuration never contains values — only wiring:

```jsonc
// project/mx-env.config.json
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

Providers: `infisical` · `doppler` · `os-keychain` (macOS) · `dotenvx` (encrypted files) · `local` (dotenv files). Provider login and bootstrap stay on the provider side (`infisical login`, `doppler login`, dotenvx key bootstrap) and never enter repository config.

## Compared with existing secret management

`morphix-env` is a composition layer, not a fifth vault:

| | dotenv / direnv | dotenvx | Infisical / Doppler CLI | 1Password CLI / Vault | morphix-env |
|---|---|---|---|---|---|
| Values live in | plaintext local files | encrypted local files | provider cloud | the vault | **nowhere new** — every system above stays the value owner |
| Composing multiple sources | ✗ | ✗ | own product only | own product only | ✓ one profile mixes any of them, plus a global baseline |
| Same-key collision | silently shadowed | silently shadowed | n/a | n/a | hard error unless an explicit `"override": true` |
| Agent context hygiene | `cat .env` leaks | partial | `secrets --plain` leaks | `op read` leaks | inspect / audit / editor are value-free; `run` redacts injected values from child output |

Choosing between Infisical and Doppler still depends on each provider's own identity, audit, rotation, and pricing — `morphix-env` does not replace that decision. It composes whichever you already use (or several, plus local sources) behind one stable `mx-env run --profile` interface.

## Value safety

- `mx-env inspect` reports key names, source provenance, and configured state only.
- `mx-env edit --profile <name>` opens a short-lived, loopback-only browser editor: remote sources route to their provider-owned UI, Keychain never reveals existing values, and on macOS the one-time editor URL is not printed to the terminal unless `--print-editor-url`.
- `mx-env run` is the only injection path. Exact injected values are redacted from forwarded child output, including across stream chunks; browser-public prefixes (`NEXT_PUBLIC_`, `VITE_`, `EXPO_PUBLIC_`) are a deliberate exception.
- Audit events carry profile/source/key names, outcome, and exit code — never values, command arguments, or provider stderr.

This is leakage minimization, not a cryptographic boundary: a process that receives a secret can still transform or exfiltrate it deliberately. For a high-risk agent capability, use a provider proxy/broker as a separate security design rather than passing that credential through `run`.

## Commands

```bash
mx-env run --profile dev -- <command>   # compose and run (the only injection path)
mx-env inspect [--profile dev]          # key names + provenance, no values
mx-env edit [--profile dev | --source s] # one-shot visual editor
mx-env generate --out public/__env.js   # public browser runtime config
mx-env doc                              # write this project's key→source skill
mx-env skill install | show             # packaged Agent Skill (global / project / trellis)
mx-env audit tail                       # value-free audit events
```

Full options live in `mx-env --help`; the packaged skill mirrors the commands of the installed version.

## Agent workflow

The npm package ships a maintained, value-free Agent Skill (`dist/SKILL.md`) so agents adopt the whole workflow — safety red lines, the complete schema for all five providers, a command cheatsheet, project onboarding, troubleshooting — without a second distribution:

```bash
mx-env skill install --target project   # <repo>/.claude/skills/morphix-env/ — commit it with the repo
mx-env skill install --target global    # ~/.claude/skills/morphix-env/ — every project on this machine
mx-env skill install --target trellis   # ~/.trellis/skills/morphix-env/ — then `trellis sync skills`
```

Installs are idempotent, and a skill file the user has customized is never overwritten without `--force`. `mx-env skill show` reports each target's install state and template drift.

For project-specific guidance, `mx-env doc --profile <name>` generates a value-free skill listing this project's resolved key names and their winning sources (`.agents/skills/morphix-env/SKILL.md`).

## Legacy configuration

Existing `infisical` + `envFiles` config keeps working unchanged. Migrate to `sources` / `profiles` when a project needs named profiles, multiple providers, or a source editable through the unified entry point.

## License

MIT
