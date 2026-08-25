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

export function isAgentName(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  return normalized === 'agent' || normalized === 'task'
}

export function isWorkflowName(name: string): boolean {
  return name.trim().toLowerCase() === 'workflow'
}

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status.trim().toLowerCase())
}
