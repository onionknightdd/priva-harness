import type { InteractionResponse } from '../../core/resource/interaction.js'
import { BackgroundTasks, taskIsActive } from '../../core/resource/background-task.js'
import { asRecord, stringField } from '../../core/event/json-record.js'
import { piTaskNotices } from './pi-background-tasks.js'
import type {
  AgentRuntime,
  ProviderRunSpec,
  QueueBehavior,
  SessionRef,
  TurnContext,
} from '../../core/contract/agent-provider.js'
import type { AgentEvent } from '../../core/event/agent-event.js'
import { emptyContextUsage, mapPiContextUsage } from '../../core/resource/context-usage.js'
import type { ContextUsage } from '../../core/resource/context-usage.js'
import { isRunResultEvent } from '../../core/event/agent-event.js'
import {
  compactInstructionsOf,
  isCompactCommandContent,
} from '../../core/resource/compact-command.js'
import { userTurnText, type UserTurn } from '../../core/run/user-turn.js'
import { AsyncQueue } from '../../core/stream/async-queue.js'
import { PiEventMapper, type PiSessionEvent } from './pi-event-mapper.js'

export interface PiAgentSession {
  initialize?(): Promise<void>
  respondPermission?(response: InteractionResponse): void
  stopTask?(taskId: string): Promise<void>
  readonly sessionId: string
  readonly modelId: string
  readonly isStreaming: boolean
  subscribe(listener: (event: PiSessionEvent) => void): () => void
  prompt(text: string): Promise<void>
  followUp(text: string): Promise<void>
  steer(text: string): Promise<void>
  compact?(customInstructions?: string): Promise<void>
  getContextUsage?(): { tokens: number | null; contextWindow: number } | undefined
  abort(): Promise<void>
  dispose(): Promise<void>
  bindProgressEmit?(emit: ((chunk: string) => void) | undefined): void
  setRunModel?(modelId: string): Promise<void>
}

export class PiRuntime implements AgentRuntime {
  private sessionHandle: PiAgentSession | undefined
  private readonly unsubscribe: () => void
  private mapper: PiEventMapper | undefined
  private events: AsyncQueue<AgentEvent> | undefined
  private readonly tasks = new BackgroundTasks()
  private readonly idleBacklog: AgentEvent[] = []
  private idleListener: ((events: readonly AgentEvent[]) => void) | undefined
  private turnEnded = false
  private readonly pendingNotices = new Set<string>()
  private readonly consumedNotices = new Set<string>()
  private readonly deliveredNotices = new Set<string>()
  private readonly resultReads = new Map<string, string>()

  constructor(
    private readonly agentSession: PiAgentSession,
    private queueBehavior: QueueBehavior = 'follow-up',
  ) {
    this.sessionHandle = agentSession
    this.mapper = new PiEventMapper({ sessionId: agentSession.sessionId, model: agentSession.modelId })
    this.unsubscribe = agentSession.subscribe((event) => {
      const mapped: AgentEvent[] = event.type === 'permission.requested' || event.type === 'permission.resolved'
        ? [event as AgentEvent] : this.mapper?.push(event) ?? []
      for (const frame of mapped) if (frame.type === 'task.updated' || frame.type === 'task.notification') {
        this.tasks.update(frame.task)
        if (frame.type === 'task.notification' && !this.deliveredNotices.has(frame.task.taskId)) this.pendingNotices.add(frame.task.taskId)
      }
      if (event.type === 'message_end') for (const task of piTaskNotices(event.message)) this.consumedNotices.add(task.taskId)
      if (event.type === 'tool_execution_start' && event.toolName === 'get_subagent_result' && event.toolCallId) {
        const id = stringField(asRecord(event.args) ?? {}, 'agent_id')
        if (id) this.resultReads.set(event.toolCallId, id)
      }
      if (event.type === 'tool_execution_end' && event.toolCallId) {
        const id = this.resultReads.get(event.toolCallId)
        const task = id ? this.tasks.get(id) : undefined
        if (task && !taskIsActive(task) && !event.isError) this.consumedNotices.add(task.taskId)
        this.resultReads.delete(event.toolCallId)
      }
      if (mapped.some(isRunResultEvent)) {
        for (const id of this.consumedNotices) { this.pendingNotices.delete(id); this.deliveredNotices.add(id) }
        this.consumedNotices.clear()
      }
      if (this.events && !this.turnEnded) {
        for (const frame of mapped) this.events.push(frame)
        if (mapped.some(isRunResultEvent)) { this.turnEnded = true; this.events.close() }
      } else {
        this.idleBacklog.push(...mapped)
        if (!this.events) this.flushIdle()
      }
    })
  }

