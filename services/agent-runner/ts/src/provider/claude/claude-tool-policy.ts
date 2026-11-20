import type { RunMode } from '../../core/resource/session.js'

export const CLAUDE_DISALLOWED_TOOLS = [
  'NotebookEdit', 'WebFetch', 'WebSearch', 'ScheduleWakeup', 'RemoteTrigger',
  'PushNotification', 'Artifact', 'Projects', 'DesignSync', 'ReadMcpResourceDirTool',
  'RefreshMcpTools', 'ShowOnboardingRolePicker', 'SendFeedback',
] as const

export const CLAUDE_AGENT_DISALLOWED_TOOLS = [
  'EnterPlanMode', 'ExitPlanMode', 'EnterWorktree', 'ExitWorktree', 'ReportFindings',
] as const

export function claudeReplWorkers(servers: readonly string[]): string[] {
  return servers.filter((name) => name === 'cua_repl' || name === 'node_repl')
}

export function claudeDisallowedTools(mode: RunMode | undefined, computerServers: readonly string[] = []): string[] {
  if (!mode) throw new Error('Claude requires a resolved session mode')
  return [...CLAUDE_DISALLOWED_TOOLS, ...(mode === 'agent' ? CLAUDE_AGENT_DISALLOWED_TOOLS : []),
    ...(computerServers.includes('cua_repl') ? ['mcp__cua_repl__js_add_node_module_dir'] : []),
    ...claudeReplWorkers(computerServers).map((worker) => `mcp__${worker}__turn_ended`)]
}
