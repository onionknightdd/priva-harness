import { resolveBuiltinPlugins } from '../../core/plugin/builtin-plugins.js'
import { enabledPluginMcpServers, type PluginMcpServer } from '../../core/plugin/plugin-mcp.js'
import { claudeSystemPrompt } from './claude-system-prompt.js'
import { DEFAULT_CONTEXT_WINDOW } from '../../core/resource/model-context.js'
import { claudeDisallowedTools, claudePluginMcpServers } from './claude-tool-policy.js'
import { InteractionCoordinator } from '../../core/run/interaction-coordinator.js'
import { answersByQuestion, interactionDenialText, normalizeQuestions, type InteractionResponse } from '../../core/resource/interaction.js'
import { taskNotification } from '../../core/resource/background-task.js'
import { asRecord, stringField } from '../../core/util/json-record.js'
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
import type { UserTurn } from '../../core/run/user-turn.js'
import { AsyncQueue } from '../../core/stream/async-queue.js'
import { PushableStream } from '../../core/stream/pushable-stream.js'
import type { ToolDefinition } from '../../core/tool/define-tool.js'
import { imageToolsFromSpec } from '../../core/tool/image-tool-shared.js'
import { ClaudeEventMapper } from './claude-event-mapper.js'
import { claudeUserMessage } from './claude-user-message.js'
import { compileClaudeCustomTools, type ToolProgressEmitter } from './tools/compile-custom-tools.js'
import { assertClaudeEffort } from './claude-effort.js'
import { errorMessage } from '../../core/util/errors.js'

export const CLAUDE_DISABLED_SKILLS = [
  'dataviz',
  'update-config',
  'fewer-permission-prompts',
  'claude-api',
  'run',
  'run-skill-generator',
] as const

