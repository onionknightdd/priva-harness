import type {
  AgentProvider,
  AgentRuntime,
  ProviderId,
  ProviderRunSpec,
  TurnContext,
} from '../core/contract/agent-provider.js'
import type { AgentEvent } from '../core/event/agent-event.js'
import { isRunTerminalEvent } from '../core/event/agent-event.js'
import type { UserTurn } from '../core/run/user-turn.js'

export interface AgentHarnessOptions {
  readonly providers: Readonly<Record<ProviderId, AgentProvider>>
  readonly cwd: string
}

export class AgentHarness {
  constructor(private readonly options: AgentHarnessOptions) {}

  async *run(
    turn: UserTurn,
    context: TurnContext,
    spec: ProviderRunSpec,
  ): AsyncIterable<AgentEvent> {
    yield { type: 'run', event: 'started' }

    const provider = this.options.providers[spec.provider]
    const runtime = await provider.openSession(
      { kind: 'new', provider: spec.provider },
      spec,
    )

    try {
      yield* this.forward(runtime, turn, context, spec.provider)
    } finally {
      await runtime.release('dispose')
    }
  }

  private async *forward(
    runtime: AgentRuntime,
    turn: UserTurn,
    context: TurnContext,
    providerId: ProviderId,
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
          harnessProvider: providerId,
        }
      }
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
