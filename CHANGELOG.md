# Changelog

## 0.14.0

### Added

- **`mxenv gui` — session-based panel host (Wave B first slice)**: one command into the visual management surface. `mxenv gui` starts a local host session (loopback random port, 4h TTL, 30-minute idle auto-close, explicit `mxenv gui close`) and opens the panel; repeat invocations attach idempotently — an `O_EXCL` start lock guarantees concurrent `mxenv gui` spawns exactly one session (stale sessions are detected via pid liveness and recovered). `mxenv gui status` reports run state / port / lock state. The session token lives in `~/.mxenv/host/runtime.json` (0600, created and cleared with the session).
- **Panel API resource model**: `GET /keys` (names-only key surface from local/dotenvx/os-keychain/plugin-declared keys, enumerated per `fileIndex` for multi-file sources), `POST /reveal` (per-key, `Cache-Control: no-store`), `POST /unlock` / `POST /lock`, `GET /status`, `POST /shutdown`. Contract types (`PanelKeyInfo`, `PanelRevealRequest`) are exported from mxenv-core as the B2 panel base.
- **Consumer boundary on value access**: panel reveal goes through `revealSingle` — the one implementation (per-key, one resident value per session slot, cleared on lock/expiry/close). `/reveal` and `/unlock` accept only human-driven panel sessions (the `X-Mxenv-Panel` marker); Agents and scripts are confined to the names-only surface — their reveal/unlock calls are rejected and audited.
- **Default lock + explicit unlock window**: locked state serves key names only; `POST /unlock` opens a bounded window (15 min default) validated against the wall clock on every request (survives sleep), with an idle auto-lock (5 min) that counts only explicit actions — panel polling never extends it.
- **Audit extensions (mxenv-core)**: `AuditEvent` gains `via: 'host'`, `action: 'start' | 'unlock' | 'lock'`, and `configPath` (the real config file path, or `'-'` when none exists — never a phantom path). Host sessions audit reveal/unlock/lock/auth-refusals/session start+stop value-free; names-only queries stay silent. run/edit audits now carry `configPath` too.
- **host-runtime (mxenv-core)**: `~/.mxenv/host/` (0700) runtime file read/write and `O_EXCL` start-lock primitives.

### Notes

- The host is L3 product logic built on L1 capabilities (no L2 imports). The panel UI (`mxenv-panel-ui`) and residency (launchd / unbounded TTL) are follow-up changes with zero contract churn.
- Honest boundary note: same-uid processes are not walled off — the guarantees are the consumer boundary, default lock, per-key narrow exposure and full audit, not process isolation.

## 0.13.1

### Removed (announced in 0.12.0 — the compat shims lasted one minor cycle)

- **BREAKING — legacy bin names `mx-env` / `morphix-env` are gone.** They are no longer installed or forwarded anywhere (including the deprecated `morphix-env` npm package, which is now a pure SDK facade without bins). Invoke `mxenv` only. **If any generated shims still delegate to `mx-env run`, re-run `mxenv-cli shell-init` to regenerate them** — old shims stop working now that nothing forwards the legacy name.
- **BREAKING — the `mx-env.config.json` read fallback is gone.** Only `mxenv.config.json` is read. When the old file is found alone, a rename hint is printed (it is never read or auto-renamed); double-file setups still warn about the stale copy.
- **BREAKING — the `mx-env-provider-<plugin>` resolution fallback is gone.** Plugin sources resolve `mxenv-provider-<plugin>` only and report it as missing otherwise.
- Stale `mx-env` / `morphix-env` symlinks left in a global bin directory by previous installs may linger after upgrading — remove them by hand; `mxenv` itself is unaffected.

### Kept on purpose

- `~/.mx-env/` directory reads remain until you run `mxenv migrate --home` (that window is tied to the migration, not to a version).
- Keychain services named `mx-env:<source>` keep working — the name is carried in config, so there is nothing to migrate.

## 0.13.0

### Added

- **`revealSingle` value capability (mxenv-core)**: the single-key reveal becomes a first-class L1 value capability — the one implementation behind every "show me this key's value" action (paired with `compose` as the value-capability duo). Discipline is built into the capability, not its callers: default locked state rejects reveal without an explicit authorization context; one resident value per slot (revealing a new key evicts the previous resident; short residence TTL; `revealResidenceRelease(slotId)` for explicit release); value-free `reveal` audit events on every request (success/locked/not-found/read-error, distinguished via the new optional `reason` field on `AuditEvent`); errors and audit records never contain values. Reveal reads the **stored source value** (outer-env same-name values never participate) and multi-file sources are scoped per file via `fileIndex`, mirroring `set`/`del`.
- `readStoredValue` / `readStoredValueFromSource` low-level single-key read primitives (the narrow-read foundation shared with future consumers).

