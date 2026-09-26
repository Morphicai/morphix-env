<p align="center">
  <img src="docs/logo.png" width="160" alt="morphix-env" />
</p>

# morphix-env

`morphix-env` is a secret composition CLI for local development, CI, and agent-assisted workflows. It does not become another secret vault: Infisical, Doppler, macOS Keychain, dotenvx, and local files continue to own their values, authentication, access controls, rotation, and provider UI.

`morphix-env` assembles the sources chosen by a profile into one short-lived child-process environment, records value-free provenance, and keeps normal command output, inspection, audit records, and generated workflow guidance free of secret values.

The concise command is `mx-env`; the published `morphix-env` command remains fully supported.

The package also ships a maintained, value-free Agent Skill (`mx-env skill install`) so agents can adopt the whole workflow — safety rules, configuration schema, commands — without a second distribution; see [Agent workflow](#agent-workflow).

## Quick start: global local defaults

Create this file once:

```dotenv
# ~/.mx-env/.env
PERSONAL_API_URL=http://localhost:4444
```

Protect it on macOS/Linux:

```bash
mkdir -p ~/.mx-env
chmod 700 ~/.mx-env
chmod 600 ~/.mx-env/.env
```

Then every normal project command can use it without repeating configuration:

```bash
mx-env run -- pnpm dev
```

`~/.mx-env/.env` is deliberately the only automatically discovered value file. `~/.mx-env/config.json` is optional and adds global Keychain, encrypted-file, or remote-provider sources. For CI, investigation, or an unfamiliar repository, use a reproducible project-only run:

```bash
mx-env run --no-global -- pnpm dev
```

## Source precedence and conflicts

The composed environment has a fixed low-to-high order:

```text
inherited process.env
→ ~/.mx-env/.env
→ ~/.mx-env/config.json default profile
→ project profile or legacy project configuration
→ explicit CLI local override (-f)
```

Two sources that provide the same key fail by default. The later source must explicitly declare `"override": true` to replace the earlier value. This catches accidental cross-environment collisions instead of silently selecting a database, API, or deployment credential.

Existing projects remain compatible: a legacy `mx-env.config.json` still composes the configured Infisical paths followed by `.env.local`, so `.env.local` remains the deliberate override layer.

## Profiles and providers

Profiles compose complete source collections; do not enumerate every secret in repository configuration.

```jsonc
// ~/.mx-env/config.json — optional user baseline, never contains values
{
  "sources": {
    "machine-keychain": {
      "provider": "os-keychain",
      "platform": "macos",
      "service": "com.morphix.env/global"
    },
    "team-defaults": {
      "provider": "infisical",
      "paths": ["/shared"]
    }
  },
  "profiles": {
    "developer-default": {
      "sources": ["machine-keychain", "team-defaults"]
    }
  },
  "defaultProfile": "developer-default"
}
```

```jsonc
// project/mx-env.config.json
{
  "sources": {
    "api": {
      "provider": "infisical",
      "paths": ["/ai/api"]
    },
    "project-doppler": {
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
    "api-dev": {
      "extends": "developer-default",
      "sources": ["api", "project-doppler", "local"]
    }
  },
  "defaultProfile": "api-dev"
}
```

Run it with either CLI name:

```bash
mx-env run --profile api-dev -- pnpm dev
morphix-env run --profile api-dev -- pnpm dev
```

### Supported sources

| Provider | Source selector | Value ownership / bootstrap |
|---|---|---|
| `infisical` | `paths`, optional project/site/environment settings | Local: `infisical login`. CI: Machine Identity through the usual `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET`, and project identity flow. Do not put these in project config. |
| `doppler` | `project` and `config` | Local: `doppler login`. CI: a least-privilege Doppler Service Token supplied outside repository configuration, ideally via workload identity or the OS Keychain. |
| `os-keychain` | macOS generic-password `service`; each account is an environment key | macOS only in this release. Keychain owns the value; use `mx-env edit` to add/update it. |
| `dotenvx` | encrypted `files` | Install `dotenvx` separately and provide its private decryption key through a secure bootstrap path. The encrypted file stays provider-managed. |
| `local` | dotenv `files` | Intended for project `.env.local` and explicitly declared user files. A missing source is only allowed with `"optional": true`. |

### Doppler compared with Infisical

Both are strong team secret managers; `morphix-env` treats them as sources rather than attempting to reproduce their control planes.

| Concern | Infisical | Doppler | What `morphix-env` adds |
|---|---|---|---|
| Organization | projects, environments, folders/paths, identities | project, config, root/branch config inheritance | One profile can combine either or both with local sources. |
| Local execution | SDK Machine Identity or `infisical` CLI | `doppler login` + `doppler run` | One stable `mx-env run --profile` interface. |
| CI least privilege | Machine Identity scoped by project/path/role | Service Token scoped to project/config | Provider bootstrap stays outside config; profile decides only which source is requested. |
| Visual value editing | Provider dashboard | Provider dashboard | `mx-env edit` opens provider-owned routes instead of copying values into a new dashboard. |
| Local Keychain / global dotenv | Not their primary concern | Not their primary concern | `~/.mx-env` and `os-keychain` participate in the same explicit order. |

Choose a provider based on its own identity, audit, rotation, price, and hosting requirements. Provider switching is not assumed to be a one-line operation: source selectors and permissions remain provider-specific even though the consuming command remains stable.

For a manual Doppler smoke test, authenticate with `doppler login`, declare a non-production project/config source, and run `mx-env inspect --profile <profile>`. It must report the Doppler source and key names only. Use `mx-env run --profile <profile> -- <non-echoing command>` to validate delivery; do not use `doppler secrets get --plain` or print the child environment.

## Visual editor

Use the one-shot editor instead of asking someone to paste a value into chat:

```bash
mx-env edit --profile api-dev
mx-env edit --source machine-keychain
```

It starts a short-lived loopback-only browser session. The profile page shows names, source precedence, configured state, provenance, and collisions without values.

- Infisical and Doppler sources route the user to their provider-owned editor.
- Local dotenv files can be edited only in the selected local source.
- Keychain shows account names but never reveals existing values; it can add or update an account value.
- dotenvx writes through its CLI so it remains responsible for the encrypted representation.

The CLI prints status only, never a secret value.

On macOS the browser opens automatically and the default CLI output intentionally omits the one-time editor URL, so an Agent tool result does not receive a bearer-like local session capability. A human can explicitly request the URL when needed:

```bash
mx-env edit --profile api-dev --print-editor-url
```

On macOS, verify Keychain editing manually after installing a new version: use a temporary `os-keychain` service namespace, run `mx-env edit --source <name>`, add a generated test account in the browser, confirm it appears in the account-name list without revealing its value, then use **Delete** to remove it. The terminal transcript must contain only the editor URL/status.

## Context hygiene

```bash
mx-env inspect --profile api-dev
mx-env audit tail
```

`inspect` lists key names, source provenance, and configured state only. Audit events contain profile/source/key names, outcome, duration, and exit code—never a value, value prefix, command arguments, or provider stderr.

When child output is forwarded through the CLI, exact non-public injected values are redacted as `[REDACTED]`, including when the value crosses stream chunks or the command fails.

This is leakage minimization, not a cryptographic isolation boundary. A process that receives an environment variable can deliberately transform or exfiltrate it. For a high-risk Agent capability, use a provider proxy/broker as a separate security design rather than passing that credential through `run`.

Browser variables (`NEXT_PUBLIC_`, `VITE_`, `EXPO_PUBLIC_`) are an intentional exception: they are public configuration, not protected secrets.

## Commands

```bash
# Run one command with its composed profile
mx-env run --profile api-dev -- pnpm dev

# Existing scripts remain valid
morphix-env run --env dev -- pnpm dev

# Generate public browser runtime configuration
mx-env generate --profile api-dev --out public/__env.js

# Value-free status/provenance
mx-env inspect --profile api-dev

# Open the short-lived visual editor
mx-env edit --profile api-dev

# Generate this project's value-free Agent workflow Skill
mx-env doc --profile api-dev

# Install the packaged Agent Skill (global | project | trellis)
mx-env skill install --target project

# Show per-target install state and template drift
mx-env skill show

# Value-free audit events
mx-env audit tail
```

Options:

| Option | Meaning |
|---|---|
| `-p, --profile <name>` | Select a named profile. |
| `-f, --env-file <path>` | Append a local override source for this invocation. |
| `-e, --env <name>` | Override the Infisical environment for selected Infisical sources. |
| `--no-infisical` | Skip Infisical sources. |
| `--no-global` | Ignore `~/.mx-env/.env` and `~/.mx-env/config.json`. |
| `--allow-insecure-global` | Explicitly permit a global dotenv file readable by group/other users. Avoid this outside controlled troubleshooting. |
| `--print-editor-url` | Explicitly print the one-time local editor URL; normally the browser opens without emitting it to the terminal. |
| `--target <scope>` | `skill install` destination: `global` (`~/.claude/skills/`), `project` (`.claude/skills/` inside the repo — commit it), or `trellis` (`~/.trellis/skills/` canonical store). |
| `--force` | Replace an installed skill that differs from this version's template; a modified file is never overwritten without it. |
| `-o, --out <path>` / `--filter <prefix>` | Configure public browser-env generation. |
| `-v, --verbose` | Show source state and key counts, not values. |

## Agent workflow

### Packaged Agent Skill

The npm package ships a maintained, value-free Agent Skill at `dist/SKILL.md`. It teaches an agent the full workflow: safety red lines (inspect for validation, `edit` for changes, `run` as the only injection path), the complete `mx-env.config.json` schema for all five providers, a command cheatsheet, project onboarding steps, and troubleshooting. Because it travels with the CLI, it always documents commands that exist in the installed version.

```bash
# Agent bootstrap straight from npm — no global install required
npx morphix-env@latest skill install --target project

mx-env skill install --target project   # <repo>/.claude/skills/morphix-env/SKILL.md — commit it with the repository
mx-env skill install --target global    # ~/.claude/skills/morphix-env/SKILL.md — every project on this machine
mx-env skill install --target trellis   # ~/.trellis/skills/morphix-env/SKILL.md — then `trellis sync skills`
```

Installs are idempotent: a re-run against an unchanged template is a no-op, and a skill file the user has customized is never overwritten without `--force`. `mx-env skill show` reports each target's install state and whether it still matches the shipped template.

### Project workflow Skill

`mx-env doc --profile <profile>` writes a value-free workflow Skill to `.agents/skills/morphix-env/SKILL.md` by default, listing this project's resolved key names and their winning sources. Generated or maintained Skills contain this rule:

```md
When the user asks to add, modify, or rotate a credential:
1. Run `mx-env edit --profile <profile>` or `mx-env edit --source <source>`.
2. Let the user complete the edit in the local visual editor or provider UI.
3. Do not request the value in chat; do not run env, printenv, cat .env, or a reveal command.
4. Validate only configured status and provenance, never the value.
```

## Legacy configuration

This remains valid and needs no immediate migration:

```json
{
  "infisical": { "paths": ["/ai"], "envPrefix": "VITE_" },
  "envFiles": [".env.local"],
  "generate": { "out": "public/__env.js", "filter": "NEXT_PUBLIC_" }
}
```

Migrate when a project needs named profiles, multiple providers, or a source that can be edited through the unified local entry point.

## License

MIT
