import type { ProviderId } from '../contract/agent-provider.js'

export type ResourceScope = 'global' | 'project' | 'local'
export type ResourceOrigin = 'directory' | 'settings' | 'shared' | 'package' | 'plugin' | 'import' | 'builtin'

export interface ResourceSource {
  readonly id: string
  readonly harness: ProviderId
  readonly scope: ResourceScope
  readonly origin: ResourceOrigin
  readonly label: string
  readonly path: string
  readonly cwd: string | null
  readonly writable: boolean
  readonly canAdd: boolean
  /** The harness's own source level, when it differs from the generic storage scope. */
  readonly level?: string
}

export interface ResourceDiagnostic {
  readonly path: string
  readonly message: string
}

export interface ResourceGroup<T> {
  readonly source: ResourceSource
  readonly items: T[]
}

export interface ResourceList<T> {
  readonly groups: ResourceGroup<T>[]
  readonly diagnostics: ResourceDiagnostic[]
  readonly projects: string[]
}

export interface ResourceQuery {
  readonly harness: ProviderId
  readonly cwd?: string
}

export interface SkillSummary {
  readonly id: string
  readonly sourceId: string
  readonly name: string
  readonly description: string
  readonly path: string
  readonly filePath: string
  readonly enabled: boolean
  readonly canToggle: boolean
  readonly canDelete: boolean
  readonly toggleDescription: string
}

export interface SkillFile {
  readonly path: string
  readonly size: number
}

export interface SkillDetail extends SkillSummary {
  readonly source: ResourceSource
  readonly content: string
  readonly files: SkillFile[]
}

export interface McpSummary {
  readonly id: string
  readonly sourceId: string
  readonly name: string
  readonly transport: string
  readonly target: string
  readonly enabled: boolean
  readonly effective: boolean | null
  readonly override: boolean
  readonly headerCount: number
}

export interface McpDetail extends McpSummary {
  readonly source: ResourceSource
  readonly definition: Record<string, unknown>
  readonly effectiveDefinition: Record<string, unknown> | null
}

export class ResourceError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message)
    this.name = 'ResourceError'
  }
}
