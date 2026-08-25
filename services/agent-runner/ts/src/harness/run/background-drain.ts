import type { AgentEvent } from '../../core/event/agent-event.js'
import { isAgentName, isTerminalStatus, isWorkflowName } from '../../core/event/tool-names.js'

export { isAgentName, isTerminalStatus, isWorkflowName } from '../../core/event/tool-names.js'

export const DRAIN_IDLE_MS = 600_000
export const DRAIN_SETTLE_MS = 15_000

export interface BackgroundDrainOptions {
  readonly idleMs?: number
  readonly settleMs?: number
  readonly now?: () => number
}

export class BackgroundDrainTracker {
  private readonly idleMs: number
  private readonly settleMs: number
  private readonly now: () => number
  private readonly workflows = new Set<string>()
  private readonly agents = new Set<string>()
  private lastEventAt = 0
  private seenBackground = false

  constructor(options: BackgroundDrainOptions = {}) {
    this.idleMs = options.idleMs ?? DRAIN_IDLE_MS
    this.settleMs = options.settleMs ?? DRAIN_SETTLE_MS
    this.now = options.now ?? Date.now
  }

  observe(event: AgentEvent): void {
    this.lastEventAt = this.now()
    switch (event.type) {
      case 'tool.started':
        if (isWorkflowName(event.name)) {
          this.seenBackground = true
          this.workflows.add(event.id)
        }
        if (isAgentName(event.name)) {
          this.seenBackground = true
        }
        return
      case 'workflow.started':
        this.seenBackground = true
        this.workflows.add(event.workflowToolUseId)
        return
      case 'tool.completed':
        if (isWorkflowName(event.name) && !event.ok) {
          this.workflows.delete(event.id)
        }
        if (isAgentName(event.name)) {
          this.seenBackground = true
          if (event.status === 'async_launched' || event.status === 'running') {
            this.agents.add(event.agentId ?? event.id)
          } else {
            this.agents.delete(event.agentId ?? event.id)
            this.agents.delete(event.id)
          }
        }
        return
      case 'workflow.completed':
        this.workflows.delete(event.workflowToolUseId)
        return
      case 'workflow.notification':
        if (isTerminalStatus(event.status)) {
          if (event.workflowToolUseId !== undefined) {
            this.workflows.delete(event.workflowToolUseId)
          }
          this.agents.delete(event.taskId)
        }
        return
      case 'agent.started':
        this.seenBackground = true
        this.agents.add(event.agentId)
        return
      case 'agent.completed':
        this.agents.delete(event.agentId)
        return
      default:
        return
    }
  }

  hasOutstanding(): boolean {
    return this.workflows.size > 0 || this.agents.size > 0
  }

  hadBackgroundWork(): boolean {
    return this.seenBackground
  }

  remainingWaitMs(seenResult: boolean): number | undefined {
    if (!seenResult) return undefined
    if (!this.seenBackground) return 0
    const idle = this.now() - this.lastEventAt
    if (this.hasOutstanding()) return Math.max(0, this.idleMs - idle)
    return Math.max(0, this.settleMs - idle)
  }

  shouldClose(seenResult: boolean): boolean {
    if (!seenResult) return false
    if (!this.seenBackground) return true
    const idle = this.now() - this.lastEventAt
    if (this.hasOutstanding()) return idle >= this.idleMs
    return idle >= this.settleMs
  }
}
