import type { ProviderId } from '../../core/contract/agent-provider.js'
import type { ResourceService } from '../../core/contract/resource-service.js'
import { ResourceError, type ResourceQuery } from '../../core/resource/resource-catalog.js'
import { McpCatalog, validateMcpDefinition } from './mcp-catalog.js'
import { McpProbe } from './mcp-probe.js'
import { ProjectDirectories } from './project-directories.js'
import { canonicalDirectory, ResourceFiles } from './resource-files.js'
import type { ResourceEnvironment } from './resource-sources.js'
import { downloadSkillArchive, readSkillArchive } from './skill-archives.js'
import { SkillCatalog } from './skill-catalog.js'

export class LocalResourceService implements ResourceService {
  readonly skills: SkillCatalog
  readonly mcp: McpCatalog
  private readonly probe = new McpProbe()

  constructor(private readonly options: ResourceEnvironment & { activeCwd: string; discoverProjects: (harness: ProviderId) => Promise<readonly string[]> }) {
    const files = new ResourceFiles()
    const projects = new ProjectDirectories(options.activeCwd, options.discoverProjects)
    this.skills = new SkillCatalog(options, files, projects)
    this.mcp = new McpCatalog(options, files, projects)
  }

  async uploadSkill(query: ResourceQuery, scope: 'global' | 'project', filename: string, data: Buffer) {
    return await this.skills.upload(query, scope, await readSkillArchive(filename, data))
  }

  async downloadSkill(query: ResourceQuery, id: string) {
    return await downloadSkillArchive(await this.skills.get(query, id))
  }

  async capabilities(query: ResourceQuery, input: { id?: string; definition?: Record<string, unknown> }) {
    const { definition, cwd } = await this.connection(query, input)
    return await this.probe.capabilities(definition, cwd)
  }

  async callTool(query: ResourceQuery, input: { id?: string; definition?: Record<string, unknown>; name: string; args: Record<string, unknown> }) {
    const { definition, cwd } = await this.connection(query, input)
    return await this.probe.call(definition, cwd, input.name, input.args)
  }

  private async connection(query: ResourceQuery, input: { id?: string; definition?: Record<string, unknown> }) {
    if (input.id !== undefined) {
      const detail = await this.mcp.get(query, input.id)
      const definition = detail.effectiveDefinition
      if (definition === null) throw new ResourceError(422, 'This server has no effective connection definition in the selected project')
      return { definition, cwd: await canonicalDirectory(query.cwd ?? detail.source.cwd ?? this.options.activeCwd) }
    }
    return { definition: validateMcpDefinition(input.definition, query.harness), cwd: await canonicalDirectory(query.cwd ?? this.options.activeCwd) }
  }
}
