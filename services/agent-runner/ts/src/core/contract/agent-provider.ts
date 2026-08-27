import type { AgentEvent } from '../event/agent-event.js'
import type { UserTurn } from '../run/user-turn.js'
import type { ProviderSessionStore } from './provider-session-store.js'

export type ProviderId = 'claude' | 'pi'

export interface SessionRef {
  readonly provider: ProviderId
  readonly id: string
}

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export type EffortLevel = (typeof EFFORT_LEVELS)[number]

export function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === 'string' && (EFFORT_LEVELS as readonly string[]).includes(value)
}

export const QUEUE_BEHAVIORS = ['follow-up', 'steer', 'interrupt'] as const

export type QueueBehavior = (typeof QUEUE_BEHAVIORS)[number]

export function isQueueBehavior(value: unknown): value is QueueBehavior {
  return typeof value === 'string' && (QUEUE_BEHAVIORS as readonly string[]).includes(value)
}

export type SessionTarget =
  | { kind: 'new'; provider: ProviderId; sessionId?: string }
  | { kind: 'resume'; session: SessionRef }
  | { kind: 'fork'; source: SessionRef; sessionId?: string }

export interface ProviderRunSpec {
  readonly cwd: string
  readonly provider: ProviderId
  readonly model: string
  readonly baseUrl: string
  readonly authToken: string
  readonly profileId?: string
  readonly modelContext?: '1m' | null
  readonly effort?: EffortLevel
  readonly queueBehavior?: QueueBehavior
  readonly promptSuggestions?: boolean
}

export interface TurnContext {
  readonly signal: AbortSignal
}

export interface AgentRuntime {
  readonly session: SessionRef
  run(turn: UserTurn, context: TurnContext): AsyncIterable<AgentEvent>
  abort(reason?: string): Promise<void>
  release(retention: 'warm' | 'dispose'): Promise<void>
}

export interface AgentProvider {
  readonly id: ProviderId
  readonly sessions: ProviderSessionStore
  openSession(target: SessionTarget, spec: ProviderRunSpec): Promise<AgentRuntime>
}
