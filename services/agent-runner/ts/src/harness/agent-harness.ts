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
import { emptyContextUsage } from '../core/resource/context-usage.js'
import type { ContextUsage } from '../core/resource/context-usage.js'
import { isRunResultEvent } from '../core/event/agent-event.js'
import type { SlashCommand } from '../core/resource/slash-command.js'
import type { UserTurn } from '../core/run/user-turn.js'
import { SessionError } from '../core/resource/session.js'
import { DRAIN_SETTLE_MS } from './run/background-drain.js'
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

export interface ListSlashCommandsOptions {
  readonly provider: ProviderId
  readonly cwd: string
  readonly spec?: ProviderRunSpec
}

export interface SlashCommandCatalog {
  readonly harness: ProviderId
  readonly cwd: string
  readonly commands: readonly SlashCommand[]
}

export class AgentHarness {
  private readonly liveRuns: LiveRunRegistry | undefined
  private readonly pool: WarmRuntimePool | undefined
  private readonly inboundIdleTimers = new Map<string, ReturnType<typeof setTimeout>>()

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

  async readContextUsage(ref: SessionRef, spec?: ProviderRunSpec): Promise<ContextUsage> {
    if (ref.id === '') return emptyContextUsage()
    const runtime = this.pool?.peek(ref)
    if (runtime !== undefined) {
      try {
        return await runtime.getContextUsage()
      } catch {
        return emptyContextUsage()
      }
    }
    if (this.liveRuns?.liveRunningForSession(ref) !== undefined) {
      return emptyContextUsage()
    }
    if (spec === undefined) return emptyContextUsage()
    return await this.measureDetachedContextUsage(ref, spec)
  }

  private async measureDetachedContextUsage(
    ref: SessionRef,
    spec: ProviderRunSpec,
  ): Promise<ContextUsage> {
    const provider = this.options.providers[ref.provider]
    const measure = contextUsageMeasureOf(provider)
    if (measure !== undefined) {
      try {
        return await measure(ref, spec)
      } catch {
        return emptyContextUsage()
      }
    }
    const runtime = await provider.openSession({ kind: 'resume', session: ref }, spec)
    try {
      return await runtime.getContextUsage()
    } catch {
      return emptyContextUsage()
    } finally {
      await runtime.release('dispose')
    }
  }

  async listSlashCommands(options: ListSlashCommandsOptions): Promise<SlashCommandCatalog> {
    if (options.provider === 'claude' && options.spec === undefined) {
      throw new SessionError(
        'invalid-request',
        'Claude slash command listing requires a model profile',
      )
    }
    const commands = await this.options.providers[options.provider].listSlashCommands({
      cwd: options.cwd,
      ...(options.spec === undefined ? {} : { spec: options.spec }),
    })
    return {
      harness: options.provider,
      cwd: options.cwd,
      commands,
    }
  }

  abortLive(runId: string): void {
    this.liveRuns?.get(runId)?.abort.abort()
  }

  abortLiveFor(ref: SessionRef): void {
    this.liveRuns?.liveRunningForSession(ref)?.abort.abort()
  }

  async disposePool(): Promise<void> {
    for (const timer of this.inboundIdleTimers.values()) clearTimeout(timer)
    this.inboundIdleTimers.clear()
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
        if (sawResult) live.complete()
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
    if (events.length === 0) return
    const liveRuns = this.liveRuns
    if (liveRuns === undefined) return
    const existing = liveRuns.liveRunningForSession(session)
    if (existing !== undefined) {
      this.publishInbound(existing, events, runtime, spec, session)
      return
    }
    if (!hasActiveInboundWork(events)) return
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
    abort.signal.addEventListener('abort', () => {
      this.clearInboundIdle(runId)
      if (live.status !== 'running') return
      live.complete()
      liveRuns.finish(runId)
      void this.pool?.recycle(runtime, spec, session)
    })
    live.publish(live.stamp({ type: 'run.started', model: spec.model }))
    this.publishInbound(live, events, runtime, spec, session)
  }

  private publishInbound(
    live: LiveRun,
    events: readonly AgentEvent[],
    runtime: AgentRuntime,
    spec: ProviderRunSpec,
    session: SessionRef,
  ): void {
    for (const event of events) {
      live.publish(live.stamp(event))
      if (!isRunResultEvent(event)) continue
      this.clearInboundIdle(live.runId)
      live.complete()
      this.liveRuns?.finish(live.runId)
      void this.pool?.recycle(runtime, spec, session)
      return
    }
    this.armInboundIdle(live, runtime, spec, session)
  }

  private armInboundIdle(
    live: LiveRun,
    runtime: AgentRuntime,
    spec: ProviderRunSpec,
    session: SessionRef,
  ): void {
    this.clearInboundIdle(live.runId)
    const timer = setTimeout(() => {
      this.inboundIdleTimers.delete(live.runId)
      if (live.status !== 'running') return
      live.complete()
      this.liveRuns?.finish(live.runId)
      void this.pool?.recycle(runtime, spec, session)
    }, DRAIN_SETTLE_MS)
    this.inboundIdleTimers.set(live.runId, timer)
  }

  private clearInboundIdle(runId: string): void {
    const timer = this.inboundIdleTimers.get(runId)
    if (timer !== undefined) clearTimeout(timer)
    this.inboundIdleTimers.delete(runId)
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

function hasActiveInboundWork(events: readonly AgentEvent[]): boolean {
  return events.some((event) => {
    switch (event.type) {
      case 'assistant.delta':
      case 'assistant.thinking_delta':
      case 'assistant.block_start':
      case 'assistant.image_delta':
      case 'tool.started':
      case 'tool.input_delta':
      case 'tool.running':
      case 'tool.progress':
      case 'agent.started':
      case 'workflow.started':
      case 'workflow.progress':
        return true
      default:
        return false
    }
  })
}

function contextUsageMeasureOf(
  provider: AgentProvider,
): ((session: SessionRef, spec: ProviderRunSpec) => Promise<ContextUsage>) | undefined {
  const measure = (provider as {
    measureContextUsage?: (session: SessionRef, spec: ProviderRunSpec) => Promise<ContextUsage>
  }).measureContextUsage
  return typeof measure === 'function' ? measure.bind(provider) : undefined
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
