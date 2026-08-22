import type {
  AgentProvider,
  AgentRuntime,
  ProviderId,
  ProviderRunSpec,
  SessionTarget,
  TurnContext,
} from '../../src/core/contract/agent-provider.js'
import type { AgentEvent } from '../../src/core/event/agent-event.js'
import type { UserTurn } from '../../src/core/run/user-turn.js'
import { FakeSessionStore } from './fake-session-store.js'

export class FakeAgentProvider implements AgentProvider {
  readonly id: ProviderId
  readonly sessions: FakeSessionStore
  readonly events: readonly AgentEvent[]
  readonly released: string[] = []
  readonly specs: ProviderRunSpec[] = []

  constructor(id: ProviderId, events: readonly AgentEvent[], sessions = new FakeSessionStore()) {
    this.id = id
    this.events = events
    this.sessions = sessions
  }

  openSession(target: SessionTarget, spec: ProviderRunSpec): Promise<AgentRuntime> {
    this.specs.push(spec)
    if (target.kind !== 'new') {
      return Promise.reject(new Error('Fake provider only supports new sessions'))
    }
    return Promise.resolve(new FakeAgentRuntime(this))
  }
}

class FakeAgentRuntime implements AgentRuntime {
  readonly session

  constructor(private readonly provider: FakeAgentProvider) {
    this.session = { provider: provider.id, id: 'session-1' }
  }

  run(turn: UserTurn, context: TurnContext): AsyncIterable<AgentEvent> {
    void turn
    void context
    const events = this.provider.events
    return {
      [Symbol.asyncIterator]() {
        const iterator = events[Symbol.iterator]()
        return {
          next: () => Promise.resolve(iterator.next()),
        }
      },
    }
  }

  abort(): Promise<void> {
    return Promise.resolve()
  }

  release(): Promise<void> {
    this.provider.released.push('dispose')
    return Promise.resolve()
  }
}
