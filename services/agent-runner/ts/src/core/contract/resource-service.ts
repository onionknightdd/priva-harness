import type { McpDetail, McpSummary, ResourceList, ResourceQuery, ResourceScope, SkillDetail, SkillSummary } from '../resource/resource-catalog.js'
import type { AutoMemoryProject, MemoryDetail, MemoryList, SubagentCatalog, SubagentDetail, SubagentDraft, SubagentSummary } from '../resource/agent-resources.js'

export interface McpCapabilities {
  readonly tools: Record<string, unknown>[]
  readonly resources: Record<string, unknown>[]
  readonly prompts: Record<string, unknown>[]
  readonly testedAt: string
}

export interface ResourceService {
  readonly subagents: {
    catalog(query: ResourceQuery): SubagentCatalog
    list(query: ResourceQuery): Promise<ResourceList<SubagentSummary>>
    get(query: ResourceQuery, id: string): Promise<SubagentDetail>
    create(query: ResourceQuery, input: SubagentDraft & { sourceId: string }): Promise<SubagentDetail>
    update(query: ResourceQuery, id: string, input: SubagentDraft & { revision: string }): Promise<SubagentDetail>
    delete(query: ResourceQuery, id: string, revision: string): Promise<void>
  }
  readonly memory: {
    list(query: ResourceQuery): Promise<MemoryList>
    get(query: ResourceQuery, id: string): Promise<MemoryDetail>
    update(query: ResourceQuery, id: string, content: string, revision: string): Promise<MemoryDetail>
    delete(query: ResourceQuery, id: string, revision: string): Promise<void>
    toggle(query: ResourceQuery, enabled: boolean): Promise<AutoMemoryProject>
  }
  readonly skills: {
    list(query: ResourceQuery): Promise<ResourceList<SkillSummary>>
    get(query: ResourceQuery, id: string): Promise<SkillDetail>
    file(query: ResourceQuery, id: string, path: string): Promise<{ path: string; content: string }>
    asset(query: ResourceQuery, id: string, path: string): Promise<{ data: Buffer; mediaType: string }>
    toggle(query: ResourceQuery, id: string, enabled: boolean): Promise<SkillDetail>
    delete(query: ResourceQuery, id: string): Promise<void>
  }
  readonly mcp: {
    list(query: ResourceQuery): Promise<ResourceList<McpSummary>>
    get(query: ResourceQuery, id: string): Promise<McpDetail>
    create(query: ResourceQuery, input: { name: string; definition: Record<string, unknown>; sourceId?: string; scope?: ResourceScope }): Promise<McpDetail>
    update(query: ResourceQuery, id: string, definition: Record<string, unknown>): Promise<McpDetail>
    delete(query: ResourceQuery, id: string): Promise<void>
  }
  uploadSkill(query: ResourceQuery, scope: 'global' | 'project', filename: string, data: Buffer): Promise<SkillDetail>
  downloadSkill(query: ResourceQuery, id: string): Promise<{ filename: string; data: Uint8Array }>
  capabilities(query: ResourceQuery, input: { id?: string; definition?: Record<string, unknown> }): Promise<McpCapabilities>
  callTool(query: ResourceQuery, input: { id?: string; definition?: Record<string, unknown>; name: string; args: Record<string, unknown> }): Promise<unknown>
}
