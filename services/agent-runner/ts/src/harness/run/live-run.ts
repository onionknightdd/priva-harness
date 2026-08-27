import {
  STREAM_PROTOCOL_VERSION,
  sessionIdOf,
  type AgentEvent,
  type StreamFrame,
} from '../../core/event/agent-event.js'
import type { ProviderId } from '../../core/contract/agent-provider.js'
import type { RunMode } from '../../core/resource/session.js'

export const LIVE_BUFFER_LIMIT = 4096

export type LiveRunStatus = 'running' | 'complete'

export interface LiveRunInput {
  readonly runId: string
  readonly provider: ProviderId
  readonly cwd: string
  readonly runMode?: RunMode
  readonly abort: AbortController
}

export class LiveRun {
  readonly runId: string
  readonly provider: ProviderId
  readonly cwd: string
  readonly runMode: RunMode
  readonly startedAt: number
  readonly abort: AbortController
  sessionId: string | null = null
  status: LiveRunStatus = 'running'
  firstSeq = 0
  lastSeq = 0
  private readonly buffer: StreamFrame[] = []
  private readonly subscribers = new Set<(frame: StreamFrame) => void>()
  private readonly completeWaiters: (() => void)[] = []

  constructor(input: LiveRunInput) {
    this.runId = input.runId
    this.provider = input.provider
    this.cwd = input.cwd
    this.runMode = input.runMode ?? 'agent'
    this.startedAt = Date.now()
    this.abort = input.abort
  }

  publish(frame: StreamFrame): void {
    if (frame.sessionId !== undefined && frame.sessionId !== '') {
      this.sessionId = frame.sessionId
    }
    this.lastSeq = frame.seq
    this.buffer.push(frame)
    while (this.buffer.length > LIVE_BUFFER_LIMIT) {
      this.buffer.shift()
    }
    const first = this.buffer[0]
    this.firstSeq = first === undefined ? this.lastSeq : first.seq
    for (const subscriber of this.subscribers) subscriber(frame)
  }

  subscribe(
    listener: (frame: StreamFrame) => void,
    sinceSeq = 0,
  ): { readonly gap: boolean; readonly replay: readonly StreamFrame[] } {
    const gap = this.hasGap(sinceSeq)
    this.subscribers.add(listener)
    const replay = gap ? [] : this.buffer.filter((frame) => frame.seq > sinceSeq)
    return { gap, replay }
  }

  unsubscribe(listener: (frame: StreamFrame) => void): void {
    this.subscribers.delete(listener)
  }

  stamp(event: AgentEvent): StreamFrame {
    const seq = this.lastSeq + 1
    const sessionId = sessionIdOf(event) ?? this.sessionId ?? undefined
    return {
      ...event,
      v: STREAM_PROTOCOL_VERSION,
      runId: this.runId,
      seq,
      ts: Date.now(),
      harness: this.provider,
      ...(sessionId === undefined || sessionId === '' ? {} : { sessionId }),
    }
  }

  gapFrame(): StreamFrame {
    return {
      type: 'replay.gap',
      firstSeq: this.firstSeq,
      lastSeq: this.lastSeq,
      v: STREAM_PROTOCOL_VERSION,
      runId: this.runId,
      seq: this.lastSeq,
      ts: Date.now(),
      harness: this.provider,
      ...(this.sessionId === null ? {} : { sessionId: this.sessionId }),
    }
  }

  complete(): void {
    if (this.status === 'complete') return
    this.status = 'complete'
    const waiters = this.completeWaiters.splice(0)
    for (const waiter of waiters) waiter()
  }

  waitForComplete(): Promise<void> {
    if (this.status === 'complete') return Promise.resolve()
    return new Promise((resolve) => {
      this.completeWaiters.push(resolve)
    })
  }

  private hasGap(sinceSeq: number): boolean {
    if (this.buffer.length === 0) return false
    const first = this.buffer[0]
    if (first === undefined) return false
    return sinceSeq + 1 < first.seq
  }
}
