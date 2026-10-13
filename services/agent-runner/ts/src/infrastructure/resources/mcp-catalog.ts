import { join, resolve } from 'node:path'

import { DefaultPackageManager, SettingsManager } from '@earendil-works/pi-coding-agent'
import { getMcpDiscoverySummary, loadMcpConfig } from 'pi-mcp-adapter/config'
import { isToolAllowed, resolveToolPrefix, type ToolPrefix } from 'pi-mcp-adapter/types'

import { ResourceError, type McpDetail, type McpSummary, type McpToolState, type ResourceList, type ResourceQuery, type ResourceSource, type ResourceScope } from '../../core/resource/resource-catalog.js'
import { ClaudeMcpPolicy, claudeMcpSettingsPath, claudeMcpToolName } from './claude-mcp-policy.js'
import { canonicalDirectory, inside, isRecord, record, resourceId, type ResourceFiles, strings } from './resource-files.js'
import { type ProjectDirectories } from './project-directories.js'
import { claudePlugins, pluginComponentPaths, source, type ResourceEnvironment } from './resource-sources.js'

interface McpBinding {
  source: ResourceSource
  definitions: Record<string, Record<string, unknown>>
  effective: Record<string, Record<string, unknown>>
  winners: Map<string, string>
  container: string[]
  enabled: boolean
  claude?: { policy: ClaudeMcpPolicy; path: string; writable: boolean }
  toolPrefix?: ToolPrefix
}

export interface McpWrite {
  readonly name: string
  readonly definition: Record<string, unknown>
  readonly sourceId?: string
  readonly scope?: ResourceScope
}

export function validateMcpDefinition(value: unknown, harness: 'claude' | 'pi', allowOverride = false): Record<string, unknown> {
  if (!isRecord(value)) throw new ResourceError(422, 'MCP definition must be a JSON object')
  const definition = structuredClone(value)
  const transports = ['command', 'url', 'socket'].filter((key) => typeof definition[key] === 'string' && definition[key].trim())
  if (transports.length > 1 || (!allowOverride && transports.length !== 1)) throw new ResourceError(422, 'Specify exactly one of command, url or socket')
  if (typeof definition['url'] === 'string' && !definition['url'].includes('${') && !definition['url'].includes('$env:')) {
    try { if (!['http:', 'https:', 'ws:', 'wss:'].includes(new URL(definition['url']).protocol)) throw new Error() } catch { throw new ResourceError(422, 'MCP URL must use HTTP, HTTPS or WebSocket') }
  }
  for (const key of ['command', 'url', 'socket', 'cwd', 'type']) {
    if (definition[key] !== undefined && typeof definition[key] !== 'string') throw new ResourceError(422, `${key} must be a string`)
  }
  if (definition['args'] !== undefined && (!Array.isArray(definition['args']) || definition['args'].some((arg) => typeof arg !== 'string'))) throw new ResourceError(422, 'args must be an array of strings')
  for (const key of ['headers', 'env']) {
    const field = definition[key]
    if (field !== undefined && (!isRecord(field) || Object.values(field).some((entry) => typeof entry !== 'string'))) throw new ResourceError(422, `${key} must be a string-to-string object`)
  }
  if (definition['disabled'] !== undefined && typeof definition['disabled'] !== 'boolean') throw new ResourceError(422, 'disabled must be a boolean')
  if (harness === 'pi' && definition['type'] !== undefined) {
    const { type, ...native } = definition
    if (!['stdio', 'http', 'sse', 'streamable-http'].includes(typeof type === 'string' ? type : '')) throw new ResourceError(422, 'Unsupported MCP transport type')
    if (definition['url'] !== undefined) native['httpTransport'] = type === 'sse' ? 'sse' : 'streamable-http'
    return native
  }
  if (harness === 'claude') {
    if (definition['socket'] !== undefined) throw new ResourceError(422, 'Claude does not support Pi Unix socket configuration')
    if (definition['disabled'] !== undefined) throw new ResourceError(422, 'Claude server enablement is managed by its native MCP policy, not a disabled field')
    if (definition['url'] !== undefined && definition['type'] === undefined) definition['type'] = 'http'
    if (definition['type'] !== undefined && !['stdio', 'http', 'sse'].includes(typeof definition['type'] === 'string' ? definition['type'] : '')) throw new ResourceError(422, 'Claude supports stdio, HTTP and SSE transport types')
  }
  return definition
}

export class McpCatalog {
  constructor(private readonly environment: ResourceEnvironment, private readonly files: ResourceFiles, private readonly projects: ProjectDirectories) {}

