import { emptyContextUsage } from '../../core/resource/context-usage.js'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

import type { ProviderRunSpec, SessionRef, SessionTarget } from '../../core/contract/agent-provider.js'
import type { TerminalComposer, TerminalElicitation, TerminalQuestion, TerminalSessionState, TerminalStatus } from '../../core/contract/terminal-service.js'
import { terminalElicitationForm } from './terminal-elicitation.js'
import type { RunLedger } from '../run/run-ledger.js'
import type { RunAccounting, SessionConfiguration } from '../../core/event/agent-event.js'
import { InteractionCoordinator } from '../../core/run/interaction-coordinator.js'
import { answersByQuestion, normalizeQuestions, type InteractionResponse } from '../../core/resource/interaction.js'
import type { AgentEvent } from '../../core/event/agent-event.js'
import { SessionError, sessionRefKey, type RunMode } from '../../core/resource/session.js'
import { userTurnFromText, userTurnText, type UserTurn } from '../../core/run/user-turn.js'
import type { SessionStream } from '../session/session-stream.js'
import type { OpenedSessionTerminal, SessionTerminals, TerminalSize } from './session-terminals.js'
import { splitModelContext } from '../../core/resource/model-profile.js'
import { TerminalInteractions } from './terminal-interactions.js'
import type { ThreadReplayItem } from '../../core/resource/thread.js'

interface PendingTurn { readonly runId: string; readonly turn: UserTurn; readonly spec: ProviderRunSpec }
interface ActiveTurn {
  readonly runId: string
  readonly text: string
  readonly startedAt: number
  readonly model: string
  readonly abort: AbortController
  confirmed: boolean
  textOffset: number
  textRead?: Promise<void>
  textError?: string
  timer?: NodeJS.Timeout
  releaseHistory?: () => Promise<void>
  ledger?: RunLedger
  accounting?: () => Promise<RunAccounting>
  initialStatus?: TerminalStatus
  readonly interactions: TerminalInteractions
}
interface TerminalChat {
  readonly ref: SessionRef
  cwd: string
  readonly queue: PendingTurn[]
  readonly accepted: Set<string>
  active: ActiveTurn | undefined
  updatedAt: number
  pumping: boolean
  finishing: boolean
  completion?: Promise<void>
  model: string
  instanceId: string
  opened: boolean
  awaitingReady: boolean
  monitorError?: string
  spec?: ProviderRunSpec
  runMode?: RunMode
  target?: SessionTarget
  status?: TerminalStatus
  telemetryOffset: number
  telemetryRead?: Promise<void>
  config?: SessionConfiguration
  lastLedger?: RunLedger
  releaseHistory?: () => Promise<void>
  readonly interactions: InteractionCoordinator
  backgroundActive?: boolean
  suggestion?: string
}

export interface TerminalChatSessionsOptions {
  readonly terminals: SessionTerminals
  readonly eventsUrl: (ref: SessionRef) => string
  readonly stream: (ref: SessionRef) => SessionStream
  readonly resolveRebound?: (source: SessionRef, next: SessionRef, reason: string, spec: ProviderRunSpec) => Promise<ProviderRunSpec>
  readonly validateMode?: (ref: SessionRef, spec: ProviderRunSpec) => Promise<void>
  readonly beforeOpen: (ref: SessionRef) => Promise<void>
  readonly observe: (ref: SessionRef, cwd: string) => Promise<() => Promise<void>>
  readonly refresh: (ref: SessionRef) => Promise<void>
  readonly confirmationTimeoutMs?: number
  readonly ledger?: (ref: SessionRef, runId: string, turn: UserTurn, spec: ProviderRunSpec, target: SessionTarget) => RunLedger
  readonly accounting?: (ref: SessionRef) => Promise<() => Promise<RunAccounting>>
  readonly configured?: (ref: SessionRef, spec: ProviderRunSpec, model: string) => Promise<void>
}

/** Commands and native keystrokes drive the same persistent program. */
export class TerminalChatSessions {
  private readonly chats = new Map<string, TerminalChat>()
  private readonly rebinding = new Map<string, Promise<void>>()
  private readonly opening = new Map<string, Promise<OpenedSessionTerminal>>()
  private readonly monitor: NodeJS.Timeout
  private readonly textMonitor: NodeJS.Timeout
  private polling = false
  private disposed = false
  private readonly resourcesDirty = new Set<string>()

  constructor(private readonly options: TerminalChatSessionsOptions) {
    // Bubble-only sessions have no terminal WebSocket to report process exits.
    // The persisted state also recovers hooks missed during a runner restart.
    this.monitor = setInterval(() => { void this.poll() }, 1000)
    this.monitor.unref()
    this.textMonitor = setInterval(() => { for (const chat of this.chats.values()) {
      if (chat.active?.confirmed && !chat.finishing) void this.readText(chat)
      if (chat.opened) void this.readTelemetry(chat)
    } }, 80)
    this.textMonitor.unref()
  }

