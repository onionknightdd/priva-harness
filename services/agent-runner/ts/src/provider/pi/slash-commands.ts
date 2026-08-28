import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent'

import {
  mergeSlashCommands,
  type SlashCommand,
  type SlashOrigin,
} from '../../core/resource/slash-command.js'
import { PI_BUILTIN_SLASH_COMMANDS } from './pi-builtin-slash-commands.js'

export interface PiSlashResource {
  readonly name: string
  readonly description: string
  readonly argumentHint?: string
  readonly origin: SlashOrigin
}

export function assemblePiSlashCommands(
  skills: readonly PiSlashResource[],
  prompts: readonly PiSlashResource[],
): SlashCommand[] {
  return mergeSlashCommands([
    ...PI_BUILTIN_SLASH_COMMANDS.map((command) => ({
      name: command.name,
      description: command.description,
      kind: 'command' as const,
      origin: 'builtin' as const,
      ...(command.argumentHint === undefined ? {} : { argumentHint: command.argumentHint }),
    })),
    ...prompts.map((prompt) => ({
      name: prompt.name,
      description: prompt.description,
      kind: 'command' as const,
      origin: prompt.origin,
      ...(prompt.argumentHint === undefined ? {} : { argumentHint: prompt.argumentHint }),
    })),
    ...skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      kind: 'skill' as const,
      origin: skill.origin,
      ...(skill.argumentHint === undefined ? {} : { argumentHint: skill.argumentHint }),
    })),
  ])
}

export async function listPiSlashCommands(options: {
  readonly cwd: string
  readonly agentDir: string
}): Promise<readonly SlashCommand[]> {
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager: SettingsManager.create(options.cwd, options.agentDir),
    noExtensions: true,
    noThemes: true,
    noContextFiles: true,
  })
  await loader.reload()
  return assemblePiSlashCommands(
    loader.getSkills().skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      origin: originFromScope(skill.sourceInfo.scope),
    })),
    loader.getPrompts().prompts.map((prompt) => ({
      name: prompt.name,
      description: prompt.description,
      origin: originFromScope(prompt.sourceInfo.scope),
      ...(prompt.argumentHint === undefined ? {} : { argumentHint: prompt.argumentHint }),
    })),
  )
}

function originFromScope(scope: 'user' | 'project' | 'temporary'): SlashOrigin {
  return scope === 'project' ? 'project' : 'user'
}
