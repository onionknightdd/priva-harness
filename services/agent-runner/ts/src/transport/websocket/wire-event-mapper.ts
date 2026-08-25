import { encodeEvent } from '../../core/event/encode-event.js'
import type { StreamFrame } from '../../core/event/agent-event.js'

export function encodeServerFrame(frame: StreamFrame): string {
  return encodeEvent(frame)
}