  async open(target: SessionTarget, spec: ProviderRunSpec, size: TerminalSize): Promise<OpenedSessionTerminal> {
    const ref: SessionRef = target.kind === 'resume' ? target.session : { provider: spec.provider, id: target.sessionId ?? randomUUID() }
    const key = sessionRefKey(ref)
    const pending = this.opening.get(key)
    if (pending) return { ...await pending, adopted: true }
    const opening = (async () => {
      await this.options.beforeOpen(ref)
      const chat = this.chat(ref, spec.cwd)
      const opened = await this.options.terminals.open(target.kind === 'resume' ? target : { ...target, sessionId: ref.id },
        spec, { ...size, eventsUrl: this.options.eventsUrl(ref) })
      chat.opened = true
      if (spec.runMode) chat.runMode = spec.runMode
      chat.spec = opened.adopted ? await this.options.terminals.spec(ref) ?? spec : spec
      // Adopted processes must use this session's immutable prompt/tool policy.
      if (chat.spec.runMode !== spec.runMode || chat.spec.systemInstructions !== spec.systemInstructions) {
        if (chat.active || (await this.options.terminals.state(ref))?.phase === 'running') {
          throw new SessionError('session-busy', 'Wait for the terminal reply before applying the session mode')
        }
        await this.restartForMode(chat, spec, size)
      }
      this.publishConfig(chat)
      chat.target ??= target
      chat.awaitingReady = !opened.adopted || chat.awaitingReady
      if (!opened.adopted) { chat.instanceId = ''; chat.updatedAt = 0; chat.telemetryOffset = 0 }
      if (!opened.adopted || !chat.model) chat.model = spec.model
      const state = await this.options.terminals.state(ref)
      if (state) await this.event(ref, state)
      chat.releaseHistory ??= await this.options.observe(ref, chat.cwd)
      await this.readTelemetry(chat)
      await this.readComposer(chat)
      return opened
    })()
    this.opening.set(key, opening)
    try { return await opening } finally { this.opening.delete(key) }
  }

  async submit(ref: SessionRef, turn: UserTurn, spec: ProviderRunSpec, runId: string): Promise<void> {
    if (!await this.options.terminals.isAlive(ref)) throw new SessionError('invalid-request', 'Claude terminal exited; send again to reopen the session')
    const state = await this.options.terminals.state(ref)
    if (!state && !this.chats.get(sessionRefKey(ref))?.awaitingReady) throw new SessionError('invalid-request', 'This terminal was started before chat input synchronization was enabled. Exit it with /exit, then reopen Terminal once; the conversation is preserved.')
    const chat = this.chat(ref, state?.cwd ?? spec.cwd)
    if (chat.cwd !== spec.cwd) throw new SessionError('invalid-request', 'The message working directory differs from the running terminal')
    if (state) await this.event(ref, state)
    if (chat.accepted.has(runId)) return
    chat.accepted.add(runId)
    if (chat.accepted.size > 4096) chat.accepted.delete(chat.accepted.values().next().value ?? '')
    chat.queue.push({ runId, turn, spec })
    void this.drain(chat)
  }

  invalidateResources(): void { for (const key of this.chats.keys()) this.resourcesDirty.add(key) }

  async event(ref: SessionRef, state: TerminalSessionState): Promise<void> {
    if (ref.id !== state.sessionId) {
      if (state.event === 'ready' && ['clear', 'resume', 'fork'].includes(state.source ?? '')) {
        const key = sessionRefKey(ref)
        const pending = this.rebinding.get(key)
        if (pending) return pending
        const operation = this.rebind(ref, state)
        this.rebinding.set(key, operation)
        try { await operation } finally { this.rebinding.delete(key) }
        return
      }
      throw new SessionError('invalid-request', 'Terminal event belongs to another session')
    }
    const chat = this.chat(ref, state.cwd)
    const persistedSpec = chat.spec ?? await this.options.terminals.spec(ref)
    if (persistedSpec) chat.spec = persistedSpec
    if (!chat.runMode && persistedSpec?.runMode) chat.runMode = persistedSpec.runMode
    if (state.event === 'prompt') {
      const spec = chat.spec ?? await this.options.terminals.spec(ref)
      if (spec) await this.options.validateMode?.(ref, spec)
    }
    chat.cwd = state.cwd
    if (chat.instanceId && chat.instanceId !== state.instanceId) return
    chat.instanceId = state.instanceId
    if (state.updatedAt <= chat.updatedAt) return
    chat.updatedAt = state.updatedAt
    chat.opened = true
    chat.awaitingReady = false
    if (state.event === 'prompt') {
      const prompt = this.options.terminals.promptText(ref, state.prompt ?? '')
      // The synchronous UserPromptSubmit hook precedes the API call. Capture
      // the baseline here, after startup or a profile/resource restart.
      await this.readTelemetry(chat)
      if (chat.active) {
        // A bubble start is acknowledged by Claude, not by a successful tmux write.
        if (!chat.active.confirmed && normalize(chat.active.text) === normalize(prompt)) {
          chat.active.confirmed = true
          if (chat.status) chat.active.initialStatus = chat.status
          clearTimeout(chat.active.timer)
        }
        return
      }
      await this.begin(chat, prompt, randomUUID(), chat.model, true, state.updatedAt, true)
      return
    }
    if (state.event === 'exit') {
      if (!['clear', 'resume', 'fork'].includes(state.reason ?? '')) await this.exited(ref, 'Claude terminal exited')
      return
    }
    if (state.event === 'stop' || state.event === 'failure') {
      // Let the synchronous native hook return before waiting for statusLine:
      // Claude updates its final cost after Stop hooks have completed.
      void this.finish(chat, state.event === 'failure'
        ? { type: 'run.failed', message: state.message ?? 'Claude stopped with an API error' }
        : { type: 'run.completed', model: chat.active?.model ?? chat.model, durationMs: Date.now() - (chat.active?.startedAt ?? Date.now()) }, state.updatedAt)
        .catch((error: unknown) => this.options.stream(ref).publish({ type: 'error', code: 'terminal.completion', message: error instanceof Error ? error.message : String(error) }))
    }
  }