  async list(query: ResourceQuery): Promise<ResourceList<McpSummary>> {
    const { bindings, result } = await this.discover(query)
    for (const binding of bindings) {
      let group = result.groups.find((entry) => entry.source.id === binding.source.id)
      if (group === undefined) { group = { source: binding.source, items: [] }; result.groups.push(group) }
      for (const [name, definition] of Object.entries(binding.definitions)) {
        const item = this.summary(binding, name, definition, query.cwd !== undefined)
        if (!group.items.some((entry) => entry.id === item.id)) group.items.push(item)
      }
    }
    return result
  }

  async get(query: ResourceQuery, id: string): Promise<McpDetail> {
    const { binding, name, definition } = await this.find(query, id)
    return { ...this.summary(binding, name, definition, query.cwd !== undefined), source: binding.source, definition,
      effectiveDefinition: binding.effective[name] ?? null }
  }

  async create(query: ResourceQuery, input: McpWrite): Promise<McpDetail> {
    this.name(input.name)
    if (query.cwd !== undefined) query = { ...query, cwd: await canonicalDirectory(query.cwd) }
    const { bindings } = await this.discover(query)
    const scope = input.scope ?? 'global'
    const binding = input.sourceId !== undefined ? bindings.find((item) => item.source.id === input.sourceId) : bindings.find((item) =>
      item.source.scope === scope && item.source.origin === 'settings' && item.source.canAdd && (scope === 'global' || item.source.cwd === query.cwd))
    if (binding === undefined) throw new ResourceError(422, 'Select an available source; project sources require an absolute cwd')
    if (!binding.source.canAdd) throw new ResourceError(403, 'This source is read-only')
    const definition = validateMcpDefinition(input.definition, query.harness, query.harness === 'pi' && binding.effective[input.name] !== undefined)
    await this.files.update(binding.source.path, (value) => {
      const holder = this.holder(value, binding.container)
      const servers = record(holder[this.serversKey(holder)])
      if (Object.hasOwn(servers, input.name)) throw new ResourceError(409, 'An MCP server with this name already exists in this source')
      holder[this.serversKey(holder)] = { ...servers, [input.name]: definition }
    })
    return await this.get(query, resourceId(binding.source.id, input.name))
  }

  async update(query: ResourceQuery, id: string, definition: Record<string, unknown>): Promise<McpDetail> {
    const { binding, name } = await this.find(query, id)
    if (!binding.source.writable) throw new ResourceError(403, 'This MCP source is read-only')
    const next = validateMcpDefinition(definition, query.harness, query.harness === 'pi')
    await this.files.update(binding.source.path, (value) => {
      const holder = this.holder(value, binding.container)
      const key = this.serversKey(holder)
      const servers = record(holder[key])
      if (!Object.hasOwn(servers, name)) throw new ResourceError(409, 'MCP entry changed or was removed; refresh before saving')
      holder[key] = { ...servers, [name]: next }
    })
    return await this.get(query, id)
  }

  async delete(query: ResourceQuery, id: string): Promise<void> {
    const { binding, name } = await this.find(query, id)
    if (!binding.source.writable) throw new ResourceError(403, 'This MCP source is read-only')
    await this.files.update(binding.source.path, (value) => {
      const holder = this.holder(value, binding.container)
      const key = this.serversKey(holder)
      const servers = record(holder[key])
      holder[key] = Object.fromEntries(Object.entries(servers).filter(([key]) => key !== name))
    })
  }

  async toggle(query: ResourceQuery, id: string, enabled: boolean): Promise<McpDetail> {
    const { binding, name, definition } = await this.find(query, id)
    const state = this.summary(binding, name, definition, query.cwd !== undefined)
    if (!state.canToggle) throw new ResourceError(403, state.disabledReason ?? 'This MCP server cannot be toggled')
    if (binding.claude) {
      await this.files.update(binding.claude.path, (value) => {
        const denied = Array.isArray(value['deniedMcpServers']) ? value['deniedMcpServers'] : []
        value['deniedMcpServers'] = denied.filter((entry) => record(entry)['serverName'] !== name)
        if (!enabled) (value['deniedMcpServers'] as unknown[]).push({ serverName: name })
        if (enabled && binding.source.scope === 'project') value['disabledMcpjsonServers'] = strings(value['disabledMcpjsonServers']).filter((entry) => entry !== name)
      })
      if (enabled && binding.source.cwd) await this.files.update(this.environment.claudeConfigFilePath, (value) => {
        const project = record(record(value['projects'])[binding.source.cwd ?? ''])
        if (Array.isArray(project['disabledMcpServers'])) project['disabledMcpServers'] = strings(project['disabledMcpServers']).filter((entry) => entry !== name)
      })
    } else await this.editDefinition(binding, name, (value) => { value['disabled'] = !enabled })
    return await this.get(query, id)
  }

