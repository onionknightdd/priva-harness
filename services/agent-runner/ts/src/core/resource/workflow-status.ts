import type { WorkflowState, WorkflowStatus } from './workflow.js'

export function workflowStatus(raw: string | undefined): WorkflowStatus {
  switch (raw) {
    case 'done': case 'complete': case 'completed': return 'completed'
    case 'error': case 'failed': return 'failed'
    case 'killed': case 'stopped': case 'aborted': case 'cancelled': return 'cancelled'
    case 'queued': case 'pending': return 'pending'
    case 'async_launched': case 'running': return 'running'
    case 'paused': return 'paused'
    default: return 'unknown'
  }
}


export function settleWorkflows(workflows: readonly WorkflowState[], status: 'cancelled' | 'failed'): readonly WorkflowState[] {
  return workflows.map((workflow) => ['running', 'pending', 'paused'].includes(workflow.status)
    ? { ...workflow, status, agents: workflow.agents.map((agent) =>
        ['running', 'pending', 'paused'].includes(agent.state)
          ? { ...agent, state: status === 'cancelled' ? 'cancelled' as const : 'unknown' as const }
          : agent) }
    : workflow)
}
