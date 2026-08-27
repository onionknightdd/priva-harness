import { randomUUID } from 'node:crypto'

import type {
  AgentProvider,
  AgentRuntime,
  ProviderId,
  ProviderRunSpec,
  SessionRef,
  SessionTarget,
  TurnContext,
} from '../core/contract/agent-provider.js'
import type { AgentEvent } from '../core/event/agent-event.js'
import type { StreamFrame } from '../core/event/agent-event.js'
import { isRunResultEvent } from '../core/event/agent-event.js'
import type { UserTurn } from '../core/run/user-turn.js'
import { SessionError } from '../core/resource/session.js'
import { consumeRunEvents } from './run/consume-run-events.js'
import { EnvelopeStamper } from './run/envelope-stamper.js'
import type { LiveRun } from './run/live-run.js'
import type { LiveRunRegistry } from './run/live-run-registry.js'
import { WarmRuntimePool } from './run/warm-runtime-pool.js'
import type { SessionService } from './session/session-service.js'

export interface AgentHarnessOptions {
  readonly providers: Readonly<Record<ProviderId, AgentProvider>>
  readonly cwd: string
  readonly liveRuns?: LiveRunRegistry
  readonly sessions?: SessionService
  readonly pool?: WarmRuntimePool
}

export interface AgentRunOptions {
  readonly runId?: string
  readonly session?: SessionTarget
}

export class AgentHarness {
  private readonly liveRuns: LiveRunRegistry | undefined
  private readonly pool: WarmRuntimePool | undefined

  constructor(private readonly options: AgentHarnessOptions) {
    this.liveRuns = options.liveRuns
    this.pool = options.pool ?? (
      options.liveRuns === undefined
        ? undefined
        : new WarmRuntimePool({
          onIdleEvents: (runtime, spec, session, events) => {
            this.promoteIdle(runtime, spec, session, events)
          },
        })
    )
  }

  launch(
    turn: UserTurn,
    spec: ProviderRunSpec,
    runOptions?: AgentRunOptions,
  ): LiveRun {
    const liveRuns = this.requireLiveRuns()
    const session = this.prepareSession(spec, runOptions?.session, true)
    this.rejectBusy(session)
    const runId = runOptions?.runId ?? randomUUID()
    const abort = new AbortController()
    const live = liveRuns.create({
      runId,
      provider: spec.provider,
      cwd: spec.cwd,
      abort,
    })
    this.bindPreparedSession(liveRuns, runId, session)
    void this.pumpLive(live, turn, spec, session)
    return live
  }

  live(runId: string): LiveRun | undefined {
    return this.liveRuns?.get(runId)
  }

  liveForSession(ref: SessionRef): LiveRun | undefined {
    return this.liveRuns?.liveRunningForSession(ref)
  }

  listWarm(harness: ProviderId): readonly SessionRef[] {
    return this.pool?.listIdle().filter((session) => session.provider === harness) ?? []
  }

  abortLive(runId: string): void {
    this.liveRuns?.get(runId)?.abort.abort()
  }

  abortLiveFor(ref: SessionRef): void {
    this.liveRuns?.liveRunningForSession(ref)?.abort.abort()
  }

  async disposePool(): Promise<void> {
    await this.pool?.disposeAll()
  }

  async *run(
    turn: UserTurn,
    context: TurnContext,
    spec: ProviderRunSpec,
    runOptions?: AgentRunOptions,
  ): AsyncIterable<StreamFrame> {
    const runId = runOptions?.runId ?? randomUUID()
    const live = this.liveRuns?.get(runId)
    const stamper = new EnvelopeStamper(
      runId,
      spec.provider,
      Date.now,
      live?.sessionId ?? undefined,
    )
    yield stamper.stamp({ type: 'run.started', model: spec.model })

    const session = this.prepareSession(spec, runOptions?.session, false)
    const provider = this.options.providers[spec.provider]
    const poolKey = sessionRefOf(session)
    const runtime = this.pool === undefined
      ? await provider.openSession(session, spec)
      : await this.pool.acquire(poolKey, spec, () => provider.openSession(session, spec))

    try {
      yield* this.forward(runtime, turn, context, spec, runId, stamper)
    } finally {
      if (this.pool === undefined || runtime.session.id === '') {
        await runtime.release('dispose')
      } else {
        await this.pool.recycle(runtime, spec, runtime.session)
      }
    }
  }

  private async pumpLive(
    live: LiveRun,
    turn: UserTurn,
    spec: ProviderRunSpec,
    session: SessionTarget,
  ): Promise<void> {
    let sawResult = false
    try {
      for await (const frame of this.run(turn, { signal: live.abort.signal }, spec, {
        runId: live.runId,
        session,
      })) {
        if (frame.sessionId !== undefined) {
          this.liveRuns?.attachSession(live.runId, frame.sessionId)
        }
        if (isRunResultEvent(frame)) sawResult = true
        live.publish(frame)
      }
    } catch (error) {
      if (!sawResult) {
        live.publish(live.stamp({
          type: 'run.failed',
          message: errorMessage(error),
          model: spec.model,
        }))
        sawResult = true
      }
    } finally {
      if (!sawResult) {
        live.publish(live.stamp(
          live.abort.signal.aborted
            ? { type: 'run.aborted', message: 'aborted', model: spec.model }
            : { type: 'run.failed', message: 'Run ended without a result', model: spec.model },
        ))
      }
      live.complete()
      this.liveRuns?.finish(live.runId)
    }
  }

