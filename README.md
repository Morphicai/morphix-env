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
# Run a command with .env.local overrides
morphix-env run -- next dev

# Generate client-side __env.js
morphix-env generate --out public/__env.js

# Debug: see what's loaded
morphix-env inspect
```

## Commands

### `morphix-env run [options] -- <command>`

Load environment variables, then execute a command. The child process inherits all injected vars.

```bash
# Basic: load .env.local, run dev server
morphix-env run -- next dev --turbo -p 3004

# Custom env file
morphix-env run -f .env.staging -- npm start

# Skip Infisical (use only local files)
morphix-env run --no-infisical -- npm start

# Verbose: show which vars were loaded
morphix-env run -v -- node server.js
```

**Loading priority (high to low):**

1. `.env.local` (or `--env-file`) — always wins
2. Infisical secrets — pulled via SDK
3. Existing `process.env` — Docker ENV, CI vars, etc.

### `morphix-env generate [options]`

Extract public environment variables (`NEXT_PUBLIC_*`, `VITE_*`, `EXPO_PUBLIC_*`) and write them to a JS file for browser runtime injection.

```bash
# Default: public/__env.js
morphix-env generate

# Custom output path (Vite projects)
morphix-env generate --out dist/__env.js

# Only include specific prefix
morphix-env generate --filter NEXT_PUBLIC_
```

Output file content:

```js
window.__ENV={"NEXT_PUBLIC_API_URL":"https://api.example.com","NEXT_PUBLIC_APP_NAME":"MyApp"};
```

Load it in your HTML before your app bundle:

```html
<script src="/__env.js"></script>
```

Read in your app:

```ts
function getEnv(key: string, fallback = ''): string {
  if (typeof window === 'undefined') return process.env[key] || fallback
  return window.__ENV?.[key] || process.env[key] || fallback
}
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
| `--no-infisical` | | Skip Infisical SDK fetch |
| `--verbose` | `-v` | Show loaded variable names |

## Config File

Create `morphix-env.config.json` in your project root to declare project-level settings. This file is committed to git.

```json
{
  "infisical": {
    "projectId": "your-project-id",
    "paths": ["/ai/shared", "/ai/web"],
    "env": "$DEPLOY_ENV"
  },
  "envFiles": [".env.local"],
  "generate": {
    "out": "public/__env.js",
    "filter": "NEXT_PUBLIC_"
  }
}
```

| Field | Description | Committed to git? |
|-------|-------------|-------------------|
| `infisical.projectId` | Infisical project ID | Yes — not a secret |
| `infisical.paths` | Secret paths to pull | Yes — not a secret |
| `infisical.env` | Environment name, supports `$VAR` references | Yes |
| `envFiles` | Local override files to load | Yes |
| `generate` | Client-side __env.js output config | Yes |

**Infisical authentication** is always via environment variables — never in the config file:

| Env Var | Description |
|---------|-------------|
| `INFISICAL_CLIENT_ID` | Machine Identity client ID |
| `INFISICAL_CLIENT_SECRET` | Machine Identity client secret |
| `DEPLOY_ENV` | Environment name (`dev` / `staging` / `prod`) |

## Usage Examples

### Next.js

```json
{
  "scripts": {
    "dev": "morphix-env run -- next dev --turbo -p 3004",
    "build": "morphix-env run -- next build",
    "start": "morphix-env run -- node server.js"
  }
}
```

`morphix-env.config.json`:

```json
{
  "infisical": {
    "projectId": "xxx",
    "paths": ["/ai/shared", "/ai/web"],
    "env": "$DEPLOY_ENV"
  },
  "envFiles": [".env.local"],
  "generate": {
    "out": "public/__env.js",
    "filter": "NEXT_PUBLIC_"
  }
}
```

### Vite (React / Vue / Ionic)

```json
{
  "scripts": {
    "dev": "morphix-env run -- vite",
    "build": "morphix-env run -- vite build"
  }
}
```

```json
{
  "infisical": {
    "projectId": "xxx",
    "paths": ["/ai/shared", "/ai/shell"],
    "env": "$DEPLOY_ENV"
  },
  "generate": {
    "out": "dist/__env.js",
    "filter": "VITE_"
  }
}
```

### Express API

```json
{
  "scripts": {
    "dev": "morphix-env run -- tsx watch src/index.ts",
    "start": "morphix-env run -- node dist/index.js"
  }
}
```

```json
{
  "infisical": {
    "projectId": "xxx",
    "paths": ["/ai/shared", "/ai/api"],
    "env": "$DEPLOY_ENV"
  }
}
```

No `generate` field — server-side apps don't need `__env.js`.

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN pnpm install && pnpm build

# Only these 3 vars needed at runtime
ENV INFISICAL_CLIENT_ID=""
ENV INFISICAL_CLIENT_SECRET=""
ENV DEPLOY_ENV="prod"

CMD ["npx", "morphix-env", "run", "--", "node", "server.js"]
```

No Infisical CLI binary needed in the image.

### Local Development with Infisical CLI

If you already use `infisical run` locally, morphix-env still adds value as the override layer:

```json
{
  "dev": "infisical run --path=/ai --env=dev -- morphix-env run -- next dev",
  "dev:local": "infisical run --path=/ai --env=dev -- morphix-env run -- next dev"
}
```

`.env.local` overrides take effect on top of Infisical CLI injection.

## How It Works

1. Read `morphix-env.config.json` for project settings
2. If `INFISICAL_CLIENT_ID` + `INFISICAL_CLIENT_SECRET` exist → fetch secrets via SDK, inject into `process.env` (does not overwrite existing vars)
3. Read `.env.local` → inject into `process.env` (overwrites everything, highest priority)
4. If `generate` is configured → write `__env.js` with public vars
5. Spawn child command — it inherits the fully assembled `process.env`

## License

MIT
