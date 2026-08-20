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

  constructor(
    private readonly spec: ProviderRunSpec,
    private readonly globalConfigDir: string,
  ) {}

  get session(): SessionRef {
    return { provider: 'claude', id: this.sessionId }
  }

  async *run(turn: UserTurn, context: TurnContext): AsyncIterable<AgentEvent> {
    const mapper = new ClaudeEventMapper()
    const active = query({
      prompt: singleShotUserMessage(turn.text),
      options: resolveClaudeQueryOptions(this.spec, this.globalConfigDir),
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

export function resolveClaudeQueryOptions(
  spec: ProviderRunSpec,
  globalConfigDir: string,
): Options {
  return {
    cwd: spec.cwd,
    model: spec.model,
    includePartialMessages: true,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    env: resolveClaudeProcessEnv(spec, globalConfigDir),
  }
}

function resolveClaudeProcessEnv(
  spec: ProviderRunSpec,
  globalConfigDir: string,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || OMITTED_INHERITED_ENV.has(key)) continue
    env[key] = value
  }
  env['CLAUDE_CONFIG_DIR'] = globalConfigDir
  env['ANTHROPIC_BASE_URL'] = spec.baseUrl
  env['ANTHROPIC_API_KEY'] = spec.authToken
  env['ANTHROPIC_AUTH_TOKEN'] = spec.authToken
  return env
}

const OMITTED_INHERITED_ENV = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'CLAUDE_CONFIG_DIR',
])

function sessionIdOf(message: SDKMessage): string | undefined {
  if (!('session_id' in message)) return undefined
  const sessionId = message.session_id
  return typeof sessionId === 'string' && sessionId !== '' ? sessionId : undefined
}
