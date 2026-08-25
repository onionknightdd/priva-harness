import { randomUUID } from 'node:crypto'

import type {
  AgentProvider,
  AgentRuntime,
  ProviderId,
  ProviderRunSpec,
  SessionTarget,
  TurnContext,
} from '../core/contract/agent-provider.js'
import type { StreamFrame } from '../core/event/agent-event.js'
import { isRunResultEvent } from '../core/event/agent-event.js'
import type { UserTurn } from '../core/run/user-turn.js'
import { consumeRunEvents } from './run/consume-run-events.js'
import { EnvelopeStamper } from './run/envelope-stamper.js'
import type { LiveRunRegistry } from './run/live-run-registry.js'
import type { SessionService } from './session/session-service.js'

export interface AgentHarnessOptions {
  readonly providers: Readonly<Record<ProviderId, AgentProvider>>
  readonly cwd: string
  readonly liveRuns?: LiveRunRegistry
  readonly sessions?: SessionService
}

export interface AgentRunOptions {
  readonly runId?: string
  readonly session?: SessionTarget
}

export class AgentHarness {
  constructor(private readonly options: AgentHarnessOptions) {}

  async *run(
    turn: UserTurn,
    context: TurnContext,
    spec: ProviderRunSpec,
    runOptions?: AgentRunOptions,
  ): AsyncIterable<StreamFrame> {
    const runId = runOptions?.runId ?? randomUUID()
    const stamper = new EnvelopeStamper(runId, spec.provider)
    this.options.liveRuns?.start({
      runId,
      provider: spec.provider,
      cwd: spec.cwd,
      runMode: 'agent',
    })
    yield stamper.stamp({ type: 'run.started', model: spec.model })

    const provider = this.options.providers[spec.provider]
    const runtime = await provider.openSession(
      runOptions?.session ?? { kind: 'new', provider: spec.provider },
      spec,
    )

    try {
      yield* this.forward(runtime, turn, context, spec, runId, stamper)
    } finally {
      this.options.liveRuns?.finish(runId)
      await runtime.release('dispose')
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
        this.options.liveRuns?.attachSession(runId, runtime.session.id)
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
