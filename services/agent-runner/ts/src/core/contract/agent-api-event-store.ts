import type { DurableEvent, DurableEventDraft } from '../agent-api/events.js'
import type { ProjectionMemory } from '../agent-api/graph-diff.js'
import type { RunRecord } from '../agent-api/thread-projection.js'

/** The durable events of one platform session. `seq` survives restarts. */
export interface AgentApiEventLog {
  readonly lastSeq: number
  /** Oldest retained `seq`; `lastSeq + 1` when nothing is retained. */
  readonly firstSeq: number
  /** Assigns `seq` and `created_at` synchronously; persistence follows in order. */
  append(drafts: readonly DurableEventDraft[]): DurableEvent[]
  read(afterSeq: number): Promise<readonly DurableEvent[]>
  flush(): Promise<void>
}

/** Projector state: what the API knows about runs, and what the log already said. */
export interface AgentApiProjectionState {
  readonly runs: readonly RunRecord[]
  /** Null until the API first observes the session; history before that is not replayed as events. */
  readonly memory: ProjectionMemory | null
}

export interface AgentApiEventStore {
  openLog(sessionId: string): Promise<AgentApiEventLog>
  loadState(sessionId: string): Promise<AgentApiProjectionState>
  saveState(sessionId: string, state: AgentApiProjectionState): Promise<void>
}
