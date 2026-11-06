import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'

export interface SkillOptions {
  target: string | null
  force: boolean
}

const SKILL_TARGETS = ['global', 'project', 'trellis'] as const
type SkillTarget = (typeof SKILL_TARGETS)[number]

function resolveSkillPath(target: SkillTarget): string {
  if (target === 'project') return join(process.cwd(), '.claude', 'skills', 'morphix-env', 'SKILL.md')
  if (target === 'trellis') return join(homedir(), '.trellis', 'skills', 'morphix-env', 'SKILL.md')
  return join(homedir(), '.claude', 'skills', 'morphix-env', 'SKILL.md')
}

function targetHint(target: SkillTarget): string {
  if (target === 'project') {
    return 'Project skill installed; commit it so every Agent working in this repository picks it up.'
  }
  if (target === 'trellis') {
    return 'Installed into the Trellis canonical store; run `trellis sync skills` to distribute it to managed agents.'
  }
  return 'Installed as a Claude Code global skill; available in every project.'
}

function printNextSteps(): void {
  console.log(`[morphix-env] Next steps:
  1. mx-env inspect                        check this project's config and resolved key names
  2. create mx-env.config.json if absent   see the skill's configuration section (source wiring only, no values)
  3. mx-env edit --profile <name>          let the user fill values in the local visual editor
  4. mx-env doc                            generate this project's key-to-source workflow Skill`)
}

export function cmdSkill(subcommand: string, options: SkillOptions): number {
  const templatePath = join(__dirname, 'SKILL.md')
  const template = readFileSync(templatePath, 'utf8')

  if (subcommand === 'show') {
    console.log(`[morphix-env] Skill template: ${templatePath}`)
    for (const target of SKILL_TARGETS) {
      const path = resolveSkillPath(target)
      if (!existsSync(path)) {
        console.log(`  ${target}: not installed (${path})`)
        continue
      }
      const state = readFileSync(path, 'utf8') === template
        ? 'installed (matches this version)'
        : 'installed (differs from this version)'
      console.log(`  ${target}: ${state} (${path})`)
    }
    return 0
  }

  if (subcommand !== 'install') {
    console.error(`[morphix-env] Unknown skill subcommand "${subcommand}". Use install or show.`)
    return 1
  }

  const target = options.target ?? 'global'
  if (!SKILL_TARGETS.includes(target as SkillTarget)) {
    console.error(`[morphix-env] Unknown skill target "${options.target}". Use global, project, or trellis.`)
    return 1
  }

  const dest = resolveSkillPath(target as SkillTarget)
  if (existsSync(dest)) {
    if (readFileSync(dest, 'utf8') === template) {
      console.log(`[morphix-env] Skill already installed and up to date: ${dest}`)
      return 0
    }
    if (!options.force) {
      console.error(`[morphix-env] ${dest} exists with different content; refusing to overwrite. Re-run with --force to replace it.`)
      return 1
    }
  }

  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, template, { mode: 0o644 })
  console.log(`[morphix-env] Installed skill: ${dest}`)
  console.log(`[morphix-env] ${targetHint(target as SkillTarget)}`)
  printNextSteps()
  return 0
}