  private async rebind(ref: SessionRef, state: TerminalSessionState): Promise<void> {
    const old = this.chats.get(sessionRefKey(ref))
    if (!old && this.chats.get(sessionRefKey({ ...ref, id: state.sessionId }))?.instanceId === state.instanceId) return
    if (old?.instanceId && old.instanceId !== state.instanceId) return
    const sourceSpec = old?.spec ?? await this.options.terminals.spec(ref)
    const nextRef = { ...ref, id: state.sessionId }
    const nextSpec = sourceSpec ? await this.options.resolveRebound?.(ref, nextRef, state.source ?? '', { ...sourceSpec, cwd: state.cwd }) ?? sourceSpec : undefined
    const queue = old?.queue.splice(0) ?? []
    if (old) {
      await this.finish(old, /^\/(clear|resume|fork)(\s|$)/u.test(old.active?.text.trim() ?? '')
        ? { type: 'run.completed', model: old.model, durationMs: Date.now() - (old.active?.startedAt ?? Date.now()) }
        : { type: 'run.aborted', message: 'Session changed in terminal' })
      old.interactions.cancelAll()
      await old.releaseHistory?.()
    }
    const next = { ...ref, id: state.sessionId }
    if (this.resourcesDirty.delete(sessionRefKey(ref))) this.resourcesDirty.add(sessionRefKey(next))
    await this.options.terminals.rebind(ref, next)
    this.chats.delete(sessionRefKey(ref))
    const chat = this.chat(next, state.cwd)
    chat.model = old?.model ?? ''
    if (nextSpec?.runMode) chat.runMode = nextSpec.runMode
    if (sourceSpec) chat.spec = { ...sourceSpec, cwd: state.cwd }
    chat.target = state.source === 'fork' ? { kind: 'fork', source: ref, sessionId: next.id } : { kind: 'resume', session: next }
    chat.telemetryOffset = old?.telemetryOffset ?? 0
    chat.backgroundActive = old?.backgroundActive ?? this.options.stream(ref).tasks.hasActive
    chat.queue.push(...queue.map((pending) => ({ ...pending, spec: nextSpec ? { ...pending.spec,
      ...(nextSpec.runMode ? { runMode: nextSpec.runMode } : {}),
      ...(nextSpec.systemInstructions ? { systemInstructions: nextSpec.systemInstructions } : {}),
    } : pending.spec })))
    await this.event(next, state)
    try {
      if (nextSpec && (sourceSpec?.runMode !== nextSpec.runMode || sourceSpec?.systemInstructions !== nextSpec.systemInstructions)) {
        await this.restartForMode(chat, nextSpec, { cols: 120, rows: 40 })
      }
    } finally {
      // Native commands already changed the transcript. Keep both views bound
      // even if tasks prevent a restart; the prompt hook blocks a wrong mode.
      this.publishConfig(chat)
      chat.releaseHistory = await this.options.observe(next, state.cwd)
      this.options.stream(ref).publish({ type: 'session.rebound', nextSessionId: next.id })
    }
    void this.drain(chat)
  }

  async abort(ref: SessionRef, runId?: string): Promise<boolean> {
    const chat = this.chats.get(sessionRefKey(ref))
    if (!chat?.active || (runId && chat.active.runId !== runId)) return false
    chat.active.abort.abort()
    await this.options.terminals.sendKeys(ref, ['Escape'])
    await this.recordInterrupted(chat)
    await this.finish(chat, { type: 'run.aborted', message: 'Interrupted' }, chat.updatedAt)
    return true
  }

