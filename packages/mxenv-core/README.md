# mxenv-core

L0 contracts + L1 shared capabilities for the [mxenv](https://github.com/Morphicai/morphix-env) secret-composition toolchain: composition engine, source providers (Infisical / Doppler / dotenvx / macOS Keychain / local files), audit & redaction primitives, and the pure `/contracts` surface.

## Install

```bash
npm i mxenv-core
```

## Entrypoints

- `mxenv-core` — composition engine + providers (`composeEnvironment`, `loadConfigLayers`, …)
- `mxenv-core/contracts` — pure, IO-free contract layer (config schema, `mxenv://` syntax, audit/redaction types)

Most users want the CLI instead: [`mxenv`](https://www.npmjs.com/package/mxenv) (project devDependency) or [`mxenv-cli`](https://www.npmjs.com/package/mxenv-cli) (global management face).

## License

MIT © Morphicai — see [LICENSE](./LICENSE). Security policy: [SECURITY.md](./SECURITY.md).