  private promoteIdle(
    runtime: AgentRuntime,
    spec: ProviderRunSpec,
    session: SessionRef,
    events: readonly AgentEvent[],
  ): void {
    const liveRuns = this.liveRuns
    if (liveRuns === undefined) return
    const existing = liveRuns.liveRunningForSession(session)
    if (existing !== undefined) {
      for (const event of events) {
        existing.publish(existing.stamp(event))
        if (isRunResultEvent(event)) {
          existing.complete()
          liveRuns.finish(existing.runId)
          void this.pool?.recycle(runtime, spec, session)
        }
      }
      return
    }
    this.pool?.claim(runtime)
    const runId = randomUUID()
    const abort = new AbortController()
    const live = liveRuns.create({
      runId,
      provider: spec.provider,
      cwd: spec.cwd,
      abort,
    })
    liveRuns.attachSession(runId, session.id)
    live.publish(live.stamp({ type: 'run.started', model: spec.model }))
    for (const event of events) {
      live.publish(live.stamp(event))
      if (isRunResultEvent(event)) {
        live.complete()
        liveRuns.finish(runId)
        void this.pool?.recycle(runtime, spec, session)
        return
      }
    }
  }

  private async *forward(
    runtime: AgentRuntime,
    turn: UserTurn,
    context: TurnContext,
    spec: ProviderRunSpec,
    runId: string,
    stamper: EnvelopeStamper,
  ): AsyncIterable<StreamFrame> {
    let finished = false
    try {
      for await (const event of consumeRunEvents(runtime.run(turn, context), {
        signal: context.signal,
      })) {
        this.liveRuns?.attachSession(runId, runtime.session.id)
        if (event.type === 'run.completed') {
          await this.recordCompleted(runtime.session, spec, event.model)
        }
        yield stamper.stamp(event)
        if (isRunResultEvent(event)) finished = true
      }
    } catch (error) {
      if (!finished) {
        yield stamper.stamp({
          type: 'run.failed',
          message: errorMessage(error),
          ...(runtime.session.id === '' ? {} : { sessionId: runtime.session.id }),
          model: spec.model,
        })
      }
    }
  }

  private prepareSession(
    spec: ProviderRunSpec,
    session: SessionTarget | undefined,
    preassign: boolean,
  ): SessionTarget {
    if (session === undefined) {
      if (preassign && spec.provider === 'claude') {
        return { kind: 'new', provider: 'claude', sessionId: randomUUID() }
      }
      return { kind: 'new', provider: spec.provider }
    }
    if (preassign && session.kind === 'new' && spec.provider === 'claude' && session.sessionId === undefined) {
      return { kind: 'new', provider: 'claude', sessionId: randomUUID() }
    }
    if (preassign && session.kind === 'fork' && spec.provider === 'claude' && session.sessionId === undefined) {
      return { kind: 'fork', source: session.source, sessionId: randomUUID() }
    }
    return session
  }

  private bindPreparedSession(
    liveRuns: LiveRunRegistry,
    runId: string,
    session: SessionTarget,
  ): void {
    if (session.kind === 'new' && session.sessionId !== undefined) {
      liveRuns.attachSession(runId, session.sessionId)
    }
    if (session.kind === 'resume') {
      liveRuns.attachSession(runId, session.session.id)
    }
    if (session.kind === 'fork' && session.sessionId !== undefined) {
      liveRuns.attachSession(runId, session.sessionId)
    }
  }

  private rejectBusy(session: SessionTarget): void {
    if (this.liveRuns === undefined) return
    if (session.kind === 'resume') {
      if (this.liveRuns.liveRunningForSession(session.session) !== undefined) {
        throw new SessionError('session-busy', 'Session has a live run')
      }
    }
    if (session.kind === 'new' && session.sessionId !== undefined) {
      if (this.liveRuns.liveRunningForSession({ provider: session.provider, id: session.sessionId }) !== undefined) {
        throw new SessionError('session-busy', 'Session has a live run')
      }
    }
  }

  private requireLiveRuns(): LiveRunRegistry {
    if (this.liveRuns === undefined) {
      throw new Error('Live run registry is required')
    }
    return this.liveRuns
  }

  private async recordCompleted(
    session: { provider: ProviderId; id: string },
    spec: ProviderRunSpec,
    modelId: string,
  ): Promise<void> {
    if (this.options.sessions === undefined || spec.profileId === undefined) return
    await this.options.sessions.recordRunCompleted(session, {
      profileId: spec.profileId,
      modelId,
      context: spec.modelContext ?? null,
    })
  }
}

function sessionRefOf(session: SessionTarget): SessionRef | undefined {
  if (session.kind === 'resume') return session.session
  if (session.kind === 'new' && session.sessionId !== undefined) {
    return { provider: session.provider, id: session.sessionId }
  }
  if (session.kind === 'fork' && session.sessionId !== undefined) {
    return { provider: session.source.provider, id: session.sessionId }
  }
  return undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