  async tools(query: ResourceQuery, id: string, names: string[]): Promise<McpToolState[]> {
    const { binding, name } = await this.find(query, id)
    return names.map((tool) => this.toolState(binding, name, tool))
  }

  async toggleTool(query: ResourceQuery, id: string, tool: string, enabled: boolean): Promise<McpToolState> {
    if (!tool || tool.length > 200 || /[\s*()\0]/u.test(tool)) throw new ResourceError(422, 'Expected an exact MCP tool name without permission patterns')
    const { binding, name, definition } = await this.find(query, id)
    if (!this.summary(binding, name, definition, query.cwd !== undefined).enabled) throw new ResourceError(409, 'Enable this MCP server before changing its tools')
    const state = this.toolState(binding, name, tool)
    if (!state.canToggle) throw new ResourceError(403, state.disabledReason ?? 'This MCP tool cannot be toggled')
    if (binding.claude) {
      const rule = claudeMcpToolName(name, tool)
      await this.files.update(binding.claude.path, (value) => {
        const permissions = record(value['permissions'])
        const deny = strings(permissions['deny']).filter((entry) => entry !== rule)
        if (!enabled) deny.push(rule)
        value['permissions'] = { ...permissions, deny }
      })
    } else await this.editDefinition(binding, name, (value) => {
      const excluded = strings(value['excludeTools'] ?? binding.effective[name]?.['excludeTools']).filter((entry) => entry !== tool)
      if (!enabled) excluded.push(tool)
      value['excludeTools'] = excluded
    })
    const current = await this.find(query, id)
    return this.toolState(current.binding, current.name, tool)
  }

  private async editDefinition(binding: McpBinding, name: string, edit: (value: Record<string, unknown>) => void): Promise<void> {
    await this.files.update(binding.source.path, (value) => {
      const holder = this.holder(value, binding.container)
      const servers = record(holder[this.serversKey(holder)])
      if (!isRecord(servers[name])) throw new ResourceError(409, 'MCP entry changed or was removed; refresh before saving')
      edit(servers[name])
    })
  }

  private toolState(binding: McpBinding, server: string, name: string): McpToolState {
    if (binding.claude) return binding.claude.policy.tool(server, name, binding.claude.path, binding.claude.writable)
    const definition = binding.effective[server] ?? binding.definitions[server] ?? {}
    const prefix = resolveToolPrefix(definition, binding.toolPrefix)
    const allowed = (excluded: unknown) => isToolAllowed(name, server, prefix, definition['includeTools'], excluded)
    const enabled = allowed(definition['excludeTools'])
    const own = strings(binding.definitions[server]?.['excludeTools'])
    const canToggle = binding.source.writable && binding.winners.get(server) === binding.source.id && allowed(strings(definition['excludeTools']).filter((entry) => entry !== name || !own.includes(name)))
    return { name, enabled, canToggle, disabledReason: !canToggle ? 'Controlled by a read-only source or a broader tool filter' : enabled ? null : 'Excluded in this MCP configuration' }
  }

