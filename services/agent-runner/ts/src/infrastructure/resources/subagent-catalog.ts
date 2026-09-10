import { basename, join } from 'node:path'
import { lstat } from 'node:fs/promises'

import type { SubagentCatalog as Catalog, SubagentDetail, SubagentDraft, SubagentSummary } from '../../core/resource/agent-resources.js'
import { ResourceError, type ResourceDiagnostic, type ResourceList, type ResourceQuery, type ResourceSource } from '../../core/resource/resource-catalog.js'
import { parsePiAgent, piDefaultAgents, subagentsRoot } from './pi-resource-modules.js'
import type { ProjectDirectories } from './project-directories.js'
import { resourceId, type ResourceFiles } from './resource-files.js'
import { agentMarkdown, markdownPaths, parseMarkdown, ResourceMarkdown } from './resource-markdown.js'
import { ancestors, claudePlugins, pluginComponentPaths, source, type ResourceEnvironment } from './resource-sources.js'

export class SubagentCatalog {
  private readonly markdown = new ResourceMarkdown()

  constructor(private readonly environment: ResourceEnvironment, private readonly files: ResourceFiles, private readonly projects: ProjectDirectories) {}

  catalog(query: ResourceQuery): Catalog {
    return query.harness === 'claude' ? {
      tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Agent'],
      fields: ['name', 'description', 'model', 'tools', 'disallowedTools', 'skills', 'mcpServers', 'permissionMode', 'maxTurns', 'memory', 'background', 'isolation', 'hooks'],
      memoryScopes: ['user', 'project', 'local'], modelHint: 'inherit, sonnet, opus, haiku, or a model ID',
    } : {
      tools: ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls'],
      fields: ['name', 'description', 'model', 'tools', 'display_name', 'disallowed_tools', 'extensions', 'exclude_extensions', 'skills', 'thinking', 'max_turns', 'memory', 'run_in_background', 'inherit_context', 'prompt_mode', 'allowed_subagents', 'isolation', 'enabled', 'persist_session', 'output_transcript', 'session_dir'],
      memoryScopes: ['user', 'project', 'local'], modelHint: 'provider/model ID; omit to inherit the parent model',
    }
  }

  async list(query: ResourceQuery): Promise<ResourceList<SubagentSummary>> {
    const { groups, diagnostics, projects } = await this.discover(query)
    return { groups: groups.map((group) => ({ source: group.source, items: group.items.map(({ definition: _definition, prompt: _prompt, revision: _revision, source: _source, ...item }) => {
      void _definition; void _prompt; void _revision; void _source
      return item
    }) })), diagnostics, projects }
  }

  async get(query: ResourceQuery, id: string): Promise<SubagentDetail> {
    const found = (await this.discover(query)).groups.flatMap((group) => group.items).find((item) => item.id === id)
    if (!found) throw new ResourceError(404, 'Subagent not found in the selected harness and project')
    return found
  }

  async memoryDeclarations(query: ResourceQuery): Promise<SubagentDetail[]> {
    return (await this.discover(query)).groups.flatMap((group) => group.items).filter((item) => ['user', 'project', 'local'].includes(String(item.definition['memory'])))
  }

