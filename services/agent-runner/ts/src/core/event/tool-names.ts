const TERMINAL_STATUSES = new Set([
  'completed',
  'complete',
  'failed',
  'error',
  'killed',
  'stopped',
  'cancelled',
  'canceled',
  'aborted',
])

export const VISUALIZE_TOOL_NAME = 'visualize'

const MCP_TOOL_NAME = /^mcp__[a-z0-9_-]+__(.+)$/

export function canonicalProductToolName(name: string): string {
  const lower = name.trim().toLowerCase()
  const stripped = stripMcpToolPrefix(lower)
  if (stripped === VISUALIZE_TOOL_NAME) return VISUALIZE_TOOL_NAME
  return lower
}

export function isVisualizeToolName(name: string): boolean {
  return canonicalProductToolName(name) === VISUALIZE_TOOL_NAME
}

function stripMcpToolPrefix(name: string): string {
  const match = MCP_TOOL_NAME.exec(name)
  const bare = match?.[1]
  return bare === undefined || bare === '' ? name : bare
}

export function isAgentName(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  return normalized === 'agent' || normalized === 'task'
}

export function isWorkflowName(name: string): boolean {
  return name.trim().toLowerCase() === 'workflow'
}

export function isReadToolName(name: string): boolean {
  return name.trim().toLowerCase() === 'read'
}

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status.trim().toLowerCase())
}
