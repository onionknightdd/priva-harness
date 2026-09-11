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
import { SessionStream } from './session/session-stream.js'
import { sessionRefKey } from '../core/resource/session.js'
import { userTurnFromText } from '../core/run/user-turn.js'
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
  readonly keepRuntimeWarm?: boolean
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
  private readonly streams = new Map<string, SessionStream>()
  private readonly loadingStreams = new Map<string, Promise<SessionStream>>()

  constructor(private readonly options: AgentHarnessOptions) {
    this.liveRuns = options.liveRuns
    options.sessions?.bindLiveThreadReader((ref) => this.streams.get(sessionRefKey(ref))?.snapshot().messages)
    options.sessions?.bindBackgroundReader((provider) => [...this.streams.values()].filter((stream) => stream.session.provider === provider).map((stream) => ({ sessionId: stream.session.id, tasks: stream.tasks.list() })))
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

  sessionStream(ref: SessionRef): SessionStream {
    const key = sessionRefKey(ref)
    let stream = this.streams.get(key)
    if (!stream) { stream = new SessionStream(ref, [], 4096, (tasks) => this.options.sessions?.saveBackgroundTasks(ref, tasks) ?? Promise.resolve()); this.streams.set(key, stream) }
    return stream
  }

  async loadSessionStream(ref: SessionRef): Promise<SessionStream> {
    const key = sessionRefKey(ref)
    const existing = this.streams.get(key)
    if (existing) return existing
    const loading = this.loadingStreams.get(key)
    if (loading) return loading
    const promise = (async () => {
      const [history, tasks] = await Promise.all([
        this.options.sessions?.thread(ref.provider, ref.id), this.options.sessions?.savedBackgroundTasks(ref),
      ])
      const stream = this.streams.get(key) ?? new SessionStream(ref, history?.messages, 4096,
        (tasks) => this.options.sessions?.saveBackgroundTasks(ref, tasks) ?? Promise.resolve(), tasks)
      this.streams.set(key, stream)
      return stream
    })()
    this.loadingStreams.set(key, promise)
    try { return await promise } finally { this.loadingStreams.delete(key) }
  }

  async stopTask(ref: SessionRef, taskId: string): Promise<void> {
    const runtime = this.pool?.peek(ref)
    if (!runtime?.stopTask) throw new SessionError('invalid-request', 'The task runtime is no longer available')
    const stream = this.sessionStream(ref)
    const task = stream.tasks.get(taskId)
    if (!task) throw new SessionError('invalid-request', 'Unknown background task')
    stream.publish({ type: 'task.updated', task: { ...task, stopRequested: true } })
    try { await runtime.stopTask(taskId) } catch (error) {
      stream.publish({ type: 'task.updated', task: { ...task, stopRequested: false } })
      throw error
    }
  }

  private publish(live: LiveRun, event: StreamFrame): void {
    if (event.sessionId || live.sessionId) {
      this.sessionStream({ provider: live.provider, id: event.sessionId ?? live.sessionId ?? '' }).publish(event, live.runId)
    }
    live.publish(event)
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
    await this.pool?.disposeAll()
    await Promise.all([...this.streams.values()].map((stream) => stream.flush()))
  }

  async invalidateResources(): Promise<void> {
    await this.pool?.invalidateResources()
  }

  async *run(
    turn: UserTurn,
    context: TurnContext,
    spec: ProviderRunSpec,
    runOptions?: AgentRunOptions,
  ): AsyncIterable<StreamFrame> {
    const runId = runOptions?.runId ?? randomUUID()

    const session = this.prepareSession(spec, runOptions?.session, false)
    const provider = this.options.providers[spec.provider]
    const poolKey = sessionRefOf(session)
    const pool = runOptions?.keepRuntimeWarm === false ? undefined : this.pool
    const runtime = pool === undefined
      ? await provider.openSession(session, spec)
      : await pool.acquire(poolKey, spec, () => provider.openSession(session, spec))

    this.liveRuns?.attachSession(runId, runtime.session.id)
    const stamper = new EnvelopeStamper(runId, spec.provider, Date.now, runtime.session.id)
    const userTurn = userTurnFromText(turn.text)
    const attachments = turn.attachments ?? userTurn.attachments
    try {
      yield stamper.stamp({
        type: 'run.started', model: spec.model,
        userMessage: {
          id: `${runId}:user`, role: 'user', content: userTurn.text,
          ...(attachments ? { attachments } : {}),
          createdAt: new Date().toISOString(), status: 'complete',
        },
      })
      yield* this.forward(runtime, turn, context, spec, runId, stamper)
    } finally {
      if (pool === undefined || runtime.session.id === '') {
        await runtime.release('dispose')
      } else {
        await pool.recycle(runtime, spec, runtime.session)
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
        this.publish(live, frame)
        if (sawResult) { live.complete(); this.liveRuns?.finish(live.runId) }
      }
    } catch (error) {
      if (!sawResult) {
        this.publish(live, live.stamp({
          type: 'run.failed',
          message: errorMessage(error),
          model: spec.model,
        }))
        sawResult = true
      }
    } finally {
      if (!sawResult) {
        this.publish(live, live.stamp(
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
    if (!hasActiveInboundWork(events)) {
      for (const event of events) this.sessionStream(session).publish(event)
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
    abort.signal.addEventListener('abort', () => {
      void runtime.abort().catch((error: unknown) => this.publishInbound(live, [{ type: 'run.failed', message: errorMessage(error) }], runtime, spec, session))
    })
    const replyTo = events.find((event) => event.replyTo)?.replyTo
    this.publish(live, live.stamp({ type: 'run.started', model: spec.model, ...(replyTo ? { replyTo } : {}) }))
    this.publishInbound(live, events, runtime, spec, session)
  }

  private publishInbound(
    live: LiveRun,
    events: readonly AgentEvent[],
    runtime: AgentRuntime,
    spec: ProviderRunSpec,
    session: SessionRef,
  ): void {
    for (const [index, event] of events.entries()) {
      this.publish(live, live.stamp(event))
      if (!isRunResultEvent(event)) continue
      live.complete()
      this.liveRuns?.finish(live.runId)
      void this.pool?.recycle(runtime, spec, session)
      this.promoteIdle(runtime, spec, session, events.slice(index + 1))
      return
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

function hasActiveInboundWork(events: readonly AgentEvent[]): boolean {
  return events.some((event) => {
    switch (event.type) {
      case 'assistant.delta':
      case 'assistant.thinking_delta':
      case 'assistant.block_start':
      case 'assistant.image_delta':
      case 'tool.started':
      case 'tool.input_delta':
      case 'assistant.message':
        return !('parentToolUseId' in event && event.parentToolUseId)
      case 'session.state':
        return event.state === 'running'
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
