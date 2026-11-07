# mxenv

L2 run face for [mxenv](https://github.com/Morphicai/morphix-env) — the project-side CLI and SDK runtime. Secrets stay with their owners (Infisical / Doppler / dotenvx / macOS Keychain / local files) and are composed into one value-safe child environment.

> Upgrading from the old `morphix-env` package? See "Upgrading an existing project, step by step" in the [repository README](https://github.com/Morphicai/morphix-env#migrating-from-morphix-env--mx-env).

## Install

```bash
npm i -D @morphixai/mxenv
```

> ⚠️ **Do not install `@morphixai/mxenv` and `@morphixai/mxenv-cli` globally side by side** — both register the `mxenv`/`mx-env`/`morphix-env` bin names and the later install silently takes over the symlinks. Keep this package as a project devDependency and install `mxenv-cli` globally (or vice versa, never both).

## Commands

`mxenv run|export|inspect|render|inject|generate|fetch|migrate|audit|edit|doc|skill` — see `mxenv --help`. Old bin names `mx-env`/`morphix-env` remain as deprecated aliases in 0.12.x (removed in 0.13).

Machine-level extras (`shell-init`, and the Wave B `gui/global/host` faces) live in [`@morphixai/mxenv-cli`](https://www.npmjs.com/package/@morphixai/mxenv-cli).

## License

MIT © Morphicai — see [LICENSE](./LICENSE). Security policy: [SECURITY.md](./SECURITY.md).
