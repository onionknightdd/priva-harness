import { resolveBuiltinPlugins } from './builtin-plugins.js'
import { standaloneComputerSkillIds } from './computer-use.js'
import { resolveOriginalComputerSkills } from './original-computer-skills.js'

/** Both provider formats use these paths into the same immutable skill snapshots. */
export function resolveSessionPluginResources(ids: readonly string[], env: NodeJS.ProcessEnv = process.env): readonly {
  rootDir: string
  skillDir: string
}[] {
  const builtins = resolveBuiltinPlugins(ids, env)
  const active = standaloneComputerSkillIds(env)
  if (active.length === 0) return builtins
  const root = env['PRIVA_CUA_SKILLS']
  if (!root) throw new Error('PRIVA_CUA_ENABLED_SKILLS requires PRIVA_CUA_SKILLS to identify the verified snapshot')
  const platform = env['PRIVA_CUA_RUNTIME'] ? process.platform : undefined
  return [...builtins, ...resolveOriginalComputerSkills(root, active, platform).map(({ pluginRoot, skillDir }) => ({ rootDir: pluginRoot, skillDir }))]
}
