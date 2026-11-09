# mxenv-cli

L3 management face for [mxenv](https://github.com/Morphicai/morphix-env) — machine-level extras beyond the project CLI.

## Install

```bash
npm i -g @morphixai/mxenv-cli
```

> ⚠️ **Do not install `@morphixai/mxenv-cli` and `@morphixai/mxenv` globally side by side** — both register the `mxenv` bin name and the later install silently takes over the symlink. Keep `mxenv` as a project devDependency and install this package globally (or vice versa, never both).

## Commands

- `mxenv-cli shell-init` — generate/remove PATH shims and the marked rc block (global + project shim manifests)
- `mxenv gui [status|close]` — panel-host session: machine-level keys view and safe single-key reveal (locked by default; values never leave this machine; `reveal`/`unlock` endpoints are for the human-operated panel session only — Agent/automation uses the names-only surface)
- `gui` / `global` / `host` — reserved for Wave B (not implemented; rejected with guidance)

Project commands (`run`/`export`/`edit`/…) come from [`@morphixai/mxenv`](https://www.npmjs.com/package/@morphixai/mxenv) installed as a devDependency — the global face deliberately does not include them.

## License

MIT © Morphicai — see [LICENSE](./LICENSE). Security policy: [SECURITY.md](./SECURITY.md).
