# mxenv visual assets

The README visuals are lightweight, editable SVGs with no external images, fonts, scripts, or network dependencies.

## Logo

- `../logo.svg` — primary app icon. A bold lowercase **m** on a near-black tile, with a mint value dot: the secret reduced to one confident letter.
- `logo-mono.svg` — single-color mark using `currentColor` for small or monochrome placements.
- `mxenv-lockup.svg` / `mxenv-lockup-dark.svg` — horizontal README lockups; the dark lockup uses an elevated tile (`#263148`) so the near-black mark does not melt into dark pages.
- `../brand/logo-v2/` — design exploration history: two concept boards and the final package this icon came from.

The symbol deliberately avoids a generic vault, padlock, shield, or keyhole: mxenv is a composition layer, not a secret store.

## Posters

- `secret-flow.svg` — provider ownership, composition, controlled consumption, and the model-context boundary.
- `agent-boundary.svg` — `run --serve` capability flow: endpoint + random token to the child, one value at a time over loopback, names only to model context.
- `migration.svg` — discover → 0600 backup → encrypt → value-level verification → config switch, with rollback on failure.

## Tokens

| Role | Value |
|---|---|
| Primary / composition | `#3157D5` |
| Safe channel / verification | `#79E2C3` |
| Primary text | `#111827` |
| Secondary text | `#5B6472` |
| Canvas | `#F7F9FC` |

Use system sans-serif for prose and system monospace for commands. Do not add gradients, real provider logos, real secret values, or rasterized copies to the source assets. Keep diagrams truthful to the current CLI contract when commands or boundaries change.
