# mxenv

L2 run face for [mxenv](https://github.com/Morphicai/morphix-env) — the project-side CLI and SDK runtime. Secrets stay with their owners (Infisical / Doppler / dotenvx / macOS Keychain / local files) and are composed into one value-safe child environment.

> Upgrading from the old `morphix-env` package? See "Upgrading an existing project, step by step" in the [repository README](https://github.com/Morphicai/morphix-env#migrating-from-morphix-env--mx-env).

## Install

```bash
npm i -D @morphixai/mxenv
```

> ⚠️ **Do not install `@morphixai/mxenv` and `@morphixai/mxenv-cli` globally side by side** — both register the `mxenv` bin name and the later install silently takes over the symlink. Keep this package as a project devDependency and install `mxenv-cli` globally (or vice versa, never both).

## Commands

`mxenv run|export|inspect|render|inject|generate|fetch|migrate|audit|edit|doc|skill` — see `mxenv --help`. The legacy bin names `mx-env`/`morphix-env` were removed in 0.13.x — invoke `mxenv` only.

Machine-level extras (`shell-init`, and the Wave B `gui/global/host` faces) live in [`@morphixai/mxenv-cli`](https://www.npmjs.com/package/@morphixai/mxenv-cli).

## License

MIT © Morphicai — see [LICENSE](./LICENSE). Security policy: [SECURITY.md](./SECURITY.md).
