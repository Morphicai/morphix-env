<p align="center">
  <img src="https://morphix.app/brand/logo-rounded.png" width="80" alt="MorphixAI" />
</p>

# morphix-env

Environment variable toolkit for multi-project architectures. Combines [Infisical](https://infisical.com) secret management with local override files and client-side runtime injection.

## Why

| Problem | Solution |
|---------|----------|
| `NEXT_PUBLIC_*` / `VITE_*` baked at build time | `morphix-env generate` creates `__env.js` for runtime injection |
| Scattered env vars across hosting platforms | Single source of truth in Infisical, pulled at startup |
| No local override when using remote config | `.env.local` always wins — edit one file, restart |
| Different tools for different needs (dotenv, cross-env, infisical CLI) | One tool, one command |

## Install

```bash
pnpm add -D morphix-env
# or
npm install -D morphix-env
```

## Quick Start

```bash
# Run a command with env injection
morphix-env run -- next dev

# Generate client-side __env.js
morphix-env generate --out public/__env.js

# Debug: see what's loaded
morphix-env inspect
```

## How It Works

### Core Flow

```
morphix-env run -- <command>
│
├─ 1. Read mx-env.config.json
│
├─ 2. Load Infisical secrets ──────────────────────────┐
│     │                                                 │
│     ├─ INFISICAL_CLIENT_ID exists?                    │
│     │   ├─ Yes → SDK (Machine Identity) ── CI/Docker  │
│     │   └─ No ──┐                                     │
│     │           ├─ infisical CLI installed?            │
│     │           │   ├─ Yes → CLI (user login) ── Local │
│     │           │   └─ No → Skip                       │
│     │                                                 │
│     └─ Inject into process.env (does NOT overwrite)   │
│                                                       │
├─ 3. Load .env.local ─────────────────────────────────┐
│     └─ Inject into process.env (OVERWRITES all)       │
│                                                       │
├─ 4. Generate __env.js (if configured)                 │
│     └─ Extract NEXT_PUBLIC_* / VITE_* → write file    │
│                                                       │
└─ 5. Spawn child command                               │
      └─ Inherits fully assembled process.env           │
```

### Priority (high → low)

```
┌─────────────────────────────────────────────────┐
│  .env.local                     ← HIGHEST       │
│  Always wins. Developer's local overrides.       │
├─────────────────────────────────────────────────┤
│  Infisical secrets              ← MEDIUM         │
│  Pulled via SDK or CLI. Does not overwrite.      │
├─────────────────────────────────────────────────┤
│  process.env                    ← LOWEST         │
│  Docker ENV, CI vars, shell exports.             │
└─────────────────────────────────────────────────┘
```

### Authentication Flow

```
┌──────────────────────────────────────────────────────────┐
│                   morphix-env starts                      │
│                         │                                 │
│           INFISICAL_CLIENT_ID set?                        │
│              /                  \                          │
│           Yes                    No                       │
│            │                      │                       │
│    ┌───────▼────────┐    infisical CLI installed?         │
│    │  SDK Auth       │       /            \                │
│    │  (Machine ID)   │    Yes              No             │
│    │                 │     │                │              │
│    │  CI / Docker /  │  ┌──▼───────────┐   │              │
│    │  Production     │  │ CLI Auth      │   ▼              │
│    └────────┬────────┘  │ (User Login)  │  Skip            │
│             │           │               │  Infisical       │
│             │           │ Local Dev     │                  │
│             │           └──────┬────────┘                  │
│             │                  │                           │
│             ▼                  ▼                           │
│         Pull secrets from Infisical                       │
│         Inject into process.env                           │
└──────────────────────────────────────────────────────────┘
```

### Local Development

```
Developer machine:
  1. infisical login          ← one-time, session cached
  2. pnpm dev                 ← morphix-env auto-detects CLI
     └─ morphix-env run
        ├─ infisical CLI pulls 69 secrets
        ├─ .env.local overrides API_BASE_URL → localhost
        └─ next dev starts with all vars
```

### CI / Docker

```
Container / CI runner:
  ENV INFISICAL_CLIENT_ID=xxx
  ENV INFISICAL_CLIENT_SECRET=xxx
  ENV DEPLOY_ENV=prod

  CMD morphix-env run -- node server.js
      └─ morphix-env run
         ├─ SDK pulls secrets (no CLI needed)
         ├─ .env.local not present → skip
         └─ server starts with prod vars
```

### `__env.js` — Client-Side Runtime Injection

```
Build phase (CI):
  morphix-env run -- next build
  ├─ NEXT_PUBLIC_* injected at build time → baked into JS bundle
  └─ Works, but image is environment-specific

Runtime injection (Docker, optional):
  morphix-env run -- node server.js
  ├─ morphix-env generates public/__env.js:
  │    window.__ENV = {
  │      "NEXT_PUBLIC_API_URL": "https://api.prod.example.com",
  │      "NEXT_PUBLIC_APP_NAME": "MyApp"
  │    };
  │
  ├─ Browser loads <script src="/__env.js"> before app
  └─ App reads: window.__ENV?.NEXT_PUBLIC_API_URL
     → One build, deploy to any environment
```

## Commands

### `morphix-env run [options] -- <command>`

Load environment variables, then execute a command. The child process inherits all injected vars.

```bash
# Basic: load env, run dev server
morphix-env run -- next dev --turbo -p 3004

# Custom env file
morphix-env run -f .env.staging -- npm start

# Skip Infisical (use only local files)
morphix-env run --no-infisical -- npm start

# Verbose: show which vars were loaded
morphix-env run -v -- node server.js
```

### `morphix-env generate [options]`

Extract public environment variables and write to a JS file for browser runtime injection.

```bash
morphix-env generate                              # → public/__env.js
morphix-env generate --out dist/__env.js           # Vite projects
morphix-env generate --filter NEXT_PUBLIC_          # Only Next.js vars
```

### `morphix-env inspect [options]`

Print env var values for debugging. Secrets are masked (first 4 chars shown).

```bash
morphix-env inspect
morphix-env inspect --filter NEXT_PUBLIC_
morphix-env inspect -f .env.production
```

## Options

| Flag | Short | Description |
|------|-------|-------------|
| `--env-file <path>` | `-f` | Env file to load (default: `.env.local`, repeatable) |
| `--out <path>` | `-o` | Output path for generate (default: `public/__env.js`) |
| `--filter <prefix>` | | Only include vars with this prefix |
| `--no-infisical` | | Skip Infisical fetch entirely |
| `--verbose` | `-v` | Show loaded variable names |

## Config File

Create `mx-env.config.json` in your project root. Committed to git.

```json
{
  "infisical": {
    "paths": ["/ai"],
    "env": "dev"
  },
  "envFiles": [".env.local"],
  "generate": {
    "out": "public/__env.js",
    "filter": "NEXT_PUBLIC_"
  }
}
```

### Config vs Environment Variables

```
┌──────────────────────────────────────────────────────┐
│  mx-env.config.json (committed to git)                │
│  ├─ paths          → which secrets to pull            │
│  ├─ env            → which environment                │
│  ├─ envFiles       → which override files to load     │
│  └─ generate       → __env.js output config           │
│                                                       │
│  These are PROJECT CONFIG, not secrets.                │
├──────────────────────────────────────────────────────┤
│  Environment Variables (NEVER committed)              │
│  ├─ INFISICAL_CLIENT_ID      → Machine Identity       │
│  ├─ INFISICAL_CLIENT_SECRET  → Machine Identity       │
│  └─ DEPLOY_ENV               → prod / staging / dev   │
│                                                       │
│  These are CREDENTIALS, set in CI/Docker only.        │
│  Local dev uses infisical CLI login instead.           │
└──────────────────────────────────────────────────────┘
```

## Usage Examples

### Next.js

```jsonc
// package.json
{
  "scripts": {
    "dev": "morphix-env run -- next dev --turbo -p 3004",
    "build": "morphix-env run -- next build",
    "start": "morphix-env run -- next start"
  }
}
```

```json
// mx-env.config.json
{
  "infisical": { "paths": ["/ai"], "env": "dev" },
  "envFiles": [".env.local"],
  "generate": { "out": "public/__env.js", "filter": "NEXT_PUBLIC_" }
}
```

### Vite (React / Vue / Ionic)

```jsonc
{
  "scripts": {
    "dev": "morphix-env run -- vite",
    "build": "morphix-env run -- vite build"
  }
}
```

```json
{
  "infisical": { "paths": ["/frontend"], "env": "dev" },
  "generate": { "out": "dist/__env.js", "filter": "VITE_" }
}
```

### Express API

```jsonc
{
  "scripts": {
    "dev": "morphix-env run -- tsx watch src/index.ts",
    "start": "morphix-env run -- node dist/index.js"
  }
}
```

```json
{
  "infisical": { "paths": ["/ai"], "env": "dev" },
  "envFiles": [".env.local"]
}
```

No `generate` — server-side apps don't need `__env.js`.

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN pnpm install && pnpm build

ENV INFISICAL_CLIENT_ID=""
ENV INFISICAL_CLIENT_SECRET=""
ENV DEPLOY_ENV="prod"

CMD ["npx", "morphix-env", "run", "--", "node", "server.js"]
```

No Infisical CLI binary needed in the image.

## License

MIT
