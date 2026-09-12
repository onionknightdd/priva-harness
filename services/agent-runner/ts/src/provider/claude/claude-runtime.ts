import { InteractionCoordinator } from '../../core/run/interaction-coordinator.js'
import { answersByQuestion, normalizeQuestions, type InteractionResponse } from '../../core/resource/interaction.js'
import { taskNotification } from '../../core/resource/background-task.js'
import { asRecord, stringField } from '../../core/event/json-record.js'
import { ClaudeTaskDeliveryReader } from './session/claude-task-delivery-reader.js'
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { query, type CanUseTool, type Options, type Query, type Settings } from '@anthropic-ai/claude-agent-sdk'

import type {
  AgentRuntime,
  ProviderRunSpec,
  SessionRef,
  SessionTarget,
  TurnContext,
} from '../../core/contract/agent-provider.js'
import { isRunResultEvent } from '../../core/event/agent-event.js'
import type { AgentEvent } from '../../core/event/agent-event.js'
import { emptyContextUsage, mapClaudeContextUsage } from '../../core/resource/context-usage.js'
import type { ContextUsage } from '../../core/resource/context-usage.js'
import {
  mergeProviderProcessEnv,
  profileEnvKeys,
  resolveProviderRunEnv,
} from '../../core/resource/provider-run-env.js'
import { userTurnText, type UserTurn } from '../../core/run/user-turn.js'
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

export type ClaudeQuery = Pick<Query, 'interrupt' | 'close' | 'setModel' | 'getContextUsage'> & Partial<Pick<Query, 'stopTask'>>
  & AsyncIterable<SDKMessage>

export type ClaudeQueryStart = (args: {
  prompt: AsyncIterable<SDKUserMessage>
  options: Options
}) => ClaudeQuery

