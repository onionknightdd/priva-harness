import type { SessionRef } from './agent-provider.js'
import type {
  SessionMetadataPatch,
  SessionMetadataRecord,
} from '../resource/session.js'

export interface SessionMetadataRepository {
  get(ref: SessionRef): Promise<SessionMetadataRecord>
  list(refs: readonly SessionRef[]): Promise<ReadonlyMap<string, SessionMetadataRecord>>
  tagColors(tags: readonly string[]): Promise<Readonly<Record<string, number>>>
  upsert(ref: SessionRef, patch: SessionMetadataPatch): Promise<SessionMetadataRecord>
  delete(ref: SessionRef): Promise<void>
}