  private name(name: string): void {
    if (!name.trim() || name.length > 200 || /[\s/\\\0]/u.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new ResourceError(422, 'MCP name must be 1–200 characters without whitespace or path separators')
  }

  private serversKey(value: Record<string, unknown>): string {
    return value['mcpServers'] === undefined && isRecord(value['mcp-servers']) ? 'mcp-servers' : 'mcpServers'
  }

  private holder(value: Record<string, unknown>, path: string[]): Record<string, unknown> {
    let current = value
    for (const part of path) {
      const next = record(current[part])
      current[part] = next
      current = next
    }
    return current
  }

  private summary(binding: McpBinding, name: string, definition: Record<string, unknown>, contextual: boolean): McpSummary {
    const effective = binding.effective[name] ?? definition
    const enabled = binding.enabled && effective['disabled'] !== true
    const state = binding.claude ? binding.claude.policy.server(name, !contextual && binding.source.scope === 'global' ? definition : effective, binding.source, binding.claude.path, binding.enabled, binding.claude.writable)
      : { enabled, canToggle: binding.source.writable && binding.winners.get(name) === binding.source.id,
        disabledReason: binding.winners.get(name) !== binding.source.id ? 'Controlled by a higher-precedence MCP configuration' : enabled ? null : 'Disabled in the effective MCP configuration' }
    return { id: resourceId(binding.source.id, name), sourceId: binding.source.id, name,
      transport: typeof definition['command'] === 'string' ? 'stdio' : typeof definition['url'] === 'string' ? definition['httpTransport'] === 'sse' || definition['type'] === 'sse' ? 'sse' : 'http' : typeof definition['socket'] === 'string' ? 'socket' : 'override',
      target: [definition['url'], definition['command'], definition['socket']].find((value): value is string => typeof value === 'string') ?? '',
      ...state,
      effective: contextual ? binding.enabled && binding.winners.get(name) === binding.source.id : null,
      override: binding.effective[name] !== undefined && JSON.stringify(binding.effective[name]) !== JSON.stringify(definition),
      headerCount: Object.keys(record(definition['headers'])).length }
  }

  private async find(query: ResourceQuery, id: string): Promise<{ binding: McpBinding; name: string; definition: Record<string, unknown> }> {
    for (const binding of (await this.discover(query)).bindings) {
      for (const [name, definition] of Object.entries(binding.definitions)) {
        if (resourceId(binding.source.id, name) === id) return { binding, name, definition }
      }
    }
    throw new ResourceError(404, 'MCP server no longer exists in this context')
  }

  private async discover(query: ResourceQuery): Promise<{ bindings: McpBinding[]; result: ResourceList<McpSummary> }> {
    const contexts = await this.projects.list(query.harness, query.cwd)
    const projects = [...new Set([...await this.projects.list(query.harness), ...contexts])]
    const result: ResourceList<McpSummary> = { projects, groups: [], diagnostics: [] }
    const bindings: McpBinding[] = []
    for (const cwd of contexts) {
      const current: McpBinding[] = []
      const add = async (origin: ResourceSource, container: string[] = [], enabled = true, prefix = '', inline?: Record<string, unknown>) => {
        try {
          const raw = inline ?? this.holder(await this.files.json(origin.path), container)
          const definitions = Object.fromEntries(Object.entries(record(raw[this.serversKey(raw)])).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1])).map(([name, definition]) => [prefix + (origin.harness === 'pi' && prefix ? normalizeName(name, 'server') : name), definition]))
          current.push({ source: origin, container, definitions, effective: {}, winners: new Map(), enabled })
        } catch (error) { result.diagnostics.push({ path: origin.path, message: error instanceof Error ? error.message : 'Cannot read configuration' }) }
      }

