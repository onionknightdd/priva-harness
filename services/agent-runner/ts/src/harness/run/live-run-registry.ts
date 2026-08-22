import type { ProviderId, SessionRef } from '../../core/contract/agent-provider.js'
import { sessionRefKey, type RunMode } from '../../core/resource/session.js'

export interface LiveRunRecord {
  readonly runId: string
  readonly provider: ProviderId
  readonly cwd: string
  readonly runMode: RunMode
  readonly startedAt: number
  sessionId: string | null
}

export interface StartLiveRunInput {
  readonly runId: string
  readonly provider: ProviderId
  readonly cwd: string
  readonly runMode?: RunMode
}

export class LiveRunRegistry {
  private readonly byRunId = new Map<string, LiveRunRecord>()
  private readonly runIdBySession = new Map<string, string>()

  start(input: StartLiveRunInput): LiveRunRecord {
    const record: LiveRunRecord = {
      runId: input.runId,
      provider: input.provider,
      cwd: input.cwd,
      runMode: input.runMode ?? 'agent',
      startedAt: Date.now(),
      sessionId: null,
    }
    this.byRunId.set(input.runId, record)
    return record
  }

  attachSession(runId: string, sessionId: string): void {
    if (sessionId.trim() === '') return
    const record = this.byRunId.get(runId)
    if (record === undefined) return
    if (record.sessionId !== null && record.sessionId !== sessionId) {
      this.runIdBySession.delete(sessionRefKey({ provider: record.provider, id: record.sessionId }))
    }
    record.sessionId = sessionId
    this.runIdBySession.set(sessionRefKey({ provider: record.provider, id: sessionId }), runId)
  }

  finish(runId: string): void {
    const record = this.byRunId.get(runId)
    if (record === undefined) return
    this.byRunId.delete(runId)
    if (record.sessionId !== null) {
      this.runIdBySession.delete(sessionRefKey({ provider: record.provider, id: record.sessionId }))
    }
  }

  liveForSession(ref: SessionRef): LiveRunRecord | undefined {
    const runId = this.runIdBySession.get(sessionRefKey(ref))
    if (runId === undefined) return undefined
    return this.byRunId.get(runId)
  }

  listActive(provider?: ProviderId): readonly LiveRunRecord[] {
    const records = [...this.byRunId.values()]
    if (provider === undefined) return records
    return records.filter((record) => record.provider === provider)
  }
}
