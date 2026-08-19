import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { query, type Options, type Query } from '@anthropic-ai/claude-agent-sdk'

import type {
  AgentRuntime,
  ProviderRunSpec,
  SessionRef,
  TurnContext,
} from '../../core/contract/agent-provider.js'
import type { AgentEvent } from '../../core/event/agent-event.js'
import type { UserTurn } from '../../core/run/user-turn.js'
import { ClaudeEventMapper } from './claude-event-mapper.js'
import { singleShotUserMessage } from './single-shot-prompt.js'

export class ClaudeRuntime implements AgentRuntime {
  private query: Query | undefined
  private sessionId = ''

  constructor(private readonly spec: ProviderRunSpec) {}

  get session(): SessionRef {
    return { provider: 'claude', id: this.sessionId }
  }

  async *run(turn: UserTurn, context: TurnContext): AsyncIterable<AgentEvent> {
    const mapper = new ClaudeEventMapper()
    const active = query({
      prompt: singleShotUserMessage(turn.text),
      options: claudeOptions(this.spec),
    })
    this.query = active

    const onAbort = (): void => {
      void active.interrupt()
    }
    if (context.signal.aborted) onAbort()
    else context.signal.addEventListener('abort', onAbort, { once: true })

    try {
      for await (const message of active) {
        const sessionId = sessionIdOf(message)
        if (sessionId !== undefined) this.sessionId = sessionId
        yield* mapper.push(message)
      }
    } finally {
      context.signal.removeEventListener('abort', onAbort)
      this.query = undefined
    }
  }

  async abort(): Promise<void> {
    await this.query?.interrupt()
  }

  release(): Promise<void> {
    this.query?.close()
    this.query = undefined
    return Promise.resolve()
  }
}

function claudeOptions(spec: ProviderRunSpec): Options {
  const model = process.env['ANTHROPIC_MODEL']
  return {
    cwd: spec.cwd,
    includePartialMessages: true,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    ...(model === undefined || model === '' ? {} : { model }),
  }
}

function sessionIdOf(message: SDKMessage): string | undefined {
  if (!('session_id' in message)) return undefined
  const sessionId = message.session_id
  return typeof sessionId === 'string' && sessionId !== '' ? sessionId : undefined
}
