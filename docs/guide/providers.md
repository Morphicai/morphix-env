# Providers

mxenv composes six provider types. Login and key bootstrap always stay on the provider side — repository config carries wiring, never values or credentials.

| Provider | Values live in | Auth model | Best for |
|---|---|---|---|
| `infisical` | Infisical cloud/self-hosted | CLI session or Machine Identity | team secrets, rotation, per-env access |
| `doppler` | Doppler cloud | `doppler login` CLI session | team secrets in Doppler |
| `dotenvx` | encrypted local files | `.env.keys` beside the file | encrypted values that travel with the repo, CI-friendly |
| `os-keychain` | macOS Keychain service | keychain ACL | personal secrets on a Mac |
| `local` | plaintext dotenv files | none | development overrides only |
| `plugin` | anywhere (your executable decides) | inside the plugin | 1Password, Bitwarden, Vault, anything with a CLI |

Declare providers in `mxenv.config.json` — see the [Configuration reference](./configuration.md#sources) for fields.

## infisical

```jsonc
{ "provider": "infisical", "paths": ["/ai/api"], "projectId": "…", "env": "dev" }
```

**Local development** — authenticate once, then compose normally:

```bash
infisical login
npx mxenv run -- pnpm dev
```

**CI / Docker** — Machine Identity via environment variables; no CLI binary needed. mxenv auto-selects the SDK when `INFISICAL_CLIENT_ID` / `INFISICAL_CLIENT_SECRET` are present:

```bash
export INFISICAL_CLIENT_ID=…      # provider-side credential, not a project secret
export INFISICAL_CLIENT_SECRET=…
export INFISICAL_PROJECT_ID=…
npx mxenv run -- npm start
```

**Environment selection** — an Infisical source with no environment fails closed (it never silently composes `prod`). Set `-e/--env`, `INFISICAL_ENV`, `DEPLOY_ENV`, or pin `"env"` on the source. Details in [Configuration → Infisical environment](./configuration.md#environment-selection-for-infisical).

`--no-infisical` skips Infisical sources entirely for a run (useful for offline work); the skip is silent in output.

## doppler

```jsonc
{ "provider": "doppler", "project": "my-project", "config": "dev" }
```

Authenticate once with `doppler login`. mxenv reads through the Doppler CLI session; `envPrefix` renames values on compose for framework-specific prefixes.

## dotenvx

```jsonc
{ "provider": "dotenvx", "files": [".env.shared"] }
```

Values live in dotenvx-encrypted files; the decryption key lives in a `.env.keys` file beside them (0600). The encrypted `.env` itself is safe to commit — that is the dotenvx model. `mxenv migrate --to dotenvx` pins the file model (`--no-native`) so keys stay portable and CI-friendly instead of being custodied in the OS keychain.

Bootstrap keys onto a new machine out-of-band (password manager, provisioning script) — never through chat or the repository. An unignored `.env.keys` inside a git repo earns a loud warning from `migrate`.

## os-keychain

```jsonc
{ "provider": "os-keychain", "service": "com.example/myproject" }
```

Values live under the named Keychain service (default namespace `mxenv:<source>`). macOS only. First access triggers a keychain authorization prompt; legacy services named `mx-env:<source>` keep working — the name is carried in config. Requires the optional `keytar` native module.

## local

```jsonc
{ "provider": "local", "files": [".env.local"], "optional": true, "override": true }
```

Plaintext dotenv files — the classic mechanism, deliberately positioned as **development only**: file permissions do not protect values from a same-uid agent process. Common pattern: `local` sits last in a profile with `optional` + `override`, giving developers per-machine overrides over the team sources. Move long-lived values into encrypted storage with [`mxenv migrate`](./commands.md#migrate).

## plugin

Any executable on `PATH` named `mxenv-provider-<name>` is a provider — new remote stores need no changes to mxenv:

```jsonc
{ "provider": "plugin", "plugin": "bitwarden", "keys": ["OPENAI_API_KEY"] }
```

Protocol (summon-style):

- Invoked as `mxenv-provider-<plugin> <KEY>`, once per declared key; exit `0` with the value on stdout (one trailing newline stripped).
- Non-zero exit or missing executable fails the source with a **value-free** error — the plugin's stderr is never surfaced because it may contain sensitive material.
- Plugins intentionally inherit the already-composed environment at their precedence position (inherited env → global baseline → sources loaded so far), so a wrapper script can authenticate to its own backend without a second credential channel. Least-privilege consequence: a plugin can read every value composed **before** it — declare plugin sources after the sources they need, and keep each `keys` list minimal.
- Each key invocation times out after 30 seconds.

## Which provider where

- Team secrets with rotation and audit needs → **Infisical / Doppler** (their identity and permission systems stay authoritative).
- Personal secrets on a Mac → **os-keychain**.
- Encrypted values that must travel with the repo or into CI → **dotenvx**.
- Per-developer overrides during development → **local**, `optional` + `override`, last in the profile.
- Anything else with a CLI → **plugin**.