### Changed

- The visual editor's value echo (dotenvx + keychain) now goes through `revealSingle` — the editor session token is the authorization context, reveal audits collapse to exactly one `reveal` event per request, and closing the editor releases the resident value. The editor no longer reads stored values on its own; `dotenvxReadValue` is retired. Interaction semantics are unchanged (still source stored values, still one resident value per page).

### Docs

- SKILL.md / README / docs/ux-architecture.md now state the `compose`/`revealSingle` value-capability duo and the value-exposure red lines.

## 0.12.4

### Added

- **`mxenv skill install --target hermes`**: installs the Agent Skill into the Hermes skill tree (`~/.hermes/skills/<category>/mxenv/`; default category `devops`, override with `--hermes-category <name>`). The Hermes agent discovers it through its skill index; `skill show` reports the install state like every other target.
- The skill source now lives at the repo root (`skills/mxenv/SKILL.md`) so the skills CLI can install it straight from GitHub: **`npx skills add Morphicai/morphix-env`** (preferred). The build copies the same file into `dist/` — one source, two distribution channels.

### Docs

- README and SKILL.md now lead with `npx skills add Morphicai/morphix-env`; `mxenv skill install` remains the explicit-target/offline channel (`project|global|trellis|hermes`).

## 0.12.3

### Fixed

- **0.8.0 发版 review 遗留清理**（issue #9）：`export` 直跑 TTY 时警告 scrollback 风险；渲染输出的 git 风险判定走上溯最近存在目录（未建子目录不再误判仓外，macOS 符号链接路径 realpath 对齐）；`render`/`inject` 拒写 symlink 目标（防写穿与误 chmod）；插件超时/信号终止的错误归因带 signal 与 killed 信息；值表全部改 null-prototype（`__proto__` 键名不再触碰原型链）。文档明确"值中的 `mxenv://` 文本一律视为引用、无转义"与 `run --serve` 只挡组合 key 的边界。

## 0.12.2

### Fixed

- **Explicit `profile: 'legacy'` resolves the implicit default profile** (mx-env-secret-source prerequisite): composition synthesizes a default profile named `legacy` when no config declares profiles, but an explicit request for that name threw `Unknown profile` — so `mxenv://legacy/KEY` references (`ReferenceResolver`/`mxenv inject`) failed on machines running the implicit default. A profile actually declared under the name still wins.

## 0.12.1

### Fixed

- **Writes always land on `~/.mxenv/`** (audit events, generated shims): during the compat window these previously followed the legacy read fallback into `~/.mx-env/`, which surprised users (even `--no-global` runs touched the legacy tree). The active global directory is now judged by **content** — real data vs auto-created `audit/`/`shims/` scaffolding — so the read fallback no longer flips early, and `migrate --home` folds scaffolding-only targets into the migration instead of reporting a conflict (same-day audit `.jsonl` files merge by append).
- `mxenv-cli shell-init --help`, and `--help`/`-h` after any subcommand on both CLIs, show help instead of failing with "unrecognized flag(s)".
- `mxenv-cli` answers project commands (`run`, `export`, …) with a "run it inside a project" hint instead of a bare `Unknown command`.
- The legacy-directory migration hint now prints once per machine (previously once per process) and is silenced entirely under `--no-global`.
- PATH sanitization and `shell-init --remove` cover the legacy `~/.mx-env/shims` directory too, so pre-migration shims cannot recurse into `mxenv run`.

### Docs

- From a developer-experience review (docs-only self-serve test, score 7.5/10): SKILL.md no longer suggests installing both packages globally (bin-takeover trap); the npm package READMEs carry the global-install conflict warning; the repository README gained a step-by-step upgrade guide and a known-issues note for the transitive `@infisical/sdk` advisories.

## 0.12.0

### Added

