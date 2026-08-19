import type { AgentEvent } from '../../../core/event/agent-event.js'

export interface InitFrame {
  readonly type: 'init'
  readonly text: string
}

export type ServerFrame = AgentEvent & { readonly runId: string }

export interface ErrorFrame {
  readonly type: 'error'
  readonly message: string
}

export type ParseInitResult =
  | { readonly ok: true; readonly frame: InitFrame }
  | { readonly ok: false; readonly message: string }

export function parseInitFrame(raw: unknown): ParseInitResult {
  if (!isRecord(raw)) {
    return { ok: false, message: 'Init frame must be a JSON object' }
  }
  if (raw['type'] !== 'init') {
    return { ok: false, message: 'First message must be type init' }
  }
  const text = raw['text']
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, message: 'Init text must be a non-empty string' }
  }
  return { ok: true, frame: { type: 'init', text } }
}

export function toServerFrame(event: AgentEvent, runId: string): ServerFrame {
  return { ...event, runId }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
