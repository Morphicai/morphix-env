// Copies the maintained skill template into dist/ so it ships with the
// published package (files: ["dist"]). Must run AFTER tsup --clean.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(root, 'dist', 'SKILL.md')

mkdirSync(join(root, 'dist'), { recursive: true })
copyFileSync(join(root, 'skill', 'SKILL.md'), dest)
console.log('[morphix-env] Copied skill/SKILL.md -> dist/SKILL.md')
