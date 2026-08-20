import type { AgentEvent } from '../event/agent-event.js'
import type { UserTurn } from '../run/user-turn.js'

export type ProviderId = 'claude' | 'pi'

export interface SessionRef {
  readonly provider: ProviderId
  readonly id: string
}

export type SessionTarget =
  | { kind: 'new'; provider: ProviderId }
  | { kind: 'resume'; session: SessionRef }

export interface ProviderRunSpec {
  readonly cwd: string
  readonly provider: ProviderId
  readonly model: string
  readonly baseUrl: string
  readonly authToken: string
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
  openSession(target: SessionTarget, spec: ProviderRunSpec): Promise<AgentRuntime>
}