      if (query.harness === 'claude') {
        for (const plugin of await claudePlugins(this.files, this.environment, cwd, result.diagnostics)) {
          const name = plugin.name.split('@')[0] ?? plugin.name
          const manifestMcp = plugin.manifest['mcpServers']
          for (const path of pluginComponentPaths(plugin, 'mcpServers', '.mcp.json')) {
            await add(await source('claude', plugin.scope, 'plugin', path, plugin.cwd, plugin.name), [], plugin.enabled, `plugin:${name}:`)
          }
          if (isRecord(manifestMcp)) await add(await source('claude', plugin.scope, 'plugin', join(plugin.path, '.claude-plugin/plugin.json'), plugin.cwd, plugin.name), [], plugin.enabled, `plugin:${name}:`, { mcpServers: manifestMcp })
        }
        const globalPath = this.environment.claudeConfigFilePath
        await add(await source('claude', 'global', 'settings', globalPath, null, 'Global · Claude MCP', true, true))
        await add(await source('claude', 'project', 'settings', join(cwd, '.mcp.json'), cwd, `Project · ${cwd}`, true, true))
        await add(await source('claude', 'local', 'settings', globalPath, cwd, `Local · ${cwd}`, true, true), ['projects', cwd])
        const effective: Record<string, Record<string, unknown>> = {}
        const winners = new Map<string, string>()
        for (const binding of current) if (binding.enabled) for (const [name, definition] of Object.entries(binding.definitions)) { effective[name] = definition; winners.set(name, binding.source.id) }
        for (const binding of current) { binding.effective = effective; binding.winners = winners }
        const policy = await ClaudeMcpPolicy.read(this.environment, this.files, cwd, false)
        const globalPolicy = query.cwd === undefined ? await ClaudeMcpPolicy.read(this.environment, this.files, cwd, true) : policy
        for (const binding of current) {
          const path = claudeMcpSettingsPath(this.environment, binding.source)
          const settingsSource = await source('claude', binding.source.scope, 'settings', path, binding.source.cwd, '', true)
          binding.claude = { policy: binding.source.scope === 'global' ? globalPolicy : policy, path, writable: binding.source.writable && settingsSource.writable }
        }
      } else {
        const configPath = join(this.environment.piDir, 'mcp.json')
        // Read-only public API: no adapter factory, model, package install, or MCP connection.
        const summary = getMcpDiscoverySummary(configPath, cwd, { includeHostConfigs: true })
        const config = loadMcpConfig(configPath, cwd)
        const effective = config.mcpServers as Record<string, Record<string, unknown>>
        const imports = new Set<string>()
        let agentPluginScope: 'global' | 'project' = 'global'
        for (const item of summary.sources) {
          try {
            const config = await this.files.json(item.path)
            for (const kind of strings(config['imports'])) imports.add(kind)
            if (Array.isArray(record(config['settings'])['agentPluginPaths'])) agentPluginScope = item.scope
          } catch (error) {
            result.diagnostics.push({ path: item.path, message: error instanceof Error ? error.message : 'Cannot read configuration' })
          }
        }
        for (const item of summary.imports) {
          if (summary.hostConfigDiscovery !== 'on' && !imports.has(item.kind)) continue
          const projectImport = item.path === join(cwd, '.vscode/mcp.json') || item.path === join(cwd, 'opencode.json')
          await add(await source('pi', projectImport ? 'project' : 'global', 'import', item.path, projectImport ? cwd : null, `Import · ${item.kind}`))
        }
        const settingsManager = SettingsManager.create(cwd, this.environment.piDir)
        const manager = new DefaultPackageManager({ cwd, agentDir: this.environment.piDir, settingsManager })
        const packages = manager.listConfiguredPackages()
        for (const item of packages) {
          if (item.installedPath === undefined) continue
          const manifest = await this.files.json(join(item.installedPath, 'package.json'))
          const paths = record(manifest['pi'])['mcp']
          const name = normalizeName(typeof manifest['name'] === 'string' ? manifest['name'] : '', 'package')
          for (const path of typeof paths === 'string' ? [paths] : strings(paths)) {
            const absolute = resolve(item.installedPath, path)
            if (!inside(item.installedPath, absolute)) continue
            await add(await source('pi', item.scope === 'user' ? 'global' : 'project', 'package', absolute, item.scope === 'user' ? null : cwd, item.source), [], true, `${name}__`)
          }
        }
        for (const item of summary.agentPlugins) {
          const plugin = record(item)
          if (typeof plugin['path'] !== 'string' || typeof plugin['name'] !== 'string') continue
          await add(await source('pi', agentPluginScope, 'plugin', join(plugin['path'], 'mcp.json'), agentPluginScope === 'global' ? null : cwd, plugin['name']), [], true, `${normalizeName(plugin['name'], 'plugin')}__`)
        }
        for (const item of summary.sources) {
          await add(await source('pi', item.scope, item.kind === 'pi' ? 'settings' : 'shared', item.path, item.scope === 'global' ? null : cwd, item.scope === 'global' ? item.label : `${item.label} · ${cwd}`, true, true))
        }
        const winners = new Map<string, string>()
        for (const binding of current) for (const name of Object.keys(binding.definitions)) {
          if (effective[name] !== undefined) winners.set(name, binding.source.id)
        }
        const unresolved = Object.fromEntries(Object.entries(effective).filter(([name]) => !winners.has(name)))
        if (Object.keys(unresolved).length > 0) {
          const unresolvedSource = await source('pi', 'project', 'import', '', cwd, 'Adapter-resolved sources')
          current.push({ source: unresolvedSource, container: [], definitions: unresolved, effective, winners, enabled: true })
          for (const name of Object.keys(unresolved)) winners.set(name, unresolvedSource.id)
          result.diagnostics.push({ path: configPath, message: 'Some adapter-resolved entries have no public file provenance and are read-only' })
        }
        for (const binding of current) { binding.effective = effective; binding.winners = winners; binding.toolPrefix = config.settings?.toolPrefix ?? 'server' }
      }
      bindings.push(...current)
    }
    return { bindings, result }
  }
}

// Namespacing is part of adapter 2.32.1's public server identity; merge semantics remain in loadMcpConfig.
function normalizeName(name: string, fallback: string): string {
  return name.replace(/[^A-Za-z0-9_-]+/gu, '_').replace(/^[_-]+|[_-]+$/gu, '') || fallback
}