export type ClaudeQuery = Pick<Query, 'interrupt' | 'close' | 'applyFlagSettings' | 'getContextUsage'> & Partial<Pick<Query, 'stopTask'>>
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
  // Set once the CLI has reported the session, which is when it can be resumed.
  private sessionEstablished = false
  private inTurn = false
  private idleListener: ((events: readonly AgentEvent[]) => void) | undefined
  private readonly startQuery: ClaudeQueryStart

  constructor(
    private spec: ProviderRunSpec,
    private readonly target: SessionTarget,
    globalConfigDir: string,
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
    const events = new AsyncQueue<AgentEvent>()
    const onAbort = (): void => {
      this.interactions.cancelAll()
      // The run ends through the interrupted query's result, not this call.
      this.query?.interrupt().catch(() => undefined)
    }
    this.inTurn = true
    this.turnEnded = false
    this.events = events
    try {
      await this.deliveries.start(this.sessionId)
      const message = await claudeUserMessage(turn)
      this.ensureQuery(turn)
      this.mapper.beginUserTurn()
      this.input?.push(message)
      if (context.signal.aborted) onAbort()
      else context.signal.addEventListener('abort', onAbort, { once: true })
      yield* events.iterate()
    } finally {
      this.inTurn = false
      events.close()
      if (this.events === events) this.events = undefined
      context.signal.removeEventListener('abort', onAbort)
    }
  }

  async applyRunSpec(spec: ProviderRunSpec): Promise<void> {
    assertClaudeEffort(spec.effort)
    if (this.query !== undefined && this.spec.model !== spec.model) {
      await this.query.applyFlagSettings({ model: spec.model, env: resolveProviderRunEnv(spec) })
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
    // A query that replaces one whose process died continues the same session.
    const target: SessionTarget = this.sessionEstablished ? { kind: 'resume', session: this.session } : this.target
    const title = target.kind === 'new' && turn.text.trim() === '' && turn.attachments?.length
      ? turn.attachments.map((file) => file.name).join(', ')
      : undefined
    const active = this.startQuery({
      prompt: input,
      options: {
        ...resolveClaudeQueryOptions(
          this.spec,
          target,
          abortController,
          this.tools,
          {
            emitProgress: (toolName, chunk) => this.emitToolProgress(toolName, chunk),
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
      if (result.decision === 'deny') return { behavior: 'deny', message: interactionDenialText(result.reason) }
      return tool === 'AskUserQuestion'
        ? { behavior: 'allow', updatedInput: { ...input, answers: answersByQuestion(result) } }
        : { behavior: 'allow' }
    } catch (error) {
      return { behavior: 'deny', message: `Invalid interaction request: ${errorMessage(error)}` }
    }
  }

  private async pump(active: ClaudeQuery): Promise<void> {
    let failure: AgentEvent | undefined
    try {
      for await (const message of active) {
        const sessionId = sessionIdOf(message)
        if (sessionId !== undefined) {
          this.sessionId = sessionId
          this.sessionEstablished = true
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
          // Monitor events can prompt a reply without a lifecycle notification.
          for (const notice of await this.readDeliveries(mainId)) {
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
      failure = {
        type: 'run.failed',
        message: errorMessage(error),
        ...(this.sessionId === '' ? {} : { sessionId: this.sessionId }),
        model: this.spec.model,
      }
    } finally {
      this.interactions.cancelAll()
      if (this.query === active) {
        // The query ended without being released: its process is gone.
        this.dispatch([
          ...this.discardQuery(),
          failure ?? { type: 'run.failed', message: 'Claude session process ended unexpectedly', model: this.spec.model },
        ])
      } else if (failure !== undefined) {
        this.dispatch([failure])
      }
      this.events?.close()
    }
  }

  // A lookup of delivered notices must not end the session it annotates.
  private async readDeliveries(assistantId: string): ReturnType<ClaudeTaskDeliveryReader['forAssistant']> {
    try {
      return await this.deliveries.forAssistant(assistantId)
    } catch {
      return []
    }
  }

  /**
   * Forget a query whose process has exited so the next turn starts a new one
   * instead of writing to a stream nobody reads. Whatever that process was
   * still running or holding back went with it.
   */
  private discardQuery(): AgentEvent[] {
    this.input?.close()
    this.abortController?.abort()
    this.query = undefined
    this.input = undefined
    this.abortController = undefined
    this.heldResult = undefined
    this.sessionStateAvailable = false
    this.pendingNotices.clear()
    this.consumedNotices.clear()
    return this.mapper.backgroundTasks.abandon()
  }

  // The SDK does not tell a tool handler which call it serves, so progress is
  // attached to the running call of that tool rather than to whichever tool
  // happened to start last.
  private emitToolProgress(toolName: string, chunk: string): void {
    const events = this.events
    const toolId = this.mapper.runningToolId(toolName)
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
  readonly emitProgress?: ToolProgressEmitter
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
  target: SessionTarget = { kind: 'new', provider: 'claude' },
  abortController?: AbortController,
  tools: readonly ToolDefinition[] = [],
  emitters: ClaudeToolEmitters = {},
): Options {
  assertClaudeEffort(spec.effort)
  const pluginServers = enabledPluginMcpServers(spec.enabledPluginIds ?? [])
  const options: Options = {
    cwd: spec.cwd,
    plugins: resolveBuiltinPlugins(spec.enabledPluginIds ?? []).map((plugin) => ({ type: 'local' as const, path: plugin.rootDir })),
    model: spec.model,
    agentProgressSummaries: true,
    allowDangerouslySkipPermissions: true,
    disallowedTools: claudeDisallowedTools(spec.runMode, pluginServers),
    enableFileCheckpointing: true,
    forwardSubagentText: true,
    includePartialMessages: true,
    perTaskStopAffordance: true,
    permissionMode: 'bypassPermissions',
    promptSuggestions: spec.promptSuggestions !== false,
    systemPrompt: claudeSystemPrompt(spec),
    settingSources: ['user', 'project', 'local'],
    settings: resolveClaudeQuerySettings(spec, pluginServers),
    env: resolveClaudeQueryEnv(spec),
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
  }, emitters.emitProgress)
  if (compiled.mcpServers !== undefined || pluginServers.length > 0) {
    options.mcpServers = { ...compiled.mcpServers, ...claudePluginMcpServers(pluginServers) }
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
  pluginServers: readonly PluginMcpServer[] = [],
  existingHooks?: Settings['hooks'],
): Settings {
  const hooks = { ...existingHooks }
  // A stateful plugin server learns that a turn or subagent stopped from the host, never from the model.
  const stateful = pluginServers.flatMap((server) => server.turnEndTool ? [{ server: server.name, tool: server.turnEndTool }] : [])
  if (stateful.length) {
    for (const event of ['Stop', 'SubagentStop'] as const) {
      hooks[event] = [...(hooks[event] ?? []), { hooks: stateful.map(({ server, tool }) => ({
        type: 'mcp_tool', server, tool,
        input: {
          hook_event_name: '${hook_event_name}',
          session_id: event === 'Stop' ? '${session_id}' : '${agent_id}',
          turn_id: '${prompt_id}',
        },
      })) }]
    }
  }
  return {
    ...(Object.keys(hooks).length ? { hooks } : {}),
    crossSessionInbound: 'accept',
    enableAllProjectMcpServers: true,
    skillOverrides: Object.fromEntries(
      CLAUDE_DISABLED_SKILLS.map((name) => [name, 'off' as const]),
    ),
    // Flag-tier env beats project/user settings.json env. See Claude Code settings precedence.
    env: resolveProviderRunEnv(spec),
  }
}

export function resolveClaudeQueryEnv(
  spec: ProviderRunSpec,
): Record<string, string> {
  const contextWindow = spec.contextWindow ?? DEFAULT_CONTEXT_WINDOW
  return mergeProviderProcessEnv(
    resolveProviderRunEnv(spec),
    new Set(profileEnvKeys('claude')),
    {
      CLAUDE_CODE_HARBOR_KITE: '1',
      CLAUDE_CODE_DISABLE_1M_CONTEXT: contextWindow === 200_000 ? '1' : '0',
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(contextWindow),
      // The session selection owns this budget, including inherited runner settings.
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(contextWindow),
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
