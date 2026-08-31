import type { AgentEvent } from '../../core/event/agent-event.js'
import {
  isAgentName,
  isImageOutputToolName,
  isTerminalStatus,
  isWorkflowName,
} from '../../core/event/tool-names.js'

export { isAgentName, isTerminalStatus, isWorkflowName } from '../../core/event/tool-names.js'

export const DRAIN_IDLE_MS = 600_000
export const DRAIN_SETTLE_MS = 15_000
export const IMAGE_TRAIL_WAIT_MS = 2_000
export const IMAGE_TRAIL_SETTLE_MS = 400

export interface BackgroundDrainOptions {
  readonly idleMs?: number
  readonly settleMs?: number
  readonly imageTrailWaitMs?: number
  readonly imageTrailSettleMs?: number
  readonly now?: () => number
}

export class BackgroundDrainTracker {
  private readonly idleMs: number
  private readonly settleMs: number
  private readonly imageTrailWaitMs: number
  private readonly imageTrailSettleMs: number
  private readonly now: () => number
  private readonly workflows = new Set<string>()
  private readonly agents = new Set<string>()
  private lastEventAt = 0
  private seenBackground = false
  private seenImageTrail = false
  private seenImagePayload = false

  constructor(options: BackgroundDrainOptions = {}) {
    this.idleMs = options.idleMs ?? DRAIN_IDLE_MS
    this.settleMs = options.settleMs ?? DRAIN_SETTLE_MS
    this.imageTrailWaitMs = options.imageTrailWaitMs ?? IMAGE_TRAIL_WAIT_MS
    this.imageTrailSettleMs = options.imageTrailSettleMs ?? IMAGE_TRAIL_SETTLE_MS
    this.now = options.now ?? Date.now
  }

  observe(event: AgentEvent): void {
    this.lastEventAt = this.now()
    if (event.type === 'assistant.image_delta' || hasImageBlock(event)) {
      this.seenImageTrail = true
      this.seenImagePayload = true
    }
    switch (event.type) {
      case 'tool.started':
        if (isImageOutputToolName(event.name)) {
          this.seenImageTrail = true
        }
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
    const idle = this.now() - this.lastEventAt
    if (this.seenBackground) {
      if (this.hasOutstanding()) return Math.max(0, this.idleMs - idle)
      return Math.max(0, this.settleMs - idle)
    }
    if (this.seenImageTrail) {
      return Math.max(0, this.imageTrailBudgetMs() - idle)
    }
    return 0
  }

  shouldClose(seenResult: boolean): boolean {
    if (!seenResult) return false
    const idle = this.now() - this.lastEventAt
    if (this.seenBackground) {
      if (this.hasOutstanding()) return idle >= this.idleMs
      return idle >= this.settleMs
    }
    if (this.seenImageTrail) {
      return idle >= this.imageTrailBudgetMs()
    }
    return true
  }

  private imageTrailBudgetMs(): number {
    return this.seenImagePayload ? this.imageTrailSettleMs : this.imageTrailWaitMs
  }
}

function hasImageBlock(event: AgentEvent): boolean {
  if (event.type !== 'assistant.message') return false
  return event.blocks.some((block) => block.type === 'image')
}
