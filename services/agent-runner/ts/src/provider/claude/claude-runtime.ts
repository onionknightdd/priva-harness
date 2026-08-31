import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { query, type Options, type Query, type Settings } from '@anthropic-ai/claude-agent-sdk'

import type {
  AgentRuntime,
  ProviderRunSpec,
  SessionRef,
  SessionTarget,
  TurnContext,
} from '../../core/contract/agent-provider.js'
import type { AgentEvent } from '../../core/event/agent-event.js'
import { emptyContextUsage, mapClaudeContextUsage } from '../../core/resource/context-usage.js'
import type { ContextUsage } from '../../core/resource/context-usage.js'
import {
  mergeProviderProcessEnv,
  profileEnvKeys,
  resolveProviderRunEnv,
} from '../../core/resource/provider-run-env.js'
import type { UserTurn } from '../../core/run/user-turn.js'
import { AsyncQueue } from '../../core/stream/async-queue.js'
import { PushableStream } from '../../core/stream/pushable-stream.js'
import type { ToolDefinition } from '../../core/tool/define-tool.js'
import { imageToolsFromSpec } from '../../core/tool/image-tool-shared.js'
import { ClaudeEventMapper } from './claude-event-mapper.js'
import { claudeUserMessage } from './claude-user-message.js'
import { compileClaudeCustomTools } from './tools/compile-custom-tools.js'

export const CLAUDE_DISALLOWED_TOOLS = [
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
  'ScheduleWakeup',
  'RemoteTrigger',
  'PushNotification',
  'Artifact',
  'Projects',
  'DesignSync',
  'ReadMcpResourceDirTool',
  'RefreshMcpTools',
  'ShowOnboardingRolePicker',
] as const

export const CLAUDE_DISABLED_SKILLS = [
  'dataviz',
  'update-config',
  'fewer-permission-prompts',
  'claude-api',
  'run',
  'run-skill-generator',
] as const

export type ClaudeQuery = Pick<Query, 'interrupt' | 'close' | 'setModel' | 'getContextUsage'>
  & AsyncIterable<SDKMessage>

export type ClaudeQueryStart = (args: {
  prompt: AsyncIterable<SDKUserMessage>
  options: Options
}) => ClaudeQuery

export class ClaudeRuntime implements AgentRuntime {
  private query: ClaudeQuery | undefined
  private input: PushableStream<SDKUserMessage> | undefined
  private events: AsyncQueue<AgentEvent> | undefined
  private mapper: ClaudeEventMapper | undefined
  private idleMapper: ClaudeEventMapper | undefined
  private abortController: AbortController | undefined
  private sessionId = ''
  private inTurn = false
  private idleListener: ((events: readonly AgentEvent[]) => void) | undefined
  private readonly startQuery: ClaudeQueryStart

  constructor(
    private spec: ProviderRunSpec,
    private readonly target: SessionTarget,
    private readonly globalConfigDir: string,
    startQuery?: ClaudeQueryStart,
    private readonly tools: readonly ToolDefinition[] = [],
  ) {
    this.startQuery = startQuery ?? ((args) => query(args))
    this.sessionId = initialSessionId(target)
  }

  get session(): SessionRef {
    return { provider: 'claude', id: this.sessionId }
  }

  listenIdle(listener: ((events: readonly AgentEvent[]) => void) | undefined): void {
    this.idleListener = listener
    if (listener === undefined) this.idleMapper = undefined
  }

