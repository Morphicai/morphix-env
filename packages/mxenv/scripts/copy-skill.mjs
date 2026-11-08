// Copies the maintained skill template into dist/ so it ships with the
// published package (files: ["dist"]). Must run AFTER tsup --clean.
// Source of truth lives at the repo root (`skills/mxenv/SKILL.md`) so the
// `npx skills` CLI (vercel-labs/skills) can discover and install it straight
// from GitHub — one source, two distribution channels.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, '..', '..', 'skills', 'mxenv', 'SKILL.md')
const dest = join(root, 'dist', 'SKILL.md')

mkdirSync(join(root, 'dist'), { recursive: true })
copyFileSync(source, dest)
console.log('[mxenv] Copied skills/mxenv/SKILL.md -> dist/SKILL.md')
