import type { StreamFrame } from './agent-event.js'

export function encodeEvent(frame: StreamFrame): string {
  return JSON.stringify(frame)
}
