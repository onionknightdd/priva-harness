import type { AgentEvent } from '../../core/event/agent-event.js'
import { toServerFrame } from './schema/run-frames.js'

export { toServerFrame }

export function encodeServerFrame(event: AgentEvent, runId: string): string {
  return JSON.stringify(toServerFrame(event, runId))
}
