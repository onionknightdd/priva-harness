import type { ResourceList, ResourceSource } from './resource-catalog.js'

export interface SubagentSummary {
  readonly id: string
  readonly sourceId: string
  readonly name: string
  readonly description: string
  readonly path: string
  readonly model: string | null
  readonly enabled: boolean
  readonly effective: boolean | null
}

export interface SubagentDraft {
  readonly definition: Record<string, unknown>
  readonly prompt: string
}

export interface SubagentDetail extends SubagentSummary, SubagentDraft {
  readonly source: ResourceSource
  readonly revision: string
}

export interface SubagentCatalog {
  readonly tools: string[]
  readonly fields: string[]
  readonly memoryScopes: string[]
  readonly modelHint: string
}

export interface MemorySummary {
  readonly id: string
  readonly sourceId: string
  readonly name: string
  readonly path: string
  readonly kind: 'instruction' | 'auto' | 'agent'
  readonly exists: boolean
  readonly canDelete: boolean
  readonly size: number
  readonly enabled: boolean
}

export interface MemoryDetail extends MemorySummary {
  readonly source: ResourceSource
  readonly content: string
  readonly revision: string
}

export interface AutoMemoryProject {
  readonly sourceId: string
  readonly cwd: string
  readonly path: string
  readonly enabled: boolean
  readonly canToggle: boolean
  readonly settingsPath: string
  readonly reason: string | null
}

export interface MemoryList extends ResourceList<MemorySummary> {
  readonly autoMemory: AutoMemoryProject[]
}
