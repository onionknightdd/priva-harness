import type { InteractionRequest } from '../../core/resource/interaction.js'
import { randomUUID } from 'node:crypto'
import type { SessionRef } from '../../core/contract/agent-provider.js'
import { STREAM_PROTOCOL_VERSION, isRunResultEvent, type AgentEvent, type StreamFrame } from '../../core/event/agent-event.js'
import { BackgroundTasks, taskIsActive, taskNotificationReplyTarget, type BackgroundTask } from '../../core/resource/background-task.js'
import { applyStreamFrame, emptyAssistantMessage } from '../../core/resource/apply-stream-frame.js'
import { freezeMessageThinking, stampMessageThinkingTimes } from '../../core/resource/thinking-time.js'
import { taskReplyOwner, type ThreadMessage } from '../../core/resource/thread.js'

/** A session owns replay, task identity, and the rendered snapshot across response turns. */
export class SessionStream {
  readonly streamId = randomUUID()
  readonly tasks = new BackgroundTasks()
  private readonly interactions = new Map<string, { request: InteractionRequest; runId: string }>()
  private seq = 0
  private readonly buffer: StreamFrame[] = []
  private readonly listeners = new Set<(frame: StreamFrame) => void>()
  private messages: readonly ThreadMessage[]
  private activeRunId: string | undefined
  private readonly runTargets = new Map<string, string>()
  private writes = Promise.resolve()

  constructor(readonly session: SessionRef, history: readonly ThreadMessage[] = [], private readonly limit = 4096,
    private readonly saveTasks?: (tasks: readonly BackgroundTask[]) => Promise<void>, savedTasks: readonly BackgroundTask[] = []) {
    for (const task of savedTasks) this.tasks.update({ ...task, status: taskIsActive(task) ? 'unknown' : task.status, stopRequested: false })
    this.messages = history.map((message) => ({ ...message, blocks: (message.blocks ?? []).map((block) => {
      if (block.type !== 'tool_use' || !block.tool?.backgroundTask) return block
      const saved = { ...block.tool.backgroundTask, ...this.tasks.get(block.tool.backgroundTask.taskId) }
      const task = this.tasks.update({ ...saved,
        status: ['running', 'pending', 'paused'].includes(saved.status) ? 'unknown' : saved.status })
      return { ...block, tool: { ...block.tool, backgroundTask: task } }
    }) }))
  }

  publish(event: AgentEvent, runId = ''): StreamFrame {
    // Cancellation may stop the provider iterator before its final resolution is drained.
    if (event.type === 'run.aborted' || event.type === 'run.failed') {
      for (const pending of [...this.interactions.values()]) {
        if (pending.runId === runId) this.publish({ type: 'permission.resolved',
          resolution: { request: pending.request, decision: 'deny', reason: 'cancelled' } }, runId)
      }
    }
    if (event.type === 'permission.requested') this.interactions.set(event.request.requestId, { request: event.request, runId })
    if (event.type === 'permission.resolved') this.interactions.delete(event.resolution.request.requestId)
    let normalized = event
    if (event.type === 'task.updated' || event.type === 'task.notification' || event.type === 'task.delivered') {
      const owner = this.messages.find((message) => message.blocks?.some((block) => block.type === 'tool_use' && block.id === event.task.toolUseId))
      normalized = { ...event, task: this.tasks.update({ ...event.task,
        ...(this.tasks.get(event.task.taskId)?.originRunId || !owner ? {} : { originRunId: owner.id }),
        updatedAt: Date.now() }) }
    } else if (event.type === 'tasks.snapshot') {
      for (const task of event.tasks) this.tasks.update(task)
      normalized = { ...event, tasks: this.tasks.list() }
    }
    if (normalized.type === 'task.delivered') normalized = { ...normalized, notification: { ...normalized.notification, task: normalized.task } }
    const reply = normalized.type === 'task.delivered' ? taskNotificationReplyTarget(normalized.notification) : normalized.replyTo
    const owner = reply ? taskReplyOwner(this.messages, reply) : undefined
    const replyTargetId = reply?.turnId ?? owner?.id
    if (replyTargetId && runId && (normalized.type !== 'task.delivered' || reply?.turnId)) this.runTargets.set(runId, replyTargetId)
    const messageTargetId = replyTargetId ?? this.runTargets.get(runId) ?? runId
    const frame = { ...this.frame(normalized, ++this.seq, runId), ...(messageTargetId ? { messageTargetId } : {}) }
    this.reduce(frame)
    this.buffer.push(frame)
    if (this.buffer.length > this.limit) this.buffer.shift()
    for (const listener of this.listeners) listener(frame)
    if (this.saveTasks && (event.type === 'task.updated' || event.type === 'task.notification' || event.type === 'task.delivered' || event.type === 'tasks.snapshot')) {
      const tasks = this.tasks.list()
      this.writes = this.writes.then(() => this.saveTasks?.(tasks)).catch((error: unknown) => {
        this.publish({ type: 'error', code: 'task.persistence', message: `Could not save background task state: ${error instanceof Error ? error.message : String(error)}` })
      })
    }
    return frame
  }

