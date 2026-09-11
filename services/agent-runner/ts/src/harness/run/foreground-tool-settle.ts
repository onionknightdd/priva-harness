import type { AgentEvent } from '../../core/event/agent-event.js'
import { isImageOutputToolName } from '../../core/event/tool-names.js'

export class ForegroundToolSettle {
  private readonly tools = new Set<string>()
  private used = false
  private lastEventAt = 0
  private readonly now: () => number
  private readonly settleMs: number
  constructor(options: { imageFollowUpSettleMs?: number; now?: () => number } = {}) {
    this.now = options.now ?? Date.now
    this.settleMs = options.imageFollowUpSettleMs ?? 500
  }
  observe(event: AgentEvent): void {
    this.lastEventAt = this.now()
    if (event.type === 'tool.started' && isImageOutputToolName(event.name)) {
      this.used = true; this.tools.add(event.id)
    }
    if (event.type === 'tool.completed') this.tools.delete(event.id)
  }
  hasOutstanding(): boolean { return this.tools.size > 0 }
  remainingWaitMs(seenResult: boolean): number | undefined {
    if (!seenResult || this.tools.size) return undefined
    return this.used ? Math.max(0, this.settleMs - (this.now() - this.lastEventAt)) : 0
  }
  shouldClose(seenResult: boolean): boolean { return this.remainingWaitMs(seenResult) === 0 }
}
