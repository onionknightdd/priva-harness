import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
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
import { ClaudeEventMapper } from './claude-event-mapper.js'
import { singleShotUserMessage } from './single-shot-prompt.js'

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

export class ClaudeRuntime implements AgentRuntime {
  private query: Query | undefined
  private sessionId = ''

  constructor(
    private readonly spec: ProviderRunSpec,
    private readonly target: SessionTarget,
    private readonly globalConfigDir: string,
  ) {
    this.sessionId = initialSessionId(target)
  }

  get session(): SessionRef {
    return { provider: 'claude', id: this.sessionId }
  }

  async *run(turn: UserTurn, context: TurnContext): AsyncIterable<AgentEvent> {
    const mapper = new ClaudeEventMapper()
    const abortController = linkedAbortController(context.signal)
    const active = query({
      prompt: singleShotUserMessage(turn.text),
      options: resolveClaudeQueryOptions(
        this.spec,
        this.globalConfigDir,
        this.target,
        abortController,
      ),
    })
    this.query = active

    const onAbort = (): void => {
      abortController.abort()
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
    promptSuggestions: true,
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

function linkedAbortController(signal: AbortSignal): AbortController {
  const controller = new AbortController()
  if (signal.aborted) controller.abort()
  return controller
}

function sessionIdOf(message: SDKMessage): string | undefined {
  if (!('session_id' in message)) return undefined
  const sessionId = message.session_id
  return typeof sessionId === 'string' && sessionId !== '' ? sessionId : undefined
}
