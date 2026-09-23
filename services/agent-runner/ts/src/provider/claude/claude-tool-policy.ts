import type { RunMode } from '../../core/resource/session.js'

export const CLAUDE_DISALLOWED_TOOLS = [
  'NotebookEdit', 'WebFetch', 'WebSearch', 'ScheduleWakeup', 'RemoteTrigger',
  'PushNotification', 'Artifact', 'Projects', 'DesignSync', 'ReadMcpResourceDirTool',
  'RefreshMcpTools', 'ShowOnboardingRolePicker',
] as const

export const CLAUDE_AGENT_DISALLOWED_TOOLS = [
  'EnterPlanMode', 'ExitPlanMode', 'EnterWorktree', 'ExitWorktree', 'ReportFindings',
] as const

export function claudeDisallowedTools(mode: RunMode | undefined): string[] {
  if (!mode) throw new Error('Claude requires a resolved session mode')
  return [...CLAUDE_DISALLOWED_TOOLS, ...(mode === 'agent' ? CLAUDE_AGENT_DISALLOWED_TOOLS : [])]
}