  async *run(turn: UserTurn, context: TurnContext): AsyncIterable<AgentEvent> {
    this.inTurn = true
    this.idleMapper = undefined
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
      this.inTurn = false
      this.events.close()
      this.events = undefined
      this.mapper = undefined
      context.signal.removeEventListener('abort', onAbort)
    }
  }

  async applyRunSpec(spec: ProviderRunSpec): Promise<void> {
    if (this.query !== undefined && this.spec.model !== spec.model) {
      await this.query.setModel(spec.model)
    }
    this.spec = spec
  }

  async abort(): Promise<void> {
    await this.query?.interrupt()
  }

  async getContextUsage(): Promise<ContextUsage> {
    if (this.query === undefined) return emptyContextUsage()
    try {
      return mapClaudeContextUsage(await this.query.getContextUsage())
    } catch {
      return emptyContextUsage()
    }
  }

  release(retention: 'warm' | 'dispose'): Promise<void> {
    this.events?.close()
    this.events = undefined
    this.mapper = undefined
    this.inTurn = false
    if (retention === 'warm') return Promise.resolve()
    this.idleListener = undefined
    this.idleMapper = undefined
    this.input?.close()
    this.query?.close()
    this.abortController?.abort()
    this.query = undefined
    this.input = undefined
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
        this.tools,
        {
          emitProgress: (chunk) => this.emitToolProgress(chunk),
        },
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
        const mapped = this.mapMessage(message)
        if (this.inTurn) {
          const events = this.events
          if (events === undefined) continue
          for (const event of mapped) events.push(event)
          continue
        }
        if (this.idleListener !== undefined && mapped.length > 0) {
          this.idleListener(mapped)
        }
      }
    } catch (error) {
      const failed: AgentEvent = {
        type: 'run.failed',
        message: error instanceof Error ? error.message : String(error),
        ...(this.sessionId === '' ? {} : { sessionId: this.sessionId }),
        model: this.spec.model,
      }
      if (this.inTurn) this.events?.push(failed)
      else if (this.idleListener !== undefined) this.idleListener([failed])
    } finally {
      this.events?.close()
    }
  }

  private emitToolProgress(chunk: string): void {
    const mapper = this.mapper
    const events = this.events
    const toolId = mapper?.latestToolId()
    if (mapper === undefined || events === undefined || toolId === undefined) return
    events.push({
      type: 'tool.progress',
      id: toolId,
      channel: 'log',
      chunk,
    })
  }

  private mapMessage(message: SDKMessage): readonly AgentEvent[] {
    if (this.inTurn) {
      const mapper = this.mapper
      if (mapper === undefined) return []
      return mapper.push(message)
    }
    this.idleMapper ??= new ClaudeEventMapper()
    return this.idleMapper.push(message)
  }
}

export interface ClaudeToolEmitters {
  readonly emitProgress?: (chunk: string) => void
}

export function resolveClaudeQueryOptions(
  spec: ProviderRunSpec,
  globalConfigDir: string,
  target: SessionTarget = { kind: 'new', provider: 'claude' },
  abortController?: AbortController,
  tools: readonly ToolDefinition[] = [],
  emitters: ClaudeToolEmitters = {},
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
    settings: resolveClaudeQuerySettings(spec),
    env: resolveClaudeQueryEnv(spec, globalConfigDir),
    ...(abortController === undefined ? {} : { abortController }),
  }

  // Keep title unset so Claude still auto-names the session from the first prompt.
  if (target.kind === 'new' && target.sessionId !== undefined) {
    options.sessionId = target.sessionId
  }
  if (target.kind === 'fork' && target.sessionId !== undefined) {
    options.sessionId = target.sessionId
  }

  const compiled = compileClaudeCustomTools(tools, {
    cwd: spec.cwd,
    session: { provider: 'claude', id: initialSessionId(target) },
    signal: abortController?.signal ?? new AbortController().signal,
    profile: imageToolsFromSpec(spec),
    ...(emitters.emitProgress === undefined ? {} : { emitProgress: emitters.emitProgress }),
  })
  if (compiled.mcpServers !== undefined) {
    options.mcpServers = compiled.mcpServers
  }
  if (compiled.toolAliases !== undefined) {
    options.toolAliases = compiled.toolAliases
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

export function resolveClaudeQuerySettings(
  spec: Pick<ProviderRunSpec, 'provider' | 'model' | 'baseUrl' | 'authToken'>,
): Settings {
  return {
    crossSessionInbound: 'accept',
    skillOverrides: Object.fromEntries(
      CLAUDE_DISABLED_SKILLS.map((name) => [name, 'off' as const]),
    ),
    // Flag-tier env beats project/user settings.json env. See Claude Code settings precedence.
    env: resolveProviderRunEnv(spec),
  }
}

export function resolveClaudeQueryEnv(
  spec: ProviderRunSpec,
  globalConfigDir: string,
): Record<string, string> {
  return mergeProviderProcessEnv(
    resolveProviderRunEnv(spec),
    new Set([...profileEnvKeys('claude'), 'CLAUDE_CONFIG_DIR']),
    {
      CLAUDE_CONFIG_DIR: globalConfigDir,
      CLAUDE_CODE_HARBOR_KITE: '1',
    },
  )
}

function initialSessionId(target: SessionTarget): string {
  if (target.kind === 'resume') return target.session.id
  if (target.kind === 'fork') return target.sessionId ?? target.source.id
  return target.sessionId ?? ''
}

function sessionIdOf(message: SDKMessage): string | undefined {
  if (!('session_id' in message)) return undefined
  const sessionId = message.session_id
  return typeof sessionId === 'string' && sessionId !== '' ? sessionId : undefined
}
