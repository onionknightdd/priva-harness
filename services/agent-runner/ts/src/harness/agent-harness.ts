import type {
  AgentProvider,
  AgentRuntime,
  ProviderRunSpec,
  TurnContext,
} from '../core/contract/agent-provider.js'
import type { AgentEvent } from '../core/event/agent-event.js'
import { isRunTerminalEvent } from '../core/event/agent-event.js'
import type { UserTurn } from '../core/run/user-turn.js'

export interface AgentHarnessOptions {
  readonly provider: AgentProvider
  readonly cwd: string
}

export class AgentHarness {
  constructor(private readonly options: AgentHarnessOptions) {}

  async *run(turn: UserTurn, context: TurnContext): AsyncIterable<AgentEvent> {
    yield { type: 'run', event: 'started' }

    const spec: ProviderRunSpec = { cwd: this.options.cwd }
    const runtime = await this.options.provider.openSession(
      { kind: 'new', provider: this.options.provider.id },
      spec,
    )

    try {
      yield* this.forward(runtime, turn, context)
    } finally {
      await runtime.release('dispose')
    }
  }

  private async *forward(
    runtime: AgentRuntime,
    turn: UserTurn,
    context: TurnContext,
  ): AsyncIterable<AgentEvent> {
    let finished = false
    try {
      for await (const event of runtime.run(turn, context)) {
        yield event
        if (isRunTerminalEvent(event)) finished = true
      }
    } catch (error) {
      if (!finished) {
        yield {
          type: 'run',
          event: 'failed',
          message: errorMessage(error),
          harnessProvider: this.options.provider.id,
        }
      }
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
