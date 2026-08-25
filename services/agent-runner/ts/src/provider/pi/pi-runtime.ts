import type {
  AgentRuntime,
  QueueBehavior,
  SessionRef,
  TurnContext,
} from '../../core/contract/agent-provider.js'
import type { AgentEvent } from '../../core/event/agent-event.js'
import { isRunResultEvent } from '../../core/event/agent-event.js'
import type { UserTurn } from '../../core/run/user-turn.js'
import { AsyncQueue } from '../../core/stream/async-queue.js'
import { PiEventMapper, type PiSessionEvent } from './pi-event-mapper.js'

export interface PiAgentSession {
  readonly sessionId: string
  readonly modelId: string
  readonly isStreaming: boolean
  subscribe(listener: (event: PiSessionEvent) => void): () => void
  prompt(text: string): Promise<void>
  followUp(text: string): Promise<void>
  steer(text: string): Promise<void>
  abort(): Promise<void>
  dispose(): void
}

export class PiRuntime implements AgentRuntime {
  private sessionHandle: PiAgentSession | undefined
  private readonly unsubscribe: () => void
  private mapper: PiEventMapper | undefined
  private events: AsyncQueue<AgentEvent> | undefined

  constructor(
    private readonly agentSession: PiAgentSession,
    private readonly queueBehavior: QueueBehavior = 'follow-up',
  ) {
    this.sessionHandle = agentSession
    this.unsubscribe = agentSession.subscribe((event) => {
      const mapper = this.mapper
      const events = this.events
      if (mapper === undefined || events === undefined) return
      for (const mapped of mapper.push(event)) events.push(mapped)
    })
  }

  get session(): SessionRef {
    return { provider: 'pi', id: this.agentSession.sessionId }
  }

  async *run(turn: UserTurn, context: TurnContext): AsyncIterable<AgentEvent> {
    this.mapper = new PiEventMapper({
      sessionId: this.agentSession.sessionId,
      model: this.agentSession.modelId,
    })
    this.events = new AsyncQueue<AgentEvent>()
    let finished = false

    const onAbort = (): void => {
      void this.agentSession.abort()
    }
    if (context.signal.aborted) onAbort()
    else context.signal.addEventListener('abort', onAbort, { once: true })

    const sending = this.send(turn.text).then(
      () => undefined,
      (error: unknown) => {
        if (!finished) {
          this.events?.push({
            type: 'run.failed',
            message: error instanceof Error ? error.message : String(error),
            sessionId: this.agentSession.sessionId,
            model: this.agentSession.modelId,
          })
        }
        this.events?.close()
      },
    )

    try {
      for await (const event of this.events.iterate()) {
        if (isRunResultEvent(event)) finished = true
        yield event
      }
      await sending
    } finally {
      context.signal.removeEventListener('abort', onAbort)
      this.events.close()
      this.events = undefined
    }
  }

  async abort(): Promise<void> {
    await this.sessionHandle?.abort()
  }

  release(retention: 'warm' | 'dispose'): Promise<void> {
    void retention
    this.unsubscribe()
    this.sessionHandle?.dispose()
    this.sessionHandle = undefined
    this.events?.close()
    this.events = undefined
    this.mapper = undefined
    return Promise.resolve()
  }

  private send(text: string): Promise<void> {
    if (!this.agentSession.isStreaming) return this.agentSession.prompt(text)
    if (this.queueBehavior === 'steer') return this.agentSession.steer(text)
    if (this.queueBehavior === 'interrupt') return this.interruptThenPrompt(text)
    return this.agentSession.followUp(text)
  }

  private async interruptThenPrompt(text: string): Promise<void> {
    await this.agentSession.abort()
    await this.agentSession.prompt(text)
  }
}
