import { encodeEvent } from '../../core/event/encode-event.js'
import type { StreamFrame } from '../../core/event/agent-event.js'

export function encodeSse(frame: StreamFrame): string {
  return `id: ${String(frame.seq)}\ndata: ${encodeEvent(frame)}\n\n`
}

export function encodeSsePing(): string {
  return `:ping\n\n`
}
