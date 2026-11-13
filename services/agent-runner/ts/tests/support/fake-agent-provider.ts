import type {
  AgentProvider,
  AgentRuntime,
  ProviderId,
  ProviderRunSpec,
  SessionRef,
  SessionTarget,
  SlashCommandListRequest,
  TurnContext,
} from '../../src/core/contract/agent-provider.js'
import type { TerminalLaunchContext, TerminalLaunchSpec } from '../../src/core/contract/terminal-service.js'
import type { AgentEvent } from '../../src/core/event/agent-event.js'
import { emptyContextUsage } from '../../src/core/resource/context-usage.js'
import type { ContextUsage } from '../../src/core/resource/context-usage.js'
import { normalizeQuestions, type InteractionResolution, type InteractionResponse } from '../../src/core/resource/interaction.js'
import type { SlashCommand } from '../../src/core/resource/slash-command.js'
import { InteractionCoordinator } from '../../src/core/run/interaction-coordinator.js'
import type { UserTurn } from '../../src/core/run/user-turn.js'
import { FakeSessionStore } from './fake-session-store.js'

export interface FakeQuestion {
  readonly question: string
  readonly options: readonly { readonly label: string }[]
}

export class FakeAgentProvider implements AgentProvider {
  readonly id: ProviderId
  readonly sessions: FakeSessionStore
  readonly events: readonly AgentEvent[]
  readonly released: string[] = []
  readonly specs: ProviderRunSpec[] = []
  readonly turns: UserTurn[] = []
  readonly targets: SessionTarget[] = []
  readonly slashRequests: SlashCommandListRequest[] = []
  slashCommands: readonly SlashCommand[] = []
  gate: Promise<void> | undefined
  afterEventsGate: Promise<void> | undefined
  /** When set, each run asks this with AskUserQuestion before its events and waits for the answer. */
  question: FakeQuestion | undefined
  readonly resolutions: InteractionResolution[] = []
  lastRuntime: FakeAgentRuntime | undefined
  delayMs = 0
  contextUsage: ContextUsage = emptyContextUsage()
  measureContextUsage: ((session: SessionRef, spec: ProviderRunSpec) => Promise<ContextUsage>) | undefined =
    undefined
  terminalLaunch?: (target: SessionTarget, spec: ProviderRunSpec, context: TerminalLaunchContext) => Promise<TerminalLaunchSpec>

  constructor(id: ProviderId, events: readonly AgentEvent[], sessions = new FakeSessionStore()) {
    this.id = id
    this.events = events
    this.sessions = sessions
  }

  openSession(target: SessionTarget, spec: ProviderRunSpec): Promise<AgentRuntime> {
    this.targets.push(target)
    this.specs.push(spec)
    const runtime = new FakeAgentRuntime(this, target)
    this.lastRuntime = runtime
    return Promise.resolve(runtime)
  }

  listSlashCommands(request: SlashCommandListRequest): Promise<readonly SlashCommand[]> {
    this.slashRequests.push(request)
    return Promise.resolve(this.slashCommands)
  }

  emitIdle(events: readonly AgentEvent[]): void {
    this.lastRuntime?.emitIdle(events)
  }
}

export class FakeAgentRuntime implements AgentRuntime {
  readonly session
  private idleListener: ((events: readonly AgentEvent[]) => void) | undefined
  private coordinator: InteractionCoordinator | undefined

  constructor(
    private readonly provider: FakeAgentProvider,
    target: SessionTarget,
  ) {
    this.session = { provider: provider.id, id: sessionIdFor(target) }
  }

  listenIdle(listener: ((events: readonly AgentEvent[]) => void) | undefined): void {
    this.idleListener = listener
  }

  emitIdle(events: readonly AgentEvent[]): void {
    this.idleListener?.(events)
  }

  async *run(turn: UserTurn, context: TurnContext): AsyncIterable<AgentEvent> {
    this.provider.turns.push(turn)
    if (this.provider.gate !== undefined) {
      await waitAbortable(this.provider.gate, context.signal)
    }
    if (this.provider.delayMs > 0) {
      await delay(this.provider.delayMs, context.signal)
    }
    if (context.signal.aborted) {
      yield { type: 'run.aborted', sessionId: this.session.id }
      return
    }
    if (this.provider.question !== undefined) yield* this.ask(this.provider.question, context.signal)
    for (const event of this.provider.events) {
      yield withSession(event, this.session.id)
    }
    if (this.provider.afterEventsGate !== undefined) {
      await waitAbortable(this.provider.afterEventsGate, context.signal)
    }
  }

  respondPermission(response: InteractionResponse): void {
    if (this.coordinator === undefined) throw new Error('No interaction was requested')
    this.coordinator.respond(response)
  }

  /** The tool call, then the request and its resolution as the coordinator emits them. */
  private async *ask(question: FakeQuestion, signal: AbortSignal): AsyncIterable<AgentEvent> {
    const input = { questions: [{ question: question.question, options: question.options.map(({ label }) => ({ label })) }] }
    const emitted: AgentEvent[] = []
    let wake: (() => void) | undefined
    this.coordinator = new InteractionCoordinator((event) => {
      emitted.push(event)
      wake?.()
    })
    yield { type: 'assistant.message', messageId: 'msg_q', blocks: [{ type: 'tool_use', blockId: 'toolu_q', index: 0, id: 'toolu_q', name: 'AskUserQuestion', input }] }
    let resolution: InteractionResolution | undefined
    void this.coordinator.request({ kind: 'question', tool: 'AskUserQuestion', toolUseId: 'toolu_q', input, questions: normalizeQuestions(input.questions) }, { signal })
      .then((result) => {
        resolution = result
        wake?.()
      })
    for (;;) {
      for (let event = emitted.shift(); event !== undefined; event = emitted.shift()) yield event
      if (resolution !== undefined) break
      await new Promise<void>((resolve) => { wake = resolve })
    }
    this.provider.resolutions.push(resolution)
    yield { type: 'tool.completed', messageId: 'msg_q', blockId: 'toolu_q', id: 'toolu_q', name: 'AskUserQuestion',
      ok: resolution.decision === 'allow', output: resolution.decision === 'allow' ? 'answered' : 'declined', durationMs: 1 }
  }

  applyRunSpec(): Promise<void> {
    return Promise.resolve()
  }

  abort(): Promise<void> {
    return Promise.resolve()
  }

  getContextUsage(): Promise<ContextUsage> {
    return Promise.resolve(this.provider.contextUsage)
  }

  release(retention: 'warm' | 'dispose'): Promise<void> {
    this.provider.released.push(retention)
    if (retention === 'dispose') this.idleListener = undefined
    return Promise.resolve()
  }
}

function sessionIdFor(target: SessionTarget): string {
  if (target.kind === 'resume') return target.session.id
  if (target.kind === 'fork') return target.sessionId ?? `fork-${target.source.id}`
  return target.sessionId ?? 'session-1'
}

function withSession(event: AgentEvent, sessionId: string): AgentEvent {
  if (!('sessionId' in event)) return event
  return { ...event, sessionId }
}

function waitAbortable(gate: Promise<void>, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      signal.removeEventListener('abort', done)
      resolve()
    }
    if (signal.aborted) {
      done()
      return
    }
    signal.addEventListener('abort', done, { once: true })
    void gate.then(done)
  })
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
