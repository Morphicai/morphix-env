# mxenv visual assets

The README visuals are lightweight, editable SVGs with no external images, fonts, scripts, or network dependencies.

## Logo

- `../logo.svg` — primary app icon. A bold lowercase **m** on a near-black tile, with a mint value dot: the secret reduced to one confident letter.
- `logo-mono.svg` — single-color mark using `currentColor` for small or monochrome placements.
- `mxenv-lockup.svg` / `mxenv-lockup-dark.svg` — horizontal README lockups; the dark lockup uses an elevated tile (`#263148`) so the near-black mark does not melt into dark pages.
- `../brand/logo-v2/` — design exploration history: two concept boards and the final package this icon came from.

The symbol deliberately avoids a generic vault, padlock, shield, or keyhole: mxenv is a composition layer, not a secret store.

## Provider & consumer marks (`brand/`)

Third-party marks used by the README comparison table and the posters, kept monochrome and value-free:

- `infisical.svg` (+ `-dark`) — official wordmark's icon glyph, cropped from Infisical's own docs logo. Light fill `#111827`, dark fill `#E6EDF3`.
- `dotenv.svg` / `onepassword.svg` / `vault.svg` (+ `-dark`) — official paths from the simple-icons collection.
- `openai.svg` / `claude.svg` / `node.svg` (+ `-dark`) — consumer-side marks (Codex ships the OpenAI mark), same simple-icons source.
- `doppler.svg` / `dotenvx.svg` / `hermes.svg` — placeholder monograms pending official marks (bubble marks are theme-independent); `terminal.svg` (+ `-dark`) is a generic prompt-cursor glyph. Replacing these files in place swaps every reference.
- `mxenv.svg` — our own tile mark, theme-independent (single file, no dark variant needed).

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

Use system sans-serif for prose and system monospace for commands. Do not add gradients, real secret values, or rasterized copies to the source assets. Third-party provider marks stay monochrome and come from `brand/` only. Keep diagrams truthful to the current CLI contract when commands or boundaries change.
