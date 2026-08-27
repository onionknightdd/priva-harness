import type { ProviderId, SessionRef } from '../../core/contract/agent-provider.js'
import { sessionRefKey, type RunMode } from '../../core/resource/session.js'
import { LiveRun, type LiveRunInput } from './live-run.js'

export type LiveRunRecord = LiveRun

export interface StartLiveRunInput {
  readonly runId: string
  readonly provider: ProviderId
  readonly cwd: string
  readonly runMode?: RunMode
}

export class LiveRunRegistry {
  private readonly byRunId = new Map<string, LiveRun>()
  private readonly runIdBySession = new Map<string, string>()

  create(input: LiveRunInput): LiveRun {
    const live = new LiveRun(input)
    this.byRunId.set(live.runId, live)
    return live
  }

  start(input: StartLiveRunInput): LiveRun {
    return this.create({
      ...input,
      abort: new AbortController(),
    })
  }

  get(runId: string): LiveRun | undefined {
    return this.byRunId.get(runId)
  }

  attachSession(runId: string, sessionId: string): void {
    if (sessionId.trim() === '') return
    const live = this.byRunId.get(runId)
    if (live === undefined) return
    if (live.sessionId !== null && live.sessionId !== sessionId) {
      this.runIdBySession.delete(sessionRefKey({ provider: live.provider, id: live.sessionId }))
    }
    live.sessionId = sessionId
    this.runIdBySession.set(sessionRefKey({ provider: live.provider, id: sessionId }), runId)
  }

  finish(runId: string): void {
    const live = this.byRunId.get(runId)
    if (live === undefined) return
    live.complete()
    this.byRunId.delete(runId)
    if (live.sessionId !== null) {
      this.runIdBySession.delete(sessionRefKey({ provider: live.provider, id: live.sessionId }))
    }
  }

  liveForSession(ref: SessionRef): LiveRun | undefined {
    const runId = this.runIdBySession.get(sessionRefKey(ref))
    if (runId === undefined) return undefined
    return this.byRunId.get(runId)
  }

  liveRunningForSession(ref: SessionRef): LiveRun | undefined {
    const live = this.liveForSession(ref)
    if (live?.status !== 'running') return undefined
    return live
  }

  listActive(provider?: ProviderId): readonly LiveRun[] {
    const records = [...this.byRunId.values()].filter((live) => live.status === 'running')
    if (provider === undefined) return records
    return records.filter((record) => record.provider === provider)
  }
}
