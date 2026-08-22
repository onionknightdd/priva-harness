import type {
  AgentRuntime,
  SessionRef,
  TurnContext,
} from '../../core/contract/agent-provider.js'
import type { AgentEvent } from '../../core/event/agent-event.js'
import { isRunTerminalEvent } from '../../core/event/agent-event.js'
import type { UserTurn } from '../../core/run/user-turn.js'
import { PiEventMapper, type PiSessionEvent } from './pi-event-mapper.js'

export interface PiAgentSession {
  readonly sessionId: string
  readonly modelId: string
  subscribe(listener: (event: PiSessionEvent) => void): () => void
  prompt(text: string): Promise<void>
  abort(): Promise<void>
  dispose(): void
}

export class PiRuntime implements AgentRuntime {
  private sessionHandle: PiAgentSession | undefined

  constructor(private readonly agentSession: PiAgentSession) {
    this.sessionHandle = agentSession
  }

  get session(): SessionRef {
    return { provider: 'bambuddy', id: this.agentSession.sessionId }
  }

  async *run(turn: UserTurn, context: TurnContext): AsyncIterable<AgentEvent> {
    const mapper = new PiEventMapper({
      sessionId: this.agentSession.sessionId,
      model: this.agentSession.modelId,
    })
    const queue = new AsyncQueue<AgentEvent>()
    let finished = false
    const unsubscribe = this.agentSession.subscribe((event) => {
      for (const mapped of mapper.push(event)) {
        if (isRunTerminalEvent(mapped)) finished = true
        queue.push(mapped)
      }
    })

    const onAbort = (): void => {
      void this.agentSession.abort()
    }
    if (context.signal.aborted) onAbort()
    else context.signal.addEventListener('abort', onAbort, { once: true })

    const prompt = this.agentSession.prompt(turn.text).then(
      () => {
        queue.close()
      },
      (error: unknown) => {
        if (!finished) {
          queue.push({
            type: 'run',
            event: 'failed',
            message: error instanceof Error ? error.message : String(error),
            sessionId: this.agentSession.sessionId,
            harnessProvider: 'bambuddy',
            model: this.agentSession.modelId,
          })
        }
        queue.close()
      },
    )

    try {
      for await (const event of queue.iterate()) {
        if (isRunTerminalEvent(event)) finished = true
        yield event
      }
      await prompt
    } finally {
      context.signal.removeEventListener('abort', onAbort)
      unsubscribe()
    }
  }

  async abort(): Promise<void> {
    await this.sessionHandle?.abort()
  }

  release(): Promise<void> {
    this.sessionHandle?.dispose()
    this.sessionHandle = undefined
    return Promise.resolve()
  }
}

class AsyncQueue<T> {
  private readonly items: T[] = []
  private readonly waiters: ((item: T | undefined) => void)[] = []
  private closed = false

  push(item: T): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter !== undefined) {
      waiter(item)
      return
    }
    this.items.push(item)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const waiter of this.waiters) waiter(undefined)
    this.waiters.length = 0
  }

  async *iterate(): AsyncIterable<T> {
    while (!this.closed || this.items.length > 0) {
      const buffered = this.items.shift()
      if (buffered !== undefined) {
        yield buffered
        continue
      }
      if (this.closed) break
      const next = await new Promise<T | undefined>((resolve) => {
        this.waiters.push(resolve)
      })
      if (next === undefined) break
      yield next
    }
  }
}
