import type { AgentEvent } from '../event/agent-event.js'
import type { UserTurn } from '../run/user-turn.js'
import type { ProviderSessionStore } from './provider-session-store.js'

export type ProviderId = 'claude' | 'bambuddy'

export interface SessionRef {
  readonly provider: ProviderId
  readonly id: string
}

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export type EffortLevel = (typeof EFFORT_LEVELS)[number]

export function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === 'string' && (EFFORT_LEVELS as readonly string[]).includes(value)
}

export type SessionTarget =
  | { kind: 'new'; provider: ProviderId }
  | { kind: 'resume'; session: SessionRef }
  | { kind: 'fork'; source: SessionRef }

export interface ProviderRunSpec {
  readonly cwd: string
  readonly provider: ProviderId
  readonly model: string
  readonly baseUrl: string
  readonly authToken: string
  readonly profileId?: string
  readonly modelContext?: '1m' | null
  readonly effort?: EffortLevel
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
