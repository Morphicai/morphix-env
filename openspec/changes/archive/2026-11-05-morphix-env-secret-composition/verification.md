# Verification notes

## Local package verification

Run from `packages/morphix-env`:

```bash
pnpm test
pnpm build
```

Observed 2026-09-26:

- 71 tests passed across legacy behavior, source composition, global dotenv discovery/permissions, source adapters, real dotenvx encrypted-file delivery, Keychain adapter contract, output redaction, audit, editor session, and generated Skill workflow.
- The production CJS build completed successfully.
- A manual macOS Keychain round trip using a generated temporary service/account completed successfully and deleted its temporary item in `finally`; no value was printed.

## Consumer legacy-config compatibility

The following commands intentionally used `--no-global --no-infisical --env-file /dev/null` so they exercised each real application config without loading `.env.local`, querying Infisical, or emitting any values:

```bash
cd apps/morphicai-api && node ../../dist/cli.js inspect --no-global --no-infisical --env-file /dev/null
cd apps/morphicai-web && node ../../dist/cli.js inspect --no-global --no-infisical --env-file /dev/null
cd apps/morphicai-app-shell-remix && node ../../dist/cli.js inspect --no-global --no-infisical --env-file /dev/null
```

All three reported the `legacy` profile, a skipped Infisical source, and a zero-key local source. No value or prefix was emitted.

## Global install + demo project matrix (2026-09-26)

After moving `keytar` to `optionalDependencies` with lazy `import("keytar")` and `--external keytar` in the tsup build, the packed `morphix-env-0.6.0.tgz` was installed globally (`npm i -g <tarball>`) on macOS / Node 22:

- Both bins (`mx-env`, `morphix-env`) resolved on PATH; `--help` listed the full v0.6.0 command set.
- The optional keytar native module built and loaded on this machine.

Disposable demo consumers (outside the monorepo, dummy values only):

- `~/www/mx-env-demo` — named-source profile config (`local` base/personal-override, conflict pair, `dotenvx` encrypted, `os-keychain` service `com.mx-env-demo`, plus `~/.mx-env/.env` global baseline at mode 0600). Verified:
  - default profile composition (global baseline → base → personal override; the override winner checked via boolean comparison, never printed);
  - `--no-global` removes the global baseline;
  - unset `defaultProfile` falls back to legacy behavior by design (documented; demo config sets `defaultProfile`);
  - conflicting keys fail closed with a non-zero exit and an actionable message;
  - `inspect` reports value-free provenance including override chains;
  - child stdout redaction masks every injected value (`[REDACTED]`), including a deliberate leak script;
  - `doc` generates a value-free `.agents/skills/morphix-env/SKILL.md`;
  - dotenvx source decrypts via `node_modules/.bin` discovery when run through an npm script;
  - os-keychain write → compose → read → delete round trip completed with zero remaining accounts.
- `~/www/mx-env-demo-legacy` — legacy `{infisical:{paths},envFiles}` config without Infisical login: run exits 0, the Infisical source reports `skipped`, local file plus global baseline still compose.

CI/release workflows were added under `.github/workflows/` (they activate once the branch is pushed): `ci.yml` (pnpm build + test on ubuntu × node 18/20/22 plus macos × node 22 for the real optional keytar build) and `release.yml` (workflow_dispatch or `v*` tag; builds, tests, publishes with `NPM_TOKEN`, auto `beta` dist-tag for prerelease versions, creates the GitHub Release).

## Deferred external checks

- Perform the README's opt-in Doppler smoke test only with a non-production Doppler project/config and an authorized operator session.
- ~~Before release, install the packed `morphix-env@0.6.0` tarball into a disposable consumer and invoke both package bins (`mx-env` and `morphix-env`).~~ Completed 2026-09-26 (see above).
- Migrate API, web, and app-shell to named profiles only after `0.6.0` is published; their current dependency range can then receive the release in a controlled submodule PR.
