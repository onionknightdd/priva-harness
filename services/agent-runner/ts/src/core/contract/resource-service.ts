import type { McpDetail, McpSummary, ResourceList, ResourceQuery, ResourceScope, SkillDetail, SkillSummary } from '../resource/resource-catalog.js'

export interface McpCapabilities {
  readonly tools: Record<string, unknown>[]
  readonly resources: Record<string, unknown>[]
  readonly prompts: Record<string, unknown>[]
  readonly testedAt: string
}

export interface ResourceService {
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
