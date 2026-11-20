import type { PluginMcpServer } from '../../core/plugin/plugin-mcp.js'
import type { RunMode } from '../../core/resource/session.js'

export const CLAUDE_DISALLOWED_TOOLS = [
  'NotebookEdit', 'WebFetch', 'WebSearch', 'ScheduleWakeup', 'RemoteTrigger',
  'PushNotification', 'Artifact', 'Projects', 'DesignSync', 'ReadMcpResourceDirTool',
  'RefreshMcpTools', 'ShowOnboardingRolePicker', 'SendFeedback',
] as const

export const CLAUDE_AGENT_DISALLOWED_TOOLS = [
  'EnterPlanMode', 'ExitPlanMode', 'EnterWorktree', 'ExitWorktree', 'ReportFindings',
] as const

/**
 * Plugin MCP servers in the shape Claude's SDK options and --mcp-config share.
 * A plugin the session enabled is meant to be used, and its skill names the
 * tools directly, so they are never deferred behind tool search.
 */
export function claudePluginMcpServers(servers: readonly PluginMcpServer[]): Record<string, {
  type: 'stdio'; command: string; args: string[]; env: Record<string, string>; alwaysLoad: true
}> {
  return Object.fromEntries(servers.map((server) => [server.name, {
    type: 'stdio' as const, command: server.command, args: [...server.args], env: { ...server.env }, alwaysLoad: true as const,
  }]))
}

export function claudeDisallowedTools(mode: RunMode | undefined, pluginServers: readonly PluginMcpServer[] = []): string[] {
  if (!mode) throw new Error('Claude requires a resolved session mode')
  return [...CLAUDE_DISALLOWED_TOOLS, ...(mode === 'agent' ? CLAUDE_AGENT_DISALLOWED_TOOLS : []),
    ...pluginServers.flatMap((server) => server.hiddenTools.map((tool) => `mcp__${server.name}__${tool}`))]
}
