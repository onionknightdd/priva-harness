import type { McpServerDefinition } from '../resource/mcp.js'
import type { SkillDefinition } from '../resource/skill.js'

export type HarnessConfigScope =
  | { readonly kind: 'global' }
  | { readonly kind: 'project'; readonly cwd: string }

export interface HarnessConfig {
  readonly revision: string
  readonly scope: HarnessConfigScope
  readonly mcpServers: readonly McpServerDefinition[]
  readonly skills: readonly SkillDefinition[]
}

export function emptyHarnessConfig(
  scope: HarnessConfigScope = { kind: 'global' },
): HarnessConfig {
  return {
    revision: '0',
    scope,
    mcpServers: [],
    skills: [],
  }
}
