import type { SessionRef } from '../../src/core/contract/agent-provider.js'
import type { SessionMetadataRepository } from '../../src/core/contract/session-metadata-repository.js'
import {
  emptySessionMetadata,
  reserveTagColors,
  sessionRefKey,
  type SessionMetadataPatch,
  type SessionMetadataRecord,
} from '../../src/core/resource/session.js'

export class MemorySessionMetadataRepository implements SessionMetadataRepository {
  private readonly records = new Map<string, SessionMetadataRecord>()
  private colors: Record<string, number> = {}

  get(ref: SessionRef): Promise<SessionMetadataRecord> {
    return Promise.resolve(this.records.get(sessionRefKey(ref)) ?? emptySessionMetadata())
  }

  list(refs: readonly SessionRef[]): Promise<ReadonlyMap<string, SessionMetadataRecord>> {
    const out = new Map<string, SessionMetadataRecord>()
    for (const ref of refs) {
      const key = sessionRefKey(ref)
      out.set(key, this.records.get(key) ?? emptySessionMetadata())
    }
    return Promise.resolve(out)
  }

  tagColors(tags: readonly string[]): Promise<Readonly<Record<string, number>>> {
    this.colors = reserveTagColors(this.colors, tags)
    return Promise.resolve(this.colors)
  }

  async upsert(ref: SessionRef, patch: SessionMetadataPatch): Promise<SessionMetadataRecord> {
    const current = await this.get(ref)
    const next: SessionMetadataRecord = {
      flags: {
        pinned: patch.pinned ?? current.flags.pinned,
        archived: patch.archived ?? current.flags.archived,
      },
      tags: patch.tags === undefined ? current.tags : [...patch.tags],
      addDirs: patch.addDirs === undefined ? current.addDirs : [...patch.addDirs],
      runMode: patch.runMode ?? current.runMode,
      recap: patch.recap === undefined ? current.recap : patch.recap,
      lastResponseModel: patch.lastResponseModel === undefined
        ? current.lastResponseModel
        : patch.lastResponseModel,
    }
    this.colors = reserveTagColors(this.colors, next.tags)
    this.records.set(sessionRefKey(ref), next)
    return next
  }

  delete(ref: SessionRef): Promise<void> {
    this.records.delete(sessionRefKey(ref))
    return Promise.resolve()
  }
}
