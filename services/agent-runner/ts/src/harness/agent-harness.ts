import type { InteractionResponse } from '../core/resource/interaction.js'
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
import type { DataRecorder } from '../core/contract/data-recorder.js'
import type { RunSource } from '../core/resource/data-store.js'
import { RunLedger } from './run/run-ledger.js'
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
import { TerminalHistoryMirror } from './terminal/terminal-history-mirror.js'
import { TerminalChatSessions } from './terminal/terminal-chat-sessions.js'
import { readTerminalUsage, terminalUsageDelta } from './terminal/terminal-run-usage.js'
import type { SessionTerminals, TerminalSize } from './terminal/session-terminals.js'
import type { TerminalElicitation, TerminalQuestion, TerminalSessionState } from '../core/contract/terminal-service.js'

export interface AgentHarnessOptions {
  readonly providers: Readonly<Record<ProviderId, AgentProvider>>
  readonly cwd: string
  readonly liveRuns?: LiveRunRegistry
  readonly sessions?: SessionService
  readonly recorder?: DataRecorder
  readonly pool?: WarmRuntimePool
}

export interface AgentRunOptions {
  // Who initiated the turn; recorded with every usage fact so totals can be
  // split by entry point. Required so a new caller cannot forget it.
  readonly source: RunSource
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
  private readonly terminalHistories = new Map<string, { mirror: TerminalHistoryMirror; ready: Promise<void>; viewers: number }>()
  private terminalChats: TerminalChatSessions | undefined
  private terminals: SessionTerminals | undefined
  private readonly sdkSessions = new Set<string>()
  private readonly openingTerminals = new Map<string, number>()
  // Skill names seen in the latest slash-command listing per provider. Used
  // to tell a "/skill" prompt from a path or an unknown command without
  // paying for a listing on every turn.
  private readonly knownSkills = new Map<ProviderId, Set<string>>()