- **Three-package layout**: `@morphixai/mxenv-core` (composition engine + contracts), `@morphixai/mxenv` (project-facing run face), `@morphixai/mxenv-cli` (machine-level management face, Wave A: `shell-init`). Project install (`@morphixai/mxenv` as devDependency) is fully self-sufficient; the global CLI is an enhancement layer. npm's name-similarity policy rejected the unscoped name `mxenv` (too close to `exenv`/`osenv`), so the packages publish under the `@morphixai/*` scope; bin names, config/plugin names and `mxenv://` references are unchanged.
- **`mxenv-cli shell-init`**: declarative PATH shims with two-level (global ∪ project) manifests, recursive stripping, and rc block management. Generated shims now delegate to `mxenv run` (see Changed for legacy shims).
- Project-local CLI resolution for write operations (`cwd` → `node_modules/.bin` → PATH) with an actionable hard failure when no local CLI is installed.
- **`mxenv migrate --home`**: one-shot global-directory migration (copy → timestamped backup `~/.mx-env.backup-<ts>` → value-level equivalence verification; automatic full restore on failure; rc PATH re-wiring to the new shim directory). Idempotent, never prints values.
- Global directory `~/.mxenv/` with **read fallback** to legacy `~/.mx-env/`; during the compat window writes also land on the legacy directory so `migrate --home` never sees a self-created target. A one-time stderr hint points at `migrate --home`.

### Changed

- **BREAKING (naming)**: the tool is now `mxenv`. New canonical names everywhere: `mxenv` bin, `mxenv://` references, `mxenv.config.json`, `mxenv-provider-<plugin>`, `~/.mxenv/` global directory, `mxenv:<source>` keychain service. Legacy names remain as deprecated shims in 0.12.x: `mx-env`/`morphix-env` bins (stderr deprecation notice), legacy config/plugin/keychain names are read as fallback, writes always land on the new names. `mx-env://` references are rejected with guidance to switch.
- **BREAKING (editor)**: the visual editor renders client-side (no server-side React rendering). The served page is an HTML shell + state JSON + client bundle; external consumers of the raw HTML must read the state payload instead of rendered markup.
- `shell-init` moved to `mxenv-cli`; `mxenv run` keeps shim stripping/boot sanitization (shared implementation in `mxenv-core`).
- Generated shims, backup suffixes (`.mxenv-backup-`) and rc marker blocks use the new names. **Shim files and rc blocks generated by older versions remain recognized and removable** (dual-marker detection); existing shims delegating to `mx-env` keep working via the alias until 0.13 removes it — when upgrading past 0.13, re-run `mxenv-cli shell-init` to regenerate.
- Audit read/write both resolve `~/.mxenv/audit` (single path source).

### Deprecated

- `mx-env` and `morphix-env` bin names (removed in 0.13). The `morphix-env` npm package becomes a forwarding stub.

### Migration notes

- **Do not install `@morphixai/mxenv` and `@morphixai/mxenv-cli` globally side by side**: both register the `mxenv`/`mx-env`/`morphix-env` bin names and the later install silently takes over the symlinks. Install `@morphixai/mxenv-cli` for machine-level management (`shell-init`) or `@morphixai/mxenv` as a project devDependency — not both globally.
- **The global CLI no longer ships project commands**: `run`/`export`/`inspect`/`migrate`/`edit` live in the project-facing `@morphixai/mxenv` package. The 0.11 pattern `mx-env run …` from a global install becomes a project-local call (`npx @morphixai/mxenv run …` or `node_modules/.bin/mxenv run …`).

## 0.11.0

### Added

- **Value reveal in `mx-env edit`**: dotenvx and Keychain source pages list existing key names and reveal stored values one key at a time on explicit request (a single revealed value is resident per page; values never leave the browser session). The stored file value always wins over same-named environment names (`dotenvx get --overload`), and every dotenvx call runs pinned to the file's directory with a per-file key-model environment, so key material stays beside its file and OS-keychain-custodied files remain readable.
- **Delete from the editor**: dotenvx keys and Keychain entries can be removed with a destructive confirmation dialog (encrypted files go through `dotenvx del`).
- **Source switcher + reachable index**: every page carries a source navigation row; the "All sources" index (sources + resolved key names, value-free) is reachable from any launch mode — `--source` sessions now land the browser directly on the source page instead of dead-ending the back link. Bare `mx-env edit` opens the default composition, including the implicit global on config-less machines.
- Editor writes, deletes and reveals append value-free audit events (`via: "editor"`, `action`, key names only).

### Changed

