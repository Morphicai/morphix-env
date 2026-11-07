# mxenv-cli

L3 management face for [mxenv](https://github.com/Morphicai/morphix-env) — machine-level extras beyond the project CLI.

## Install

```bash
npm i -g mxenv-cli
```

## Commands

- `mxenv-cli shell-init` — generate/remove PATH shims and the marked rc block (global + project shim manifests)
- `gui` / `global` / `host` — reserved for Wave B (not implemented; rejected with guidance)

Project commands (`run`/`export`/`edit`/…) come from [`mxenv`](https://www.npmjs.com/package/mxenv) installed as a devDependency — the global face deliberately does not include them.

## License

MIT © Morphicai — see [LICENSE](./LICENSE). Security policy: [SECURITY.md](./SECURITY.md).