  async create(query: ResourceQuery, input: SubagentDraft & { sourceId: string }): Promise<SubagentDetail> {
    const group = (await this.discover(query)).groups.find((group) => group.source.id === input.sourceId)
    if (!group) throw new ResourceError(404, 'Subagent source not found')
    if (!group.source.canAdd) throw new ResourceError(403, 'This source is read-only')
    const name = this.validate(query, input)
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/u.test(name)) throw new ResourceError(422, 'New agent names must use letters, numbers, hyphens or underscores')
    if (group.items.some((item) => item.name === name)) throw new ResourceError(409, 'An agent with this name already exists in this source')
    const path = join(group.source.path, `${name}.md`)
    await this.markdown.write(path, agentMarkdown(input.definition, input.prompt))
    return await this.get(query, resourceId(group.source.id, path))
  }

  async update(query: ResourceQuery, id: string, input: SubagentDraft & { revision: string }): Promise<SubagentDetail> {
    const detail = await this.get(query, id)
    if (!detail.source.writable) throw new ResourceError(403, 'This source is read-only')
    const name = this.validate(query, input)
    const siblings = (await this.list(query)).groups.find((group) => group.source.id === detail.sourceId)?.items ?? []
    if (siblings.some((item) => item.id !== id && item.name === name)) throw new ResourceError(409, 'An agent with this name already exists in this source')
    await this.markdown.write(detail.path, agentMarkdown(input.definition, input.prompt), input.revision)
    return await this.get(query, id)
  }

  async delete(query: ResourceQuery, id: string, revision: string): Promise<void> {
    const detail = await this.get(query, id)
    if (!detail.source.writable) throw new ResourceError(403, 'This source is read-only')
    await this.markdown.delete(detail.path, revision)
  }

  private validate(query: ResourceQuery, input: SubagentDraft): string {
    const { definition } = input
    const name = definition['name']
    if (typeof name !== 'string' || !name.trim() || name.includes(':') || name.includes('\0') || name.length > 100) throw new ResourceError(422, 'Agent name is required and cannot contain a colon')
    if (typeof definition['description'] !== 'string' || !definition['description'].trim()) throw new ResourceError(422, 'Agent description is required')
    if (!input.prompt.trim()) throw new ResourceError(422, 'Agent prompt is required')
    const memory = definition['memory']
    if (memory !== undefined && (typeof memory !== 'string' || !['user', 'project', 'local'].includes(memory))) throw new ResourceError(422, 'memory must be user, project or local')
    for (const key of ['model', 'permissionMode', 'thinking', 'prompt_mode']) {
      if (definition[key] !== undefined && typeof definition[key] !== 'string') throw new ResourceError(422, `${key} must be a string`)
    }
    for (const key of ['tools', 'disallowedTools', 'disallowed_tools', 'exclude_extensions', 'allowed_subagents']) {
      const value = definition[key]
      if (value !== undefined && typeof value !== 'string' && !(Array.isArray(value) && value.every((item: unknown) => typeof item === 'string'))) throw new ResourceError(422, `${key} must be a string or an array of strings`)
    }
    for (const key of ['enabled', 'run_in_background', 'background', 'inherit_context', 'persist_session', 'output_transcript', 'isolated']) {
      if (definition[key] !== undefined && typeof definition[key] !== 'boolean') throw new ResourceError(422, `${key} must be a boolean`)
    }
    const promptMode = definition['prompt_mode']
    if (promptMode !== undefined && promptMode !== 'append' && promptMode !== 'replace') throw new ResourceError(422, 'prompt_mode must be append or replace')
    const turnsKey = query.harness === 'pi' ? 'max_turns' : 'maxTurns'
    const turns = definition[turnsKey]
    if (turns !== undefined && (typeof turns !== 'number' || !Number.isInteger(turns) || turns < 0)) throw new ResourceError(422, `${turnsKey} must be a non-negative integer`)
    const foreign = query.harness === 'pi' ? ['disallowedTools', 'maxTurns', 'background', 'permissionMode'] : ['disallowed_tools', 'max_turns', 'run_in_background', 'prompt_mode']
    for (const key of foreign) if (key in definition) throw new ResourceError(422, `${key} is not a ${query.harness} agent field; use the selected harness's catalog`)
    return name.trim()
  }

  private async discover(query: ResourceQuery) {
    const projects = await this.projects.list(query.harness)
    const selected = await this.projects.list(query.harness, query.cwd)
    const diagnostics: ResourceDiagnostic[] = []
    const groups: { source: ResourceSource; items: SubagentDetail[] }[] = []
    const add = async (entry: ResourceSource, namespace?: string, enabled = true) => {
      if (groups.some((group) => group.source.id === entry.id)) return
      const items: SubagentDetail[] = []
      groups.push({ source: entry, items })
      try {
        for (const path of await markdownPaths(entry.path, query.harness === 'claude')) {
          try {
            const { content, revision } = await this.markdown.read(path)
            const { definition, prompt } = query.harness === 'pi' ? await parsePiAgent(content) : parseMarkdown(content)
            const declared = typeof definition['name'] === 'string' ? definition['name'].trim() : ''
            if (declared.includes(':')) throw new Error('Agent name contains reserved colon')
            if (query.harness === 'claude' && (!declared || typeof definition['description'] !== 'string')) throw new Error('Claude agents require name and description')
            const name = `${namespace ? `${namespace}:` : ''}${declared || basename(path, '.md')}`
            const itemSource = (await lstat(path)).isSymbolicLink() ? { ...entry, writable: false, canAdd: false } : entry
            items.push({ id: resourceId(entry.id, path), sourceId: entry.id, source: itemSource, name, path, definition, prompt, revision,
              description: typeof definition['description'] === 'string' ? definition['description'] : name,
              model: typeof definition['model'] === 'string' ? definition['model'] : null,
              enabled: enabled && (query.harness !== 'pi' || definition['enabled'] !== false), effective: null })
          } catch (error) { diagnostics.push({ path, message: error instanceof Error ? error.message : 'Could not parse agent' }) }
        }
      } catch (error) { diagnostics.push({ path: entry.path, message: error instanceof Error ? error.message : 'Could not list agents' }) }
    }
    if (query.harness === 'pi') {
      const entry = { ...await source('pi', 'global', 'builtin', subagentsRoot, null, 'Default · pi-subagents'), level: 'default' }
      groups.push({ source: entry, items: [...await piDefaultAgents()].map(([name, agent]) => ({
        id: resourceId(entry.id, name), sourceId: entry.id, source: entry, name, description: agent.description, path: join(subagentsRoot, 'src/default-agents.ts'),
        model: agent.model ?? null, enabled: true, effective: null, revision: resourceId('pi-subagents@0.19.0', name), prompt: agent.systemPrompt,
        definition: { name, description: agent.description, ...(agent.model ? { model: agent.model } : {}), ...(agent.builtinToolNames ? { tools: agent.builtinToolNames } : {}), prompt_mode: agent.promptMode },
      })) })
      await add({ ...await source('pi', 'global', 'directory', join(this.environment.piDir, 'agents'), null, 'Global · agents', true, true), level: 'global' })
      for (const cwd of selected) {
        await add({ ...await source('pi', 'project', 'shared', join(cwd, '.agents/agents'), cwd, 'Project · .agents/agents'), level: 'project' })
        await add({ ...await source('pi', 'project', 'directory', join(cwd, '.pi/agents'), cwd, 'Project · .pi/agents', true, true), level: 'project' })
      }
      if (query.cwd !== undefined) {
        const settings = { ...await this.files.json(join(this.environment.piDir, 'subagents.json')), ...await this.files.json(join(selected[0] ?? query.cwd, '.pi/subagents.json')) }
        const defaults = groups[0]
        if (settings['disableDefaultAgents'] === true && defaults) defaults.items = defaults.items.map((item) => ({ ...item, enabled: false }))
      }
    } else {
      // Plugin names are namespaced, and native user/project files take precedence.
      for (const cwd of selected) {
        for (const plugin of await claudePlugins(this.files, this.environment, cwd, diagnostics)) {
          const namespace = typeof plugin.manifest['name'] === 'string' ? plugin.manifest['name'] : plugin.name.split('@')[0]
          for (const path of pluginComponentPaths(plugin, 'agents', 'agents')) await add({ ...await source('claude', plugin.scope, 'plugin', path, plugin.cwd, `Plugin · ${plugin.name}`), level: 'plugin' }, namespace, plugin.enabled)
        }
      }
      await add({ ...await source('claude', 'global', 'directory', join(this.environment.claudeDir, 'agents'), null, 'User · agents', true, true), level: 'user' })
      for (const cwd of selected) for (const parent of (await ancestors(cwd)).reverse()) {
        await add({ ...await source('claude', 'project', 'directory', join(parent, '.claude/agents'), parent, 'Project · .claude/agents', true, true), level: 'project' })
      }
    }
    if (query.cwd !== undefined) {
      const effective = new Map<string, SubagentDetail>()
      for (const group of groups) for (const item of group.items) effective.set(item.name, item)
      for (const group of groups) group.items = group.items.map((item) => ({ ...item, effective: effective.get(item.name)?.id === item.id && item.enabled }))
    }
    return { groups, diagnostics, projects: [...new Set([...selected, ...projects])] }
  }
}