- **BREAKING**: `mx-env edit` sessions no longer close after a save. A session now supports multi-step maintenance (edit/add/delete across sources) and ends via the explicit "End session" action or the 15-minute TTL.
- `set` refuses values containing `$` sequences with an explanation (dotenvx expands `$name` on every load path, so such values cannot be stored faithfully — the same semantics `migrate` enforces) and never writes an empty value implicitly.
- `mx-env edit --help` reflects the session model and both scope flags.

### Fixed

- File indexes outside the source's range clamp to a valid file instead of erroring.
- Reveal/delete failures report read/delete-specific errors instead of a misleading "Unable to save this source".
- Dash-leading values (e.g. `-f`) are no longer mis-parsed as dotenvx options when saving.
- Local-file save failures are audited (previously only success was recorded).
- The encrypted-file sniff recognizes dotted key names (`A.B=encrypted:…`).
- "Continue editing" after a save returns to the file that was saved, not file 0.

## 0.10.1

### Fixed

- **`migrate` verification no longer consults the caller's environment** (found during a real 11-key global rollout). dotenvx `decrypt --stdout` merges same-named parent-env variables over file values and resolves `DOTENV_PRIVATE_KEY*` key material from the environment (both empirical, dotenvx 2.30; there is no `--overload` for decrypt) — so a stale shell export for any migrated key used to fail the post-migration equivalence check and roll the migration back, and inline key material could substitute for the `.env.keys` the check is supposed to prove. Verification now runs dotenvx under a minimal allowlisted environment (PATH pinned to the current Node runtime), making both structurally impossible. Keys that collide with that runtime environment (`PATH`, `HOME`, …) are verified by presence; value fidelity for them rests on `run --overload` file-wins semantics.
- Verification failures now **name the differing keys** and explain dotenvx `$name` expansion: values containing `$` expand on every dotenvx load path, so a migration that would change what consumers see is refused with the offending keys named instead of an undiagnosable mismatch.
- `migrate` refuses plaintext keys in the reserved `DOTENV_PUBLIC_KEY*` prefix up front with the key named (dotenvx rejects such files at `encrypt` with a raw hex error).

## 0.10.0

### Added

- **`mx-env migrate`** (issue #7): move plaintext `local` storage into encrypted storage — dotenvx encrypted files or the macOS Keychain. Bare `migrate` prints a read-only plan (units, files, key names — never values); `--to dotenvx|keychain` executes per unit with a 0600 backup, a value-level equivalence check (decrypt/keychain read-back vs plaintext snapshot), config rewrite, and automatic restore on failure. Scope: the global `~/.mx-env/.env` (dotenvx only — composition sniffs the encryption markers, no config change needed) plus declared `local` sources in global/project configs; legacy files are reported as hints. Migrations are recorded in the value-free audit (`profile: migrate`). Keychain verification is a subset check (unrelated accounts in the target service only warn), and a rollback writes overwritten same-named accounts back to their previous values — never a silent data loss.
- **Plaintext dev-only marking**: `mx-env inspect` appends `[plaintext, dev-only]` to `local` sources; `--warn-plaintext` (or `MXENV_WARN_PLAINTEXT=1`, for shimmed invocations) adds a once-per-process stderr reminder on composition paths pointing at `mx-env migrate`.

### Changed

- **dotenvx sources are file-value-wins** (`dotenvx run --overload`): a same-named variable already exported in the parent environment no longer shadows the file value. This aligns dotenvx with `local` semantics — migration now provably preserves what your commands see.
- dotenvx migrations pin the file model (`--no-native`): the private key lands in a 0600 `.env.keys` beside the file instead of the OS keychain, keeping the result portable and CI-friendly. An unignored `.env.keys` inside a git repo earns a warning.
- The implicit global dotenvx path (migrated `~/.mx-env/.env`) gates `.env.keys` at 0600, the same rule the plaintext file had (`--allow-insecure-global` waives; win32 exempt).

## 0.9.0

### Added

- **Terminal shims** (`mx-env shell-init [--write|--remove]`): declare `"shims": ["node", "pnpm"]` in the global and/or project config (unioned, case-insensitively deduplicated) and run declared commands bare — a PATH shim makes `pnpm dev` exactly `mx-env run -- pnpm dev`. `run` sanitizes the shims directory out of the child PATH before composing (provider subprocesses included), so injection happens exactly once with no recursion. Shim invocations are recorded in audit with `via: "shim"`. macOS/Linux. (#10)

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