  get hasBackgroundTasks(): boolean { return this.tasks.hasActive || this.idleBacklog.length > 0 || this.pendingNotices.size > 0 }
  listenIdle(listener: ((events: readonly AgentEvent[]) => void) | undefined): void {
    this.idleListener = listener
    if (!this.events) this.flushIdle()
  }
  private flushIdle(): void {
    if (this.idleListener && this.idleBacklog.length) this.idleListener(this.idleBacklog.splice(0))
  }
  async stopTask(taskId: string): Promise<void> {
    if (!this.agentSession.stopTask) throw new Error('Task runtime is unavailable')
    await this.agentSession.stopTask(taskId)
  }

  get session(): SessionRef {
    return { provider: 'pi', id: this.agentSession.sessionId }
  }

  async *run(turn: UserTurn, context: TurnContext): AsyncIterable<AgentEvent> {
    this.mapper?.beginUserTurn()
    this.turnEnded = false
    this.events = new AsyncQueue<AgentEvent>()
    this.agentSession.bindProgressEmit?.((chunk) => this.emitToolProgress(chunk))
    let finished = false

    const onAbort = (): void => {
      void this.agentSession.abort()
    }
    if (context.signal.aborted) onAbort()
    else context.signal.addEventListener('abort', onAbort, { once: true })

    const sending = (async () => {
      await this.agentSession.initialize?.()
      if (context.signal.aborted) {
        this.events?.push({ type: 'run.aborted', sessionId: this.session.id })
        this.events?.close()
        return
      }
      await this.send(userTurnText(turn))
    })().then(
      () => undefined,
      (error: unknown) => {
        if (!finished) {
          this.events?.push({
            type: 'run.failed',
            message: error instanceof Error ? error.message : String(error),
            sessionId: this.agentSession.sessionId,
            model: this.agentSession.modelId,
          })
        }
        this.events?.close()
      },
    )

    try {
      for await (const event of this.events.iterate()) {
        if (isRunResultEvent(event)) finished = true
        yield event
      }
      await sending
    } finally {
      this.agentSession.bindProgressEmit?.(undefined)
      context.signal.removeEventListener('abort', onAbort)
      this.events.close()
      this.events = undefined
    }
  }

  async applyRunSpec(spec: ProviderRunSpec): Promise<void> {
    if (spec.model !== this.agentSession.modelId) {
      if (this.agentSession.setRunModel === undefined) {
        throw new Error('Pi session cannot change model in place')
      }
      await this.agentSession.setRunModel(spec.model)
    }
    this.queueBehavior = spec.queueBehavior ?? 'follow-up'
  }

  respondPermission(response: InteractionResponse): void {
    if (!this.agentSession.respondPermission) throw new Error('Pi interaction runtime is unavailable')
    this.agentSession.respondPermission(response)
  }

  async abort(): Promise<void> {
    await this.sessionHandle?.abort()
  }

  getContextUsage(): Promise<ContextUsage> {
    if (this.sessionHandle === undefined) return Promise.resolve(emptyContextUsage())
    return Promise.resolve(mapPiContextUsage(this.sessionHandle.getContextUsage?.()))
  }

  async release(retention: 'warm' | 'dispose'): Promise<void> {
    this.events?.close()
    this.events = undefined
    if (retention === 'warm') { this.flushIdle(); return }
    this.idleListener = undefined
    this.unsubscribe()
    const session = this.sessionHandle
    this.sessionHandle = undefined
    await session?.dispose()
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

  private send(text: string): Promise<void> {
    if (isCompactCommandContent(text) && this.agentSession.compact !== undefined) {
      return this.compactSession(text)
    }
    if (!this.agentSession.isStreaming) return this.agentSession.prompt(text)
    if (this.queueBehavior === 'steer') return this.agentSession.steer(text)
    if (this.queueBehavior === 'interrupt') return this.interruptThenPrompt(text)
    return this.agentSession.followUp(text)
  }

  private async compactSession(text: string): Promise<void> {
    await this.agentSession.compact?.(compactInstructionsOf(text))
    this.events?.push({
      type: 'run.completed',
      sessionId: this.agentSession.sessionId,
      model: this.agentSession.modelId,
      durationMs: 0,
    })
  }

  private async interruptThenPrompt(text: string): Promise<void> {
    await this.agentSession.abort()
    await this.agentSession.prompt(text)
  }
}
