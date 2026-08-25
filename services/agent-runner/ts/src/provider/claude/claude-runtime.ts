import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { query, type Options, type Query } from '@anthropic-ai/claude-agent-sdk'

import type {
  AgentRuntime,
  ProviderRunSpec,
  SessionRef,
  SessionTarget,
  TurnContext,
} from '../../core/contract/agent-provider.js'
import type { AgentEvent } from '../../core/event/agent-event.js'
import type { UserTurn } from '../../core/run/user-turn.js'
import { AsyncQueue } from '../../core/stream/async-queue.js'
import { PushableStream } from '../../core/stream/pushable-stream.js'
import { ClaudeEventMapper } from './claude-event-mapper.js'
import { claudeUserMessage } from './claude-user-message.js'

export const CLAUDE_DISALLOWED_TOOLS = [
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
  'CronCreate',
  'CronDelete',
  'CronList',
  'ScheduleWakeup',
  'RemoteTrigger',
  'PushNotification',
  'Artifact',
  'Projects',
  'ReadMcpResourceDirTool',
  'RefreshMcpTools',
  'ShowOnboardingRolePicker',
] as const

export type ClaudeQuery = Pick<Query, 'interrupt' | 'close'> & AsyncIterable<SDKMessage>

export type ClaudeQueryStart = (args: {
  prompt: AsyncIterable<SDKUserMessage>
  options: Options
}) => ClaudeQuery

export class ClaudeRuntime implements AgentRuntime {
  private query: ClaudeQuery | undefined
  private input: PushableStream<SDKUserMessage> | undefined
  private events: AsyncQueue<AgentEvent> | undefined
  private mapper: ClaudeEventMapper | undefined
  private abortController: AbortController | undefined
  private sessionId = ''
  private readonly startQuery: ClaudeQueryStart

  constructor(
    private readonly spec: ProviderRunSpec,
    private readonly target: SessionTarget,
    private readonly globalConfigDir: string,
    startQuery?: ClaudeQueryStart,
  ) {
    this.startQuery = startQuery ?? ((args) => query(args))
    this.sessionId = initialSessionId(target)
  }

  get session(): SessionRef {
    return { provider: 'claude', id: this.sessionId }
  }

  async *run(turn: UserTurn, context: TurnContext): AsyncIterable<AgentEvent> {
    this.mapper = new ClaudeEventMapper()
    this.events = new AsyncQueue<AgentEvent>()
    this.ensureQuery()
    this.input?.push(claudeUserMessage(turn.text))

    const onAbort = (): void => {
      void this.query?.interrupt()
    }
    if (context.signal.aborted) onAbort()
    else context.signal.addEventListener('abort', onAbort, { once: true })

    try {
      yield* this.events.iterate()
    } finally {
      context.signal.removeEventListener('abort', onAbort)
    }
  }

  async abort(): Promise<void> {
    await this.query?.interrupt()
  }

  release(retention: 'warm' | 'dispose'): Promise<void> {
    void retention
    this.input?.close()
    this.query?.close()
    this.abortController?.abort()
    this.query = undefined
    this.input = undefined
    this.events?.close()
    this.events = undefined
    this.mapper = undefined
    this.abortController = undefined
    return Promise.resolve()
  }

  private ensureQuery(): void {
    if (this.query !== undefined) return
    const input = new PushableStream<SDKUserMessage>()
    const abortController = new AbortController()
    this.input = input
    this.abortController = abortController
    const active = this.startQuery({
      prompt: input,
      options: resolveClaudeQueryOptions(
        this.spec,
        this.globalConfigDir,
        this.target,
        abortController,
      ),
    })
    this.query = active
    void this.pump(active)
  }

  private async pump(active: ClaudeQuery): Promise<void> {
    try {
      for await (const message of active) {
        const sessionId = sessionIdOf(message)
        if (sessionId !== undefined) this.sessionId = sessionId
        const mapper = this.mapper
        const events = this.events
        if (mapper === undefined || events === undefined) continue
        for (const event of mapper.push(message)) events.push(event)
      }
    } catch (error) {
      this.events?.push({
        type: 'run.failed',
        message: error instanceof Error ? error.message : String(error),
        ...(this.sessionId === '' ? {} : { sessionId: this.sessionId }),
        model: this.spec.model,
      })
    } finally {
      this.events?.close()
    }
  }
}

export function resolveClaudeQueryOptions(
  spec: ProviderRunSpec,
  globalConfigDir: string,
  target: SessionTarget = { kind: 'new', provider: 'claude' },
  abortController?: AbortController,
): Options {
  const options: Options = {
    cwd: spec.cwd,
    model: spec.model,
    agentProgressSummaries: true,
    allowDangerouslySkipPermissions: true,
    disallowedTools: [...CLAUDE_DISALLOWED_TOOLS],
    enableFileCheckpointing: true,
    forwardSubagentText: true,
    includePartialMessages: true,
    permissionMode: 'bypassPermissions',
    promptSuggestions: spec.promptSuggestions !== false,
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    env: resolveClaudeProcessEnv(spec, globalConfigDir),
    ...(abortController === undefined ? {} : { abortController }),
  }

  if (spec.effort !== undefined) {
    options.effort = spec.effort
  }

  if (target.kind === 'resume') {
    options.resume = target.session.id
  }
  if (target.kind === 'fork') {
    options.resume = target.source.id
    options.forkSession = true
  }

  return options
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
  assignEnv(env, 'CLAUDE_CONFIG_DIR', globalConfigDir)
  assignEnv(env, 'ANTHROPIC_BASE_URL', spec.baseUrl)
  assignEnv(env, 'ANTHROPIC_API_KEY', spec.authToken)
  assignEnv(env, 'ANTHROPIC_AUTH_TOKEN', spec.authToken)
  return env
}

function assignEnv(
  env: Record<string, string>,
  key: string,
  value: string,
): void {
  const trimmed = value.trim()
  if (trimmed === '') return
  env[key] = trimmed
}

const OMITTED_INHERITED_ENV = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'CLAUDE_CONFIG_DIR',
])

function initialSessionId(target: SessionTarget): string {
  if (target.kind === 'resume') return target.session.id
  if (target.kind === 'fork') return target.source.id
  return ''
}

function sessionIdOf(message: SDKMessage): string | undefined {
  if (!('session_id' in message)) return undefined
  const sessionId = message.session_id
  return typeof sessionId === 'string' && sessionId !== '' ? sessionId : undefined
}