  constructor(private readonly options: AgentHarnessOptions) {
    this.liveRuns = options.liveRuns
    options.sessions?.bindLiveThreadReader((ref) => this.streams.get(sessionRefKey(ref))?.snapshot().messages)
    options.sessions?.bindBackgroundReader((provider) => [...this.streams.values()].filter((stream) => stream.session.provider === provider).map((stream) => ({ sessionId: stream.session.id, tasks: stream.tasks.list() })))
    options.sessions?.bindNativeRunningReader((provider) => (this.terminalChats?.list(provider) ?? []).flatMap((chat) => chat.runId ? [{
      sessionId: chat.ref.id, runId: chat.runId, status: 'running' as const, startedAt: chat.startedAt ?? Date.now(),
      lastSeq: this.sessionStream(chat.ref).snapshot().seq, firstSeq: 0, firstUserUuid: null, pendingPermission: null, runMode: 'code' as const, harness: provider,
    }] : []))
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

  async observeTerminalHistory(ref: SessionRef, cwd: string): Promise<() => Promise<void>> {
    const store = this.options.providers[ref.provider].sessions
    if (store.watch === undefined) return () => Promise.resolve()
    const key = sessionRefKey(ref)
    let entry = this.terminalHistories.get(key)
    if (entry === undefined) {
      const mirror = new TerminalHistoryMirror(store, this.sessionStream(ref))
      entry = { mirror, ready: mirror.start(cwd), viewers: 0 }
      this.terminalHistories.set(key, entry)
    }
    const current = entry
    current.viewers++
    let released = false
    const release = async () => {
      if (released) return
      released = true
      if (--current.viewers > 0) return
      // Capture the final record before releasing the last viewer. A new
      // viewer arriving during this read keeps the existing observer alive.
      await current.mirror.refresh()
      if (current.viewers > 0) return
      if (this.terminalHistories.get(key) === current) this.terminalHistories.delete(key)
      await current.mirror.stop()
    }
    try {
      await current.ready
      return release
    } catch (error) {
      await release()
      throw error
    }
  }

  configureTerminalChats(terminals: SessionTerminals, eventsUrl: (ref: SessionRef) => string): void {
    this.terminals = terminals
    this.terminalChats = new TerminalChatSessions({
      terminals, eventsUrl, stream: (ref) => this.sessionStream(ref),
      beforeOpen: async (ref) => {
        if (this.sdkSessions.has(sessionRefKey(ref)) || this.liveForSession(ref)) {
          throw new SessionError('session-busy', 'Wait for the current chat reply before opening Terminal')
        }
        await this.pool?.releaseSession(ref)
      },
      observe: (ref, cwd) => this.observeTerminalHistory(ref, cwd),
      refresh: async (ref) => { await this.terminalHistories.get(sessionRefKey(ref))?.mirror.refresh() },
      ledger: (ref, runId, turn, spec, target) => {
        const knownSkills = this.knownSkills.get(spec.provider)
        return new RunLedger(this.options.recorder, { runId, spec, turn, source: 'web', sessionId: ref.id, sessionTarget: target,
          ...(knownSkills ? { knownSkills } : {}) })
      },
      accounting: async (ref) => {
        const store = this.options.providers[ref.provider].sessions
        const before = await readTerminalUsage(store, ref)
        return async () => terminalUsageDelta(before, await readTerminalUsage(store, ref))
      },
      configured: (ref, spec, model) => this.recordCompleted(ref, spec, model),
    })
  }

  async openTerminal(target: SessionTarget, spec: ProviderRunSpec, size: TerminalSize) {
    if (!this.terminalChats) throw new SessionError('invalid-request', 'Terminal driver is unavailable')
    const resolved = target.kind === 'resume' ? target : { ...target, sessionId: target.sessionId ?? randomUUID() }
    const key = sessionRefKey(resolved.kind === 'resume' ? resolved.session : { provider: spec.provider, id: resolved.sessionId })
    this.openingTerminals.set(key, (this.openingTerminals.get(key) ?? 0) + 1)
    try { return await this.terminalChats.open(resolved, spec, size) }
    finally {
      const remaining = (this.openingTerminals.get(key) ?? 1) - 1
      if (remaining) this.openingTerminals.set(key, remaining)
      else this.openingTerminals.delete(key)
    }
  }

  async submitTerminal(ref: SessionRef, turn: UserTurn, spec: ProviderRunSpec, runId: string): Promise<void> {
    if (!this.terminalChats) throw new SessionError('invalid-request', 'Terminal driver is unavailable')
    await this.terminalChats.submit(ref, turn, spec, runId)
  }

  async terminalEvent(ref: SessionRef, state: TerminalSessionState): Promise<void> {
    if (!await this.terminals?.isAlive(ref)) return
    if ((await this.terminals?.state(ref))?.instanceId !== state.instanceId) return
    await this.terminalChats?.event(ref, state)
  }

  async sessionForTerminal(terminalId: string): Promise<SessionRef | undefined> {
    return this.terminals?.sessionForTerminal(terminalId)
  }

  async terminalQuestion(ref: SessionRef, question: TerminalQuestion, signal: AbortSignal): Promise<Record<string, unknown>> {
    if (!this.terminalChats || !await this.terminals?.isAlive(ref) || (await this.terminals?.state(ref))?.instanceId !== question.instanceId) {
      throw new SessionError('invalid-request', 'The terminal question belongs to an inactive process')
    }
    return this.terminalChats.question(ref, question, signal)
  }

  async terminalElicitation(ref: SessionRef, input: TerminalElicitation, signal: AbortSignal): Promise<Record<string, unknown>> {
    if (!this.terminalChats || !await this.terminals?.isAlive(ref) || (await this.terminals?.state(ref))?.instanceId !== input.instanceId) {
      throw new SessionError('invalid-request', 'The terminal elicitation belongs to an inactive process')
    }
    return this.terminalChats.elicitation(ref, input, signal)
  }

  async abortTerminal(ref: SessionRef, runId?: string): Promise<boolean> {
    return await this.terminalChats?.abort(ref, runId) ?? false
  }

  async terminalInput(ref: SessionRef, input: Uint8Array): Promise<void> { await this.terminalChats?.input(ref, input) }
  async terminalExited(ref: SessionRef, reason: string): Promise<void> {
    // A delayed close from an old browser attach can arrive after relaunch.
    if (await this.terminals?.isAlive(ref)) return
    await this.terminalChats?.exited(ref, reason)
  }

  async observeTerminalSession(ref: SessionRef): Promise<() => Promise<void>> {
    const state = await this.terminals?.state(ref)
    if (!state || !await this.terminals?.isAlive(ref)) return () => Promise.resolve()
    await this.terminalChats?.event(ref, state)
    return this.observeTerminalHistory(ref, state.cwd)
  }

  async stopTask(ref: SessionRef, taskId: string): Promise<void> {
    if (this.terminalChats && await this.terminals?.isAlive(ref)) {
      if (!this.sessionStream(ref).tasks.get(taskId)) throw new SessionError('invalid-request', 'Unknown background task')
      await this.terminalChats.manageTasks(ref)
      return
    }
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

  respondPermission(ref: SessionRef, response: InteractionResponse): void {
    if (this.terminalChats?.respondPermission(ref, response)) return
    const runtime = this.pool?.peek(ref)
    if (!runtime?.respondPermission) throw new SessionError('invalid-request', 'The interaction runtime is no longer available')
    runtime.respondPermission(response)
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
    runOptions: AgentRunOptions,
  ): LiveRun {
    const liveRuns = this.requireLiveRuns()
    const session = this.prepareSession(spec, runOptions.session, true)
    this.rejectBusy(session)
    const runId = runOptions.runId ?? randomUUID()
    const abort = new AbortController()
    const live = liveRuns.create({
      runId,
      provider: spec.provider,
      cwd: spec.cwd,
      abort,
    })
    this.bindPreparedSession(liveRuns, runId, session)
    void this.pumpLive(live, turn, spec, session, runOptions.source)
    return live
  }

  live(runId: string): LiveRun | undefined {
    return this.liveRuns?.get(runId)
  }

  liveForSession(ref: SessionRef): LiveRun | undefined {
    return this.liveRuns?.liveRunningForSession(ref)
  }

  listWarm(harness: ProviderId): readonly SessionRef[] {
    return [...this.pool?.listIdle().filter((session) => session.provider === harness) ?? [],
      ...this.terminalChats?.list(harness).filter((chat) => !chat.runId).map((chat) => chat.ref) ?? []]
  }

  async readContextUsage(ref: SessionRef, spec?: ProviderRunSpec): Promise<ContextUsage> {
    if (ref.id === '') return emptyContextUsage()
    if (this.terminals && await this.terminals.isAlive(ref)) return this.terminalChats?.status(ref)?.context ?? (await this.terminals.telemetry(ref, 0)).status?.context ?? emptyContextUsage()
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
    this.rememberSkills(options.provider, commands)
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
    await this.terminalChats?.dispose()
    const histories = [...this.terminalHistories.values()]
    this.terminalHistories.clear()
    await Promise.all(histories.map(async ({ ready, mirror }) => { await ready; await mirror.stop() }))
    await Promise.all([...this.streams.values()].map((stream) => stream.flush()))
  }

  async invalidateResources(): Promise<void> {
    this.terminalChats?.invalidateResources()
    await this.pool?.invalidateResources()
  }

  async *run(
    turn: UserTurn,
    context: TurnContext,
    spec: ProviderRunSpec,
    runOptions: AgentRunOptions,
  ): AsyncIterable<StreamFrame> {
    const runId = runOptions.runId ?? randomUUID()

    const session = this.prepareSession(spec, runOptions.session, false)
    const sdkRef = sessionRefOf(session)
    const sdkKey = sdkRef ? sessionRefKey(sdkRef) : undefined
    if (sdkKey) {
      if (this.sdkSessions.has(sdkKey) || this.openingTerminals.has(sdkKey)) throw new SessionError('session-busy', 'The session already has an active driver')
      this.sdkSessions.add(sdkKey)
    }
    const userTurn = userTurnFromText(turn.text)
    const attachments = turn.attachments ?? userTurn.attachments
    // Opened before the provider so a session that fails to open still counts
    // as a user turn that failed.
    const preassigned = sessionRefOf(session)?.id
    const knownSkills = this.knownSkills.get(spec.provider)
    const ledger = new RunLedger(this.options.recorder, {
      runId, spec, source: runOptions.source, sessionTarget: session,
      turn: { text: userTurn.text, ...(attachments ? { attachments } : {}) },
      ...(preassigned === undefined ? {} : { sessionId: preassigned }),
      ...(knownSkills === undefined ? {} : { knownSkills }),
    })
    try {
      const ref = sessionRefOf(session)
      if (ref && await this.terminals?.isAlive(ref)) {
        throw new SessionError('session-busy', 'This session is controlled by its terminal. Send through the session chat or close Terminal before using the SDK.')
      }
      const provider = this.options.providers[spec.provider]
      const poolKey = sessionRefOf(session)
      const pool = runOptions.keepRuntimeWarm === false ? undefined : this.pool
      const runtime = pool === undefined
        ? await provider.openSession(session, spec)
        : await pool.acquire(poolKey, spec, () => provider.openSession(session, spec))

      this.liveRuns?.attachSession(runId, runtime.session.id)
      ledger.attachSession(runtime.session.id)
      const stamper = new EnvelopeStamper(runId, spec.provider, Date.now, runtime.session.id)
      try {
        yield stamper.stamp({
          type: 'run.started', model: spec.model,
          userMessage: {
            id: `${runId}:user`, role: 'user', content: userTurn.text,
            ...(attachments ? { attachments } : {}),
            createdAt: new Date().toISOString(), status: 'complete',
          },
        })
        yield* this.forward(runtime, turn, context, spec, runId, stamper, ledger)
      } finally {
        if (pool === undefined || runtime.session.id === '') {
          await runtime.release('dispose')
        } else {
          await pool.recycle(runtime, spec, runtime.session)
        }
      }
    } catch (error) {
      ledger.crashed(error)
      throw error
    } finally {
      ledger.settle(context.signal.aborted)
      if (sdkKey) this.sdkSessions.delete(sdkKey)
    }
  }

  private async pumpLive(
    live: LiveRun,
    turn: UserTurn,
    spec: ProviderRunSpec,
    session: SessionTarget,
    source: RunSource,
  ): Promise<void> {
    let sawResult = false
    try {
      for await (const frame of this.run(turn, { signal: live.abort.signal }, spec, {
        source,
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
    ledger: RunLedger,
  ): AsyncIterable<StreamFrame> {
    let finished = false
    try {
      for await (const event of consumeRunEvents(runtime.run(turn, context), {
        signal: context.signal,
      })) {
        this.liveRuns?.attachSession(runId, runtime.session.id)
        ledger.attachSession(runtime.session.id)
        if (event.type === 'run.completed') {
          await this.recordCompleted(runtime.session, spec, event.model)
        }
        ledger.observe(event)
        yield stamper.stamp(event)
        if (isRunResultEvent(event)) finished = true
      }
    } catch (error) {
      if (!finished) {
        ledger.crashed(error)
        yield stamper.stamp({
          type: 'run.failed',
          message: errorMessage(error),
          code: 'runtime_crash',
          ...(runtime.session.id === '' ? {} : { sessionId: runtime.session.id }),
          model: spec.model,
        })
      }
    }
  }

  private rememberSkills(provider: ProviderId, commands: readonly SlashCommand[]): void {
    const names = new Set<string>()
    for (const command of commands) {
      if (command.kind !== 'skill') continue
      names.add(command.name.toLowerCase())
      for (const alias of command.aliases ?? []) names.add(alias.toLowerCase())
    }
    this.knownSkills.set(provider, names)
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