export class ClaudeRuntime implements AgentRuntime {
  private readonly interactions = new InteractionCoordinator((event) => this.dispatch([event]))
  private query: ClaudeQuery | undefined
  private input: PushableStream<SDKUserMessage> | undefined
  private events: AsyncQueue<AgentEvent> | undefined
  private readonly mapper = new ClaudeEventMapper()
  private readonly deliveries: ClaudeTaskDeliveryReader
  private lastMainMessageId: string | undefined
  private readonly idleBacklog: AgentEvent[] = []
  private turnEnded = false
  private sessionStateAvailable = false
  private heldResult: AgentEvent | undefined
  private readonly pendingNotices = new Set<string>()
  private readonly consumedNotices = new Set<string>()
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
    this.deliveries = new ClaudeTaskDeliveryReader(globalConfigDir, spec.cwd)
  }

  get session(): SessionRef {
    return { provider: 'claude', id: this.sessionId }
  }

  listenIdle(listener: ((events: readonly AgentEvent[]) => void) | undefined): void {
    this.idleListener = listener
    if (listener && !this.inTurn) this.flushIdle()
  }

  async *run(turn: UserTurn, context: TurnContext): AsyncIterable<AgentEvent> {
    this.inTurn = true
    this.turnEnded = false
    this.events = new AsyncQueue<AgentEvent>()
    await this.deliveries.start(this.sessionId)
    this.ensureQuery(turn)
    this.mapper.beginUserTurn()
    this.input?.push(claudeUserMessage(userTurnText(turn)))

    const onAbort = (): void => {
      this.interactions.cancelAll()
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
      context.signal.removeEventListener('abort', onAbort)
    }
  }

  async applyRunSpec(spec: ProviderRunSpec): Promise<void> {
    if (this.query !== undefined && this.spec.model !== spec.model) {
      await this.query.setModel(spec.model)
    }
    this.spec = spec
  }

  get hasBackgroundTasks(): boolean { return this.mapper.backgroundTasks.state.hasActive || this.idleBacklog.length > 0 || this.heldResult !== undefined || this.pendingNotices.size > 0 }

  async stopTask(taskId: string): Promise<void> {
    if (!this.query?.stopTask) throw new Error('Task runtime is unavailable')
    await this.query.stopTask(taskId)
  }

  respondPermission(response: InteractionResponse): void { this.interactions.respond(response) }

  async abort(): Promise<void> {
    this.interactions.cancelAll()
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
    this.inTurn = false
    if (retention === 'warm') { this.flushIdle(); return Promise.resolve() }
    this.interactions.cancelAll()
    this.idleListener = undefined
    this.idleBacklog.length = 0
    this.pendingNotices.clear()
    this.consumedNotices.clear()
    this.input?.close()
    this.query?.close()
    this.abortController?.abort()
    this.query = undefined
    this.input = undefined
    this.abortController = undefined
    return Promise.resolve()
  }

  private ensureQuery(turn: UserTurn): void {
    if (this.query !== undefined) return
    const input = new PushableStream<SDKUserMessage>()
    const abortController = new AbortController()
    this.input = input
    this.abortController = abortController
    const title = this.target.kind === 'new' && turn.text.trim() === '' && turn.attachments?.length
      ? turn.attachments.map((file) => file.name).join(', ')
      : undefined
    const active = this.startQuery({
      prompt: input,
      options: {
        ...resolveClaudeQueryOptions(
          this.spec,
          this.globalConfigDir,
          this.target,
          abortController,
          this.tools,
          {
            emitProgress: (chunk) => this.emitToolProgress(chunk),
          },
        ),
        canUseTool: this.canUseTool,
        // Claude's session index skips XML-only first prompts, including our
        // attachment manifest. A native title keeps these sessions discoverable.
        ...(title === undefined ? {} : { title }),
      },
    })
    this.query = active
    this.mapper.resetUsageBaseline()
    void this.pump(active)
  }

  private readonly canUseTool: CanUseTool = async (tool, input, context) => {
    try {
      const common = { tool, input, toolUseId: context.toolUseID,
        ...(context.title ? { title: context.title } : {}),
        ...(context.decisionReason ? { reason: context.decisionReason } : {}) }
      // Every callback is an explicit SDK ask, including ask rules in bypass mode.
      const result = await this.interactions.request(tool === 'AskUserQuestion'
        ? { ...common, kind: 'question', questions: normalizeQuestions(input['questions']) }
        : { ...common, kind: 'tool' }, { signal: context.signal })
      if (result.decision === 'deny') return { behavior: 'deny', message: `User interaction ${result.reason}` }
      return tool === 'AskUserQuestion'
        ? { behavior: 'allow', updatedInput: { ...input, answers: answersByQuestion(result) } }
        : { behavior: 'allow' }
    } catch (error) {
      return { behavior: 'deny', message: `Invalid interaction request: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  private async pump(active: ClaudeQuery): Promise<void> {
    let failed = false
    try {
      for await (const message of active) {
        const sessionId = sessionIdOf(message)
        if (sessionId !== undefined) {
          this.sessionId = sessionId
          await this.deliveries.start(sessionId)
        }
        if (message.type === 'system' && message.subtype === 'task_notification' && !message.ambient && !message.skip_transcript) this.pendingNotices.add(message.task_id)
        if (message.type === 'user' && 'origin' in message) {
          const content = message.message.content
          const text = typeof content === 'string' ? content : content.flatMap((block) => block.type === 'text' ? [block.text] : []).join('')
          const notice = taskNotification(message.origin, text)
          if (notice?.['task_id']) this.consumedNotices.add(notice['task_id'])
        }
        const mainId = mainAssistantId(message)
        const deliveries: AgentEvent[] = []
        if (mainId && mainId !== this.lastMainMessageId) {
          this.lastMainMessageId = mainId
          if (this.pendingNotices.size) for (const notice of await this.deliveries.forAssistant(mainId)) {
            for (const event of this.mapper.push(notice)) {
              if (event.type === 'task.delivered') this.consumedNotices.add(event.task.taskId)
              deliveries.push(event)
            }
          }
        }
        let mapped = [...deliveries, ...this.mapper.push(message)]
        if (mapped.some(isRunResultEvent)) {
          for (const id of this.consumedNotices) this.pendingNotices.delete(id)
          this.consumedNotices.clear()
        }
        const state = mapped.find((event) => event.type === 'session.state')
        if (state) this.sessionStateAvailable = true
        if (this.sessionStateAvailable) {
          mapped = mapped.filter((event) => {
            if (!isRunResultEvent(event)) return true
            this.heldResult = event
            return false
          })
          if (state?.type === 'session.state' && state.state === 'idle' && this.heldResult) {
            mapped = [...mapped, this.heldResult]
            this.heldResult = undefined
          }
        }
        this.dispatch(mapped)
      }
    } catch (error) {
      failed = true
      const failure: AgentEvent = {
        type: 'run.failed',
        message: error instanceof Error ? error.message : String(error),
        ...(this.sessionId === '' ? {} : { sessionId: this.sessionId }),
        model: this.spec.model,
      }
      this.dispatch([failure])
    } finally {
      this.interactions.cancelAll()
      if (!failed && this.query === active) this.dispatch([{ type: 'run.failed', message: 'Claude session process ended unexpectedly', model: this.spec.model }])
      this.events?.close()
    }
  }

  private emitToolProgress(chunk: string): void {
    const mapper = this.mapper
    const events = this.events
    const toolId = mapper.latestToolId()
    if (events === undefined || toolId === undefined) return
    events.push({
      type: 'tool.progress',
      id: toolId,
      channel: 'log',
      chunk,
    })
  }

  private dispatch(mapped: readonly AgentEvent[]): void {
    if (this.inTurn && !this.turnEnded && this.events) {
      for (const event of mapped) this.events.push(event)
      if (mapped.some(isRunResultEvent)) { this.turnEnded = true; this.events.close() }
      return
    }
    this.idleBacklog.push(...mapped)
    if (!this.inTurn) this.flushIdle()
  }

  private flushIdle(): void {
    if (!this.idleListener || this.idleBacklog.length === 0) return
    const batch = this.idleBacklog.splice(0)
    this.idleListener(batch)
  }

}

export interface ClaudeToolEmitters {
  readonly emitProgress?: (chunk: string) => void
}

function mainAssistantId(message: SDKMessage): string | undefined {
  if ('parent_tool_use_id' in message && message.parent_tool_use_id) return undefined
  if (message.type === 'assistant') return stringField(asRecord(message.message) ?? {}, 'id')
  if (message.type !== 'stream_event') return undefined
  const event = asRecord(message.event)
  return event?.['type'] === 'message_start' ? stringField(asRecord(event['message']) ?? {}, 'id') : undefined
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
    perTaskStopAffordance: true,
    permissionMode: 'bypassPermissions',
    promptSuggestions: spec.promptSuggestions !== false,
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    settingSources: ['user', 'project', 'local'],
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