  async flush(): Promise<void> { await this.writes }

  /** Snapshot and cursor are captured synchronously with listener registration. */
  subscribe(listener: (frame: StreamFrame) => void, cursor?: { streamId: string; seq: number }): () => void {
    this.listeners.add(listener)
    const firstSeq = this.buffer[0]?.seq ?? this.seq + 1
    if (cursor?.streamId === this.streamId && cursor.seq >= firstSeq - 1 && cursor.seq <= this.seq) {
      const replay = this.buffer.filter((frame) => frame.seq > cursor.seq)
      for (const frame of replay) listener(frame)
    } else {
      if (cursor) listener(this.frame({ type: 'replay.gap', firstSeq, lastSeq: this.seq }, this.seq))
      listener(this.snapshot())
    }
    return () => this.listeners.delete(listener)
  }

  snapshot(): StreamFrame & { type: 'session.snapshot' } {
    return this.frame({ type: 'session.snapshot', tasks: this.tasks.list(), messages: this.messages, interactions: [...this.interactions.values()].map(({ request }) => request),
      ...(this.activeRunId ? { activeRunId: this.activeRunId } : {}) }, this.seq) as StreamFrame & { type: 'session.snapshot' }
  }

  private frame(event: AgentEvent, seq: number, runId = ''): StreamFrame {
    return { ...event, v: STREAM_PROTOCOL_VERSION, streamId: this.streamId, seq, runId,
      ts: Date.now(), harness: this.session.provider, sessionId: this.session.id }
  }

  private reduce(frame: StreamFrame): void {
    if (frame.type === 'run.started') {
      this.activeRunId = frame.runId
      const targetId = frame.messageTargetId ?? frame.runId
      if (frame.userMessage) this.messages = [...this.messages, frame.userMessage]
      if (frame.userMessage || frame.replyTo) {
        this.messages = this.messages.some((message) => message.id === targetId)
          ? this.messages.map((message) => message.id === targetId ? { ...message, status: 'streaming' } : message)
          : [...this.messages, emptyAssistantMessage(targetId, new Date(frame.ts).toISOString())]
      }
      return
    }
    if (frame.type === 'task.updated' || frame.type === 'task.notification' || frame.type === 'tasks.snapshot') {
      const tasks = frame.type === 'tasks.snapshot' ? frame.tasks : [frame.task]
      this.messages = this.messages.map((message) => tasks.reduce((next, task) =>
        applyStreamFrame(next, { type: 'task.updated', task }), message))
      return
    }
    if (frame.type === 'session.state' || frame.type === 'session.snapshot') return
    const targetId = frame.messageTargetId ?? frame.runId
    if (frame.type === 'task.delivered') {
      this.messages = this.messages.map((message) => {
        const updated = applyStreamFrame(message, { type: 'task.updated', task: frame.task })
        return frame.notification.turnId && message.id !== targetId && message.status === 'streaming'
          ? { ...freezeMessageThinking(updated, frame.ts), status: 'complete' } : updated
      })
    }
    if (targetId && (frame.type.startsWith('assistant.') || frame.type === 'tool.started' || frame.type === 'task.delivered') && !('parentToolUseId' in frame && frame.parentToolUseId) &&
      !this.messages.some((message) => message.id === targetId)) {
      this.messages = [...this.messages, emptyAssistantMessage(targetId, new Date(frame.ts).toISOString())]
    }
    if (targetId !== frame.runId) this.messages = this.messages.filter((message) => message.id !== frame.runId ||
      message.content !== '' || (message.blocks?.length ?? 0) > 0 || message.role === 'user')
    const parent = 'workflowToolUseId' in frame ? frame.workflowToolUseId : 'parentToolUseId' in frame ? frame.parentToolUseId : undefined
    this.messages = this.messages.map((message) => {
      const owns = parent ? message.blocks?.some((block) => block.type === 'tool_use' && block.id === parent) : message.id === targetId
      if (!owns) return message
      let next = stampMessageThinkingTimes(message, applyStreamFrame(message, frame), frame, frame.ts)
      if (frame.type.startsWith('assistant.') && !parent) next = { ...next, status: 'streaming' }
      if (isRunResultEvent(frame)) next = { ...freezeMessageThinking(next, frame.ts), status: next.status === 'error' ? 'error' : 'complete' }
      return this.tasks.list().reduce((message, task) => applyStreamFrame(message, { type: 'task.updated', task }), next)
    })
    if (isRunResultEvent(frame)) {
      if (this.activeRunId === frame.runId) this.activeRunId = undefined
      this.runTargets.delete(frame.runId)
    }
  }
}
