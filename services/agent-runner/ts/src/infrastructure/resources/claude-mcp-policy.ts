import { join } from 'node:path'

import { resolveSettings, type ResolvedSettings, type Settings } from '@anthropic-ai/claude-agent-sdk'

import type { McpToggleState, McpToolState, ResourceSource } from '../../core/resource/resource-catalog.js'
import { record, strings, type ResourceFiles } from './resource-files.js'
import type { ResourceEnvironment } from './resource-sources.js'

type ServerRule = NonNullable<Settings['deniedMcpServers']>[number]
interface Block { reason: string; removable: boolean }

export function claudeMcpSettingsPath(environment: ResourceEnvironment, origin: ResourceSource): string {
  return origin.scope === 'global' ? join(environment.claudeDir, 'settings.json')
    : join(origin.cwd ?? '', '.claude', origin.scope === 'local' ? 'settings.local.json' : 'settings.json')
}

// Claude normalizes server and tool identifiers before constructing permission names.
export function claudeMcpToolName(server: string, tool: string): string {
  return `mcp__${server.replace(/[^a-zA-Z0-9_-]/gu, '_')}__${tool.replace(/[^a-zA-Z0-9_-]/gu, '_')}`
}

function glob(pattern: string, value: string): boolean {
  return new RegExp(`^${pattern.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('.*')}$`, 'u').test(value)
}

function expand(value: string): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/gu,
    (match: string, key: string, fallback: string | undefined) => process.env[key] ?? fallback ?? match)
}

function urlMatches(pattern: string, value: string): boolean {
  const parts = /^(\*|https?|wss?):\/\/(\[[^\]]+\]|[^/:]+)(?::([^/]+))?(\/.*)?$/u.exec(pattern)
  if (!parts) return false
  let url: URL
  try { url = new URL(value) } catch { return false }
  const [, scheme = '', hostname = '', port, path] = parts
  if (scheme !== '*' && url.protocol !== `${scheme}:`) return false
  if (!glob(hostname.toLowerCase().replace(/\.$/u, ''), url.hostname.toLowerCase().replace(/\.$/u, ''))) return false
  const defaultPort = ['https:', 'wss:'].includes(url.protocol) ? '443' : '80'
  if (port !== '*' && !(port === undefined && hostname.includes('*')) && (url.port || defaultPort) !== (port ?? defaultPort)) return false
  return path === undefined || glob(path, `${url.pathname}${url.search}`)
}

function serverMatches(rule: ServerRule, name: string, definition: Record<string, unknown>): boolean {
  if (rule.serverName !== undefined) return rule.serverName === name
  if (rule.serverCommand !== undefined && typeof definition['command'] === 'string') {
    const command = [definition['command'], ...strings(definition['args'])].map(expand)
    return command.length === rule.serverCommand.length && rule.serverCommand.every((part, index) => expand(part) === command[index])
  }
  return rule.serverUrl !== undefined && typeof definition['url'] === 'string' && urlMatches(expand(rule.serverUrl), expand(definition['url']))
}

function toggleState(blocks: Block[], writable: boolean): McpToggleState {
  const locked = blocks.find((block) => !block.removable)
  return { enabled: blocks.length === 0, canToggle: writable && locked === undefined,
    disabledReason: locked?.reason ?? (!writable ? 'This configuration is read-only' : blocks[0]?.reason ?? null) }
}

/** Reads native settings and /mcp choices; no connections or model requests. */
export class ClaudeMcpPolicy {
  private constructor(private readonly resolved: ResolvedSettings, private readonly disabled: string[], private readonly cwd: string) {}

  static async read(environment: ResourceEnvironment, files: ResourceFiles, cwd: string, globalOnly: boolean): Promise<ClaudeMcpPolicy> {
    const resolved = await resolveSettings({ cwd, settingSources: globalOnly ? ['user'] : ['user', 'project', 'local'] })
    const config = await files.json(environment.claudeConfigFilePath)
    const project = record(record(config['projects'])[cwd])
    return new ClaudeMcpPolicy(resolved, globalOnly ? [] : strings(project['disabledMcpServers']), cwd)
  }

  server(name: string, definition: Record<string, unknown>, origin: ResourceSource, settingsPath: string, available: boolean, writable: boolean): McpToggleState {
    const blocks: Block[] = []
    if (!available) blocks.push({ reason: 'The source plugin is disabled', removable: false })
    if (this.disabled.includes(name)) blocks.push({ reason: `Disabled in Claude /mcp for ${this.cwd}`, removable: origin.scope !== 'global' && origin.cwd === this.cwd })
    for (const entry of this.resolved.sources) {
      const location = entry.path ?? entry.source
      for (const rule of entry.settings.deniedMcpServers ?? []) {
        if (serverMatches(rule, name, definition)) blocks.push({ reason: `deniedMcpServers in ${location}`,
          removable: entry.path === settingsPath && rule.serverName === name })
      }
      if (origin.scope === 'project' && origin.origin === 'settings' && entry.settings.disabledMcpjsonServers?.includes(name)) {
        blocks.push({ reason: `disabledMcpjsonServers in ${location}`, removable: entry.path === settingsPath })
      }
    }
    const allowSources = this.resolved.effective.allowManagedMcpServersOnly
      ? this.resolved.sources.filter((entry) => entry.source === 'managed') : this.resolved.sources
    const lists = allowSources.flatMap((entry) => entry.settings.allowedMcpServers === undefined ? [] : [entry.settings.allowedMcpServers])
    if (lists.length > 0) {
      const allowed = lists.flat()
      const key = typeof definition['command'] === 'string' ? 'serverCommand' : 'serverUrl'
      const specific = allowed.filter((entry) => entry[key] !== undefined)
      if (!(specific.length ? specific : allowed).some((rule) => serverMatches(rule, name, definition))) {
        blocks.push({ reason: 'Not permitted by allowedMcpServers', removable: false })
      }
    }
    return toggleState(blocks, writable)
  }

  tool(server: string, name: string, settingsPath: string, writable: boolean): McpToolState {
    const canonical = claudeMcpToolName(server, name)
    const prefix = claudeMcpToolName(server, '').slice(0, -2)
    const blocks: Block[] = []
    const managedOnly = this.resolved.effective.allowManagedPermissionRulesOnly === true
    for (const entry of this.resolved.sources) {
      if (managedOnly && entry.source !== 'managed') continue
      for (const rule of entry.settings.permissions?.deny ?? []) {
        if (rule === prefix || glob(rule, canonical)) blocks.push({ reason: `${rule} in ${entry.path ?? entry.source}`,
          removable: entry.path === settingsPath && rule === canonical })
      }
    }
    const state = toggleState(blocks, writable && !managedOnly)
    return { name, ...state, disabledReason: managedOnly ? 'Tool permissions are controlled by managed settings' : state.disabledReason }
  }
}
