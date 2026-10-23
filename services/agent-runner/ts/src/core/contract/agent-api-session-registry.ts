import type { SessionSettings } from '../agent-api/objects.js'
import type { RunMode } from '../resource/session.js'
import type { ProviderId } from './agent-provider.js'

/** A platform session and the native session it currently maps to. */
export interface AgentApiSessionRecord {
  readonly id: string
  readonly harness: ProviderId
  /** Relative to the Sandbox workspace root; `''` is the root itself. */
  readonly workdir: string
  /** Claude only; fixed when the session is created. */
  readonly runMode?: RunMode
  /** Claude IDs are preallocated; Pi IDs are known once the first run opens the session. */
  readonly nativeId: string | null
  readonly settings: SessionSettings
  readonly createdAt: string
  readonly updatedAt: string
}

export type AgentApiSessionPatch = Partial<Pick<AgentApiSessionRecord, 'nativeId' | 'settings' | 'updatedAt'>>

export interface AgentApiSessionRegistry {
  create(record: AgentApiSessionRecord): Promise<void>
  get(id: string): Promise<AgentApiSessionRecord | undefined>
  list(): Promise<readonly AgentApiSessionRecord[]>
  update(id: string, patch: AgentApiSessionPatch): Promise<AgentApiSessionRecord>
  delete(id: string): Promise<void>
}
