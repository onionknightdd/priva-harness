import type {
  AgentProvider,
  AgentRuntime,
  ProviderId,
  ProviderRunSpec,
  SessionTarget,
  SlashCommandListRequest,
  TurnContext,
} from '../../src/core/contract/agent-provider.js'
import type { AgentEvent } from '../../src/core/event/agent-event.js'
import type { SlashCommand } from '../../src/core/resource/slash-command.js'
import type { UserTurn } from '../../src/core/run/user-turn.js'
import { FakeSessionStore } from './fake-session-store.js'

export class FakeAgentProvider implements AgentProvider {
  readonly id: ProviderId
  readonly sessions: FakeSessionStore
  readonly events: readonly AgentEvent[]
  readonly released: string[] = []
  readonly specs: ProviderRunSpec[] = []
  readonly targets: SessionTarget[] = []
  readonly slashRequests: SlashCommandListRequest[] = []
  slashCommands: readonly SlashCommand[] = []
  gate: Promise<void> | undefined
  afterEventsGate: Promise<void> | undefined
  lastRuntime: FakeAgentRuntime | undefined
  delayMs = 0

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
    void turn
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
    for (const event of this.provider.events) {
      yield withSession(event, this.session.id)
    }
    if (this.provider.afterEventsGate !== undefined) {
      await waitAbortable(this.provider.afterEventsGate, context.signal)
    }
  }

  applyRunSpec(): Promise<void> {
    return Promise.resolve()
  }

  abort(): Promise<void> {
    return Promise.resolve()
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