  async question(ref: SessionRef, question: TerminalQuestion, signal: AbortSignal): Promise<Record<string, unknown>> {
    const chat = this.chat(ref, question.cwd)
    if (!chat.active) await this.begin(chat, '', randomUUID(), chat.model, true)
    const active = chat.active
    if (!active) throw new SessionError('invalid-request', 'The question has no active terminal turn')
    this.options.stream(ref).publish({ type: 'session.state', state: 'requires_action' }, active.runId)
    const tool = question.tool ?? 'AskUserQuestion'
    await this.readTelemetry(chat)
    const toolUseId = active.interactions.toolId(question)
    const result = await chat.interactions.request({ ...(tool === 'AskUserQuestion' ? { kind: 'question' as const, questions: normalizeQuestions(question.input['questions']) } : { kind: 'tool' as const }), tool,
      input: question.input,
      ...(toolUseId ? { toolUseId } : {}) },
    { signal: AbortSignal.any([signal, active.abort.signal]) })
    if (chat.active === active && !active.abort.signal.aborted) this.options.stream(ref).publish({ type: 'session.state', state: 'running' }, active.runId)
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: result.decision === 'allow'
      ? { behavior: 'allow', updatedInput: { ...question.input, ...(tool === 'AskUserQuestion' ? { answers: answersByQuestion(result) } : {}) } }
      : { behavior: 'deny', message: `Question ${result.reason}` } } }
  }

  async elicitation(ref: SessionRef, input: TerminalElicitation, signal: AbortSignal): Promise<Record<string, unknown>> {
    const form = input.mode !== 'url' && input.schema ? terminalElicitationForm(input.schema) : undefined
    if (!form) {
      this.options.stream(ref).publish({ type: 'terminal.focus', reason: input.message })
      return {} // Native authentication / unsupported forms remain native dialogs.
    }
    const chat = this.chat(ref, input.cwd)
    if (!chat.active) await this.begin(chat, '', randomUUID(), chat.model, true)
    const active = chat.active
    if (!active) throw new SessionError('invalid-request', 'The elicitation has no active terminal turn')
    this.options.stream(ref).publish({ type: 'session.state', state: 'requires_action' }, active.runId)
    const result = await chat.interactions.request({ kind: 'question', tool: `mcp__${input.serverName}__elicitation`,
      title: input.message, questions: form.questions, input: { schema: input.schema, ...(input.elicitationId ? { elicitationId: input.elicitationId } : {}) } },
    { signal: AbortSignal.any([signal, active.abort.signal]), validate: (response) => { form.content(response) } })
    if (chat.active === active && !active.abort.signal.aborted) this.options.stream(ref).publish({ type: 'session.state', state: 'running' }, active.runId)
    return { hookSpecificOutput: { hookEventName: 'Elicitation', action: result.decision === 'allow' ? 'accept' : result.reason === 'skipped' ? 'decline' : 'cancel',
      ...(result.decision === 'allow' ? { content: form.content({ decision: 'allow', ...(result.answers ? { answers: result.answers } : {}) }) } : {}) } }
  }

  respondPermission(ref: SessionRef, response: InteractionResponse): boolean {
    const chat = this.chats.get(sessionRefKey(ref))
    if (!chat?.interactions.has(response.requestId)) return false
    chat.interactions.respond(response)
    return true
  }

  history(ref: SessionRef, items: readonly ThreadReplayItem[]): void {
    const chat = this.chats.get(sessionRefKey(ref))
    const active = chat?.active
    if (!chat || !active) return
    for (const item of items) if (item.kind === 'frame') {
      const resolved = active.interactions.native(item.event, 'transcript')
      if (resolved && item.event.type === 'permission.resolved' && item.event.resolution.request.kind === 'tool'
        && resolved.decision === 'deny' && resolved.reason === 'skipped' && !chat.finishing) {
        // Native manual rejection interrupts the loop without emitting Stop.
        // Do not await completion inside the transcript observer it refreshes.
        void this.recordInterrupted(chat).then(() => this.finish(chat, { type: 'run.aborted', message: 'Tool use rejected in terminal' }, chat.updatedAt))
          .catch((error: unknown) => this.options.stream(ref).publish({ type: 'error', code: 'terminal.completion', message: error instanceof Error ? error.message : String(error) }))
      }
    }
  }

  async input(ref: SessionRef, bytes: Uint8Array): Promise<void> {
    // Arrow/function keys are multi-byte escape sequences, not cancellation.
    if (bytes.length !== 1 || (bytes[0] !== 27 && bytes[0] !== 3)) return
    const chat = this.chats.get(sessionRefKey(ref))
    if (chat?.active) {
      await this.recordInterrupted(chat)
      await this.finish(chat, { type: 'run.aborted', message: 'Interrupted in terminal' }, chat.updatedAt)
    }
  }

  async exited(ref: SessionRef, reason: string): Promise<void> {
    const chat = this.chats.get(sessionRefKey(ref))
    if (!chat) return
    this.publishSuggestion(chat)
    for (const pending of chat.queue.splice(0)) this.options.stream(ref).publish({ type: 'error', code: 'run.start', message: reason }, pending.runId)
    await this.finish(chat, { type: 'run.failed', message: reason })
    await chat.releaseHistory?.()
    this.chats.delete(sessionRefKey(ref))
  }

  async dispose(): Promise<void> {
    this.disposed = true
    clearInterval(this.monitor)
    clearInterval(this.textMonitor)
    for (const chat of this.chats.values()) {
      await chat.completion
      chat.interactions.cancelAll()
      chat.active?.abort.abort()
      chat.active?.interactions.finish()
      clearTimeout(chat.active?.timer)
      await chat.active?.releaseHistory?.()
      chat.active?.ledger?.settle(true)
      await chat.releaseHistory?.()
    }
    this.chats.clear()
  }

  private chat(ref: SessionRef, cwd: string): TerminalChat {
    const key = sessionRefKey(ref)
    let chat = this.chats.get(key)
    if (!chat) {
      chat = { ref, cwd, queue: [], accepted: new Set(), active: undefined, updatedAt: 0, pumping: false, finishing: false, model: '', instanceId: '', opened: false, awaitingReady: false, telemetryOffset: 0,
        interactions: new InteractionCoordinator((event) => {
          const active = this.chats.get(key)?.active
          if (event.type === 'permission.requested' || event.type === 'permission.resolved') active?.interactions.mirror(event)
        }) }
      this.chats.set(key, chat)
    }
    return chat
  }

  private publishConfig(chat: TerminalChat): void {
    if (!chat.spec) return
    this.options.stream(chat.ref).publish({ type: 'session.config', config: {
      model: chat.model || chat.spec.model, cwd: chat.cwd, context: chat.status?.context ?? emptyContextUsage(),
      ...(chat.runMode ? { runMode: chat.runMode } : {}),
      ...(chat.spec.profileId ? { profileId: chat.spec.profileId } : {}), ...(chat.spec.effort ? { effort: chat.spec.effort } : {}),
    } })
  }

  private async restartForMode(chat: TerminalChat, spec: ProviderRunSpec, size: TerminalSize): Promise<void> {
    chat.instanceId = ''; chat.updatedAt = 0; chat.awaitingReady = true; chat.telemetryOffset = 0
    await this.options.terminals.configure(chat.ref, spec, { ...size, eventsUrl: this.options.eventsUrl(chat.ref) },
      AbortSignal.timeout(30000), true, !(chat.backgroundActive ?? this.options.stream(chat.ref).tasks.hasActive))
    chat.spec = spec
  }

  private async recordInterrupted(chat: TerminalChat): Promise<void> {
    // Claude's Stop hook is deliberately not fired on a user interrupt.
    chat.updatedAt = Math.max(Date.now(), chat.updatedAt + 1)
    await this.options.terminals.recordState(chat.ref, { sessionId: chat.ref.id, instanceId: chat.instanceId, cwd: chat.cwd,
      phase: 'idle', event: 'stop', updatedAt: chat.updatedAt })
  }

  private async begin(chat: TerminalChat, text: string, runId: string, model: string, confirmed: boolean, startedAt = Date.now(), nativePrompt = false): Promise<ActiveTurn> {
    this.publishSuggestion(chat)
    const active: ActiveTurn = { runId, text, model, confirmed, textOffset: 0, startedAt, abort: new AbortController(),
      interactions: new TerminalInteractions((event) => {
        active.ledger?.observe(event)
        this.options.stream(chat.ref).publish(event, runId)
      }, (event) => this.options.stream(chat.ref).publish(event, runId)) }
    chat.active = active
    const spec = chat.spec ?? await this.options.terminals.spec(chat.ref)
    if (spec) chat.spec = spec
    if (chat.spec) {
      const ledger = this.options.ledger?.(chat.ref, runId, userTurnFromText(text), { ...chat.spec, cwd: chat.cwd, model }, chat.target ?? { kind: 'resume', session: chat.ref })
      if (ledger) active.ledger = ledger
      chat.target = { kind: 'resume', session: chat.ref }
      if (active.ledger) chat.lastLedger = active.ledger
    }
    const accounting = await this.options.accounting?.(chat.ref)
    if (accounting) active.accounting = accounting
    if (chat.status) active.initialStatus = chat.status
    active.releaseHistory = await this.options.observe(chat.ref, chat.cwd)
    await this.options.refresh(chat.ref)
    const turn = userTurnFromText(text)
    const stream = this.options.stream(chat.ref)
    stream.startTerminalTurn(runId, model, {
      id: `${runId}:user`, role: 'user', content: turn.text,
      ...(turn.attachments?.length ? { attachments: turn.attachments } : {}),
      createdAt: new Date(active.startedAt).toISOString(), status: 'complete',
    }, nativePrompt)
    stream.publish({ type: 'session.state', state: 'running' }, runId)
    return active
  }

  private async drain(chat: TerminalChat): Promise<void> {
    if (chat.pumping || this.isBusy(chat) || chat.finishing) return
    chat.pumping = true
    try {
      while (!this.isBusy(chat) && chat.queue.length) {
        // A native user can begin a turn between the chat request and its injection.
        const state = await this.options.terminals.state(chat.ref)
        if (state?.phase === 'running' && state.updatedAt > chat.updatedAt) await this.event(chat.ref, state)
        if (this.isBusy(chat)) return
        const pending = chat.queue.shift()
        if (!pending) return
        try {
          await this.inject(chat, pending)
        } catch (error) {
          if (chat.active?.runId === pending.runId && !chat.active.abort.signal.aborted) {
            await this.finish(chat, { type: 'run.failed', message: error instanceof Error ? error.message : String(error) })
          }
        }
      }
    } catch (error) {
      for (const pending of chat.queue.splice(0)) this.options.stream(chat.ref).publish({ type: 'error', code: 'run.start',
        message: error instanceof Error ? error.message : String(error) }, pending.runId)
    } finally {
      chat.pumping = false
      if (!this.isBusy(chat) && chat.queue.length) void this.drain(chat)
    }
  }

  private isBusy(chat: TerminalChat): boolean { return chat.active !== undefined }

  private async inject(chat: TerminalChat, pending: PendingTurn): Promise<void> {
    chat.spec = pending.spec
    const active = await this.begin(chat, userTurnText(pending.turn), pending.runId, pending.spec.model, false)
    if (await this.options.terminals.configure(chat.ref, pending.spec, { cols: 120, rows: 40, eventsUrl: this.options.eventsUrl(chat.ref) }, active.abort.signal,
      this.resourcesDirty.has(sessionRefKey(chat.ref)), !(chat.backgroundActive ?? this.options.stream(chat.ref).tasks.hasActive))) {
      chat.instanceId = ''; chat.updatedAt = 0; chat.awaitingReady = true; chat.telemetryOffset = 0
      this.resourcesDirty.delete(sessionRefKey(chat.ref))
    }
    chat.model = pending.spec.model
    await this.options.terminals.submit(chat.ref, active.text, active.abort.signal)
    if (await this.options.terminals.completeCommand(chat.ref, active.text, active.abort.signal)) {
      await this.finish(chat, { type: 'run.completed', model: chat.model, durationMs: Date.now() - active.startedAt })
      return
    }
    if (!active.confirmed && chat.active === active) {
      active.timer = setTimeout(() => {
        void this.finish(chat, { type: 'run.failed', message: 'Claude did not acknowledge the message. Check the Terminal input or dialog before sending again; the message was not retried.' })
      }, this.options.confirmationTimeoutMs ?? 15000)
      active.timer.unref()
    }
  }

  private finish(chat: TerminalChat, result: AgentEvent, statusAfter?: number): Promise<void> {
    if (chat.completion) return chat.completion
    const active = chat.active
    if (!active) return Promise.resolve()
    chat.finishing = true
    chat.completion = this.finishTurn(chat, active, result, statusAfter).finally(() => {
      delete chat.completion
      chat.active = undefined
      chat.finishing = false
      void this.drain(chat)
    })
    return chat.completion
  }

  private async finishTurn(chat: TerminalChat, active: ActiveTurn, result: AgentEvent, statusAfter?: number): Promise<void> {
    active.abort.abort()
    clearTimeout(active.timer)
    let final = result
    try {
      await active.textRead
      await this.readText(chat)
      await this.readTelemetry(chat)
      if (statusAfter && active.initialStatus?.updatedAt) {
        const deadline = Date.now() + 2000
        while (!this.disposed && (chat.status?.updatedAt ?? 0) < statusAfter && Date.now() < deadline) {
          await delay(50)
          await this.readTelemetry(chat)
        }
      }
      // Interruption does not emit Stop. Give pending status/transcript writes
      // time to finish before settling the usage that Claude has reported.
      await this.options.refresh(chat.ref)
      if (result.type === 'run.completed' || result.type === 'run.failed' || result.type === 'run.aborted') {
        const accounting = await active.accounting?.()
        const before = active.initialStatus, after = chat.status
        const fresh = !statusAfter || (after?.updatedAt ?? 0) >= statusAfter
        // Claude can leave statusLine unchanged on Escape. A positive delta
        // already reported during this turn is still incurred cost; an old,
        // unchanged baseline must not be presented as a known zero bill.
        const interruptedStatus = result.type === 'run.aborted' && (after?.updatedAt ?? 0) >= active.startedAt
        const costUsd = after?.costUsd !== undefined && before?.costUsd !== undefined && after.instanceId === before.instanceId
          && (fresh || (interruptedStatus && after.costUsd > before.costUsd))
          ? Math.max(0, after.costUsd - before.costUsd) : undefined
        const apiDurationMs = after?.apiDurationMs !== undefined && before?.apiDurationMs !== undefined && after.instanceId === before.instanceId
          && (fresh || (interruptedStatus && after.apiDurationMs > before.apiDurationMs))
          ? Math.max(0, after.apiDurationMs - before.apiDurationMs) : undefined
        final = { ...result, ...accounting, ...(costUsd === undefined ? {} : { costUsd }), ...(apiDurationMs === undefined ? {} : { apiDurationMs }) }
      }
    } catch (error) {
      const message = `Could not synchronize terminal completion: ${error instanceof Error ? error.message : String(error)}`
      if (result.type === 'run.aborted') this.options.stream(chat.ref).publish({ type: 'error', code: 'terminal.completion', message }, active.runId)
      else final = { type: 'run.failed', message }
    } finally {
      active.interactions.finish()
      active.ledger?.observe(final)
      this.options.stream(chat.ref).publish(final, active.runId)
      this.options.stream(chat.ref).publish({ type: 'session.state', state: 'idle' }, active.runId)
      await active.releaseHistory?.()
    }
  }

  status(ref: SessionRef): TerminalStatus | undefined { return this.chats.get(sessionRefKey(ref))?.status }

  async manageTasks(ref: SessionRef): Promise<void> {
    const chat = this.chats.get(sessionRefKey(ref))
    if (chat) delete chat.backgroundActive
    const stream = this.options.stream(ref)
    for (const task of stream.tasks.list()) if (['pending', 'running', 'paused'].includes(task.status)) {
      stream.publish({ type: 'task.updated', task: { ...task, status: 'unknown' } })
    }
    this.options.stream(ref).publish({ type: 'terminal.focus', reason: 'Manage background tasks in Claude Code' })
    // /tasks is an immediate native command, including while the model runs.
    // Do not create a fake run or mark a task stopped before Claude stops it.
    await this.options.terminals.submit(ref, '/tasks', AbortSignal.timeout(30000))
  }

  list(provider: SessionRef['provider']) {
    return [...this.chats.values()].filter((chat) => chat.ref.provider === provider).map((chat) => ({
      ref: chat.ref, ...(chat.runMode ? { runMode: chat.runMode } : {}), ...(chat.active ? { runId: chat.active.runId, startedAt: chat.active.startedAt } : {}) }))
  }

  private readTelemetry(chat: TerminalChat): Promise<void> {
    if (chat.telemetryRead) return chat.telemetryRead
    chat.telemetryRead = (async () => {
      try {
        const batch = await this.options.terminals.telemetry(chat.ref, chat.telemetryOffset)
        if (this.disposed) return
        chat.telemetryOffset = batch.offset
        for (const item of batch.events) {
          if (item.sessionId !== chat.ref.id || (chat.instanceId && item.instanceId !== chat.instanceId)) continue
          if (item.cwd) { chat.cwd = item.cwd; if (chat.spec) chat.spec = { ...chat.spec, cwd: item.cwd } }
          const event = item.event
          chat.active?.interactions.native(event, 'hook')
          if (event.type === 'permission.resolved') continue
          if (event.type === 'tasks.snapshot') chat.backgroundActive = event.tasks.some((task) => !['completed', 'failed', 'cancelled'].includes(task.status))
          ;(chat.active?.ledger ?? chat.lastLedger)?.observe(event)
          // Child tools are projected by their owning transcript. An agent_id
          // alone is not a parent tool address and must not create main bubbles.
          if (!('agentId' in event && event.agentId && event.type.startsWith('tool.'))) this.options.stream(chat.ref).publish(event, chat.active?.runId)
          if (event.type === 'session.compacting' && chat.active) { chat.active.confirmed = true; clearTimeout(chat.active.timer) }
          if (event.type === 'session.compacted' && /^\/compact(?:\s|$)/u.test(chat.active?.text.trim() ?? '')) {
            // Finish outside this read to avoid waiting on ourselves.
            queueMicrotask(() => { void this.finish(chat, { type: 'run.completed', model: chat.model, durationMs: Date.now() - (chat.active?.startedAt ?? Date.now()) }) })
          }
        }
        const status = batch.status
        if (status?.sessionId === chat.ref.id && (!chat.instanceId || status.instanceId === chat.instanceId)) {
          chat.status = status
          chat.model = status.model
          chat.cwd = status.cwd || chat.cwd
          if (chat.spec) chat.spec = { ...chat.spec, cwd: chat.cwd, model: status.model, modelContext: splitModelContext(status.model).context, ...(status.effort ? { effort: status.effort } : {}) }
          const config: SessionConfiguration = { model: status.model, cwd: chat.cwd, context: status.context,
            ...(chat.runMode ? { runMode: chat.runMode } : {}),
            ...(status.profileId ? { profileId: status.profileId } : {}), ...(status.effort ? { effort: status.effort } : {}) }
          if (JSON.stringify(config) !== JSON.stringify(chat.config)) {
            const modelChanged = chat.config?.model !== config.model || chat.config.profileId !== config.profileId
            chat.config = config
            this.options.stream(chat.ref).publish({ type: 'session.config', config })
            if (modelChanged && chat.spec) await this.options.configured?.(chat.ref, chat.spec, status.model)
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message !== chat.monitorError) this.options.stream(chat.ref).publish({ type: 'error', code: 'terminal.telemetry', message })
        chat.monitorError = message
      }
    })().finally(() => { delete chat.telemetryRead })
    return chat.telemetryRead
  }

  private publishSuggestion(chat: TerminalChat, suggestion?: string): void {
    if (chat.suggestion === suggestion) return
    if (suggestion) chat.suggestion = suggestion
    else delete chat.suggestion
    this.options.stream(chat.ref).publish({ type: 'suggestion.prompts', prompts: suggestion ? [suggestion] : [] })
  }

  private async readComposer(chat: TerminalChat): Promise<TerminalComposer | undefined> {
    if (this.composerBusy(chat)) return undefined
    const updatedAt = chat.updatedAt, instanceId = chat.instanceId
    const composer = await this.options.terminals.composer(chat.ref)
    if (this.disposed || this.chats.get(sessionRefKey(chat.ref)) !== chat || this.composerBusy(chat) ||
      updatedAt !== chat.updatedAt || instanceId !== chat.instanceId) return undefined
    this.publishSuggestion(chat, chat.spec?.promptSuggestions === false ? undefined : composer?.suggestion)
    return composer
  }

  private composerBusy(chat: TerminalChat): boolean {
    return chat.active !== undefined || chat.pumping || chat.finishing || chat.awaitingReady
  }

  private async reloadResources(chat: TerminalChat, composer: TerminalComposer | undefined): Promise<void> {
    const key = sessionRefKey(chat.ref)
    if (!this.resourcesDirty.has(key) || chat.active || chat.pumping || chat.finishing || !chat.spec || (chat.backgroundActive ?? this.options.stream(chat.ref).tasks.hasActive)) return
    // Do not discard a native draft or close a user-owned dialog to reload.
    if (composer?.text.trim() !== '') return
    if (this.isBusy(chat) || (await this.options.terminals.state(chat.ref))?.phase !== 'idle') return
    chat.pumping = true
    chat.awaitingReady = true
    try {
      await this.options.terminals.configure(chat.ref, chat.spec, { cols: 120, rows: 40, eventsUrl: this.options.eventsUrl(chat.ref) }, new AbortController().signal, true)
      chat.instanceId = ''; chat.updatedAt = 0; chat.telemetryOffset = 0; chat.awaitingReady = true
      this.resourcesDirty.delete(key)
    } finally { chat.pumping = false; void this.drain(chat) }
  }

  private readText(chat: TerminalChat): Promise<void> {
    const active = chat.active
    if (!active?.confirmed) return Promise.resolve()
    if (active.textRead) return active.textRead
    active.textRead = (async () => {
      try {
        const batch = await this.options.terminals.text(chat.ref, active.textOffset)
        if (chat.active !== active || this.disposed) return
        active.textOffset = batch.offset
        delete active.textError
        for (const delta of batch.deltas) if (delta.sessionId === chat.ref.id) this.options.stream(chat.ref).publishTerminalText(delta)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (active.textError !== message) this.options.stream(chat.ref).publish({ type: 'error', code: 'terminal.text', message })
        active.textError = message
      }
    })().finally(() => { delete active.textRead })
    return active.textRead
  }

  private async poll(): Promise<void> {
    if (this.polling || this.isDisposed()) return
    this.polling = true
    try {
      for (const chat of this.chats.values()) {
        if (this.isDisposed()) break
        if (!chat.opened || this.opening.has(sessionRefKey(chat.ref))) continue
        try {
          const alive = await this.options.terminals.isAlive(chat.ref)
          if (this.isDisposed()) break
          if (!alive) {
            if (this.chats.get(sessionRefKey(chat.ref)) !== chat || this.opening.has(sessionRefKey(chat.ref))) continue
            await this.exited(chat.ref, 'Claude terminal exited')
            continue
          }
          const state = await this.options.terminals.state(chat.ref)
          if (this.isDisposed()) break
          if (state && this.chats.get(sessionRefKey(chat.ref)) === chat) await this.event(chat.ref, state)
          const composer = await this.readComposer(chat)
          await this.reloadResources(chat, composer)
          delete chat.monitorError
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (message !== chat.monitorError) this.options.stream(chat.ref).publish({ type: 'error', code: 'terminal.state', message })
          chat.monitorError = message
        }
      }
    } finally { this.polling = false }
  }

  // Disposal can occur while a terminal read is awaiting IO.
  private isDisposed(): boolean { return this.disposed }
}

function normalize(text: string): string { return text.replaceAll('\r\n', '\n').trim() }
