import type { ProviderId } from '../contract/agent-provider.js'

export interface TokenUsage {
  readonly input: number
  readonly output: number
  readonly cacheRead?: number
  readonly cacheWrite?: number
}

export type AgentEvent =
  | { type: 'assistant'; event: 'thinking_delta'; text: string }
  | { type: 'assistant'; event: 'text_delta'; text: string }
  | { type: 'assistant'; event: 'message'; text: string }
  | { type: 'tool'; event: 'started'; id: string; name: string; input?: unknown }
  | { type: 'tool'; event: 'input_delta'; id: string; chunk: string }
  | { type: 'tool'; event: 'running'; id: string }
  | { type: 'tool'; event: 'progress'; id: string; channel: 'stdout' | 'stderr'; chunk: string }
  | {
      type: 'tool'
      event: 'completed'
      id: string
      name: string
      ok: boolean
      output: string
    }
  | { type: 'run'; event: 'started' }
  | {
      type: 'run'
      event: 'completed'
      sessionId: string
      harnessProvider: ProviderId
      model: string
      durationMs: number
      costUsd?: number
      usage?: TokenUsage
    }
  | {
      type: 'run'
      event: 'failed'
      message: string
      sessionId?: string
      harnessProvider: ProviderId
      model?: string
      durationMs?: number
      costUsd?: number
      usage?: TokenUsage
    }

export function isRunTerminalEvent(
  event: AgentEvent,
): event is Extract<AgentEvent, { type: 'run'; event: 'completed' | 'failed' }> {
  return event.type === 'run' && (event.event === 'completed' || event.event === 'failed')
}
