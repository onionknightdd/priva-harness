import { BackgroundTasks } from '../../core/resource/background-task.js'
import { TaskReplyTracker } from '../../core/resource/task-reply-tracker.js'
import type { BackgroundTask } from '../../core/resource/background-task.js'
import { piBackgroundLaunch, piTaskNotices } from './pi-background-tasks.js'
import { piWorkflowToolResult } from './pi-workflow-data.js'
import type { WorkflowState } from '../../core/resource/workflow.js'
import type {
  AgentEvent,
  BlockKind,
  ContentBlock,
  ModelTokenUsage,
  RunAccounting,
  RunFailureCode,
} from '../../core/event/agent-event.js'
import {
  asRecord,
  isRecord,
  numberField,
  stringField,
  type JsonRecord,
} from '../../core/event/json-record.js'

import { canonicalProductToolName, isReadToolName } from '../../core/event/tool-names.js'
import { patchFromToolDetails } from '../../core/event/tool-patch.js'
import { encodeReadView } from '../../core/event/tool-read.js'
import { piToolResultMetadata } from './pi-tool-result.js'

export interface PiSessionEvent {
  readonly task?: BackgroundTask
  readonly workflow?: WorkflowState
  readonly type: string
  readonly assistantMessageEvent?: unknown
  readonly message?: unknown
  readonly messages?: unknown
  readonly toolCallId?: string
  readonly parentToolCallId?: string
  readonly toolName?: string
  readonly args?: unknown
  readonly partialResult?: unknown
  readonly result?: unknown
  readonly isError?: boolean
  readonly reason?: string
  readonly aborted?: boolean
  readonly errorMessage?: string
}

export interface PiEventMapperOptions {
  readonly sessionId: string
  readonly model: string
  readonly startedAt?: number
}

interface PendingTool {
  id: string | undefined
  name: string | undefined
  started: boolean
}

export class PiEventMapper {
  private readonly replies = new TaskReplyTracker()
  private readonly tasks = new BackgroundTasks()
  private noticeSeq = 0

  beginUserTurn(): void { this.replies.clear() }

  private readonly workflows = new Map<string, WorkflowState>()
  private startedAt: number
  private model: string
  private messageSeq = 0
  private currentMessageId: string | undefined
  private lastMessageId: string | undefined
  private readonly pendingByIndex = new Map<number, PendingTool>()
  private readonly tools = new Map<string, string>()
  private readonly started = new Set<string>()
  private readonly startedBlocks = new Set<string>()
  private readonly blocks = new Map<number, ContentBlock>()
  private readonly indexByToolId = new Map<string, number>()
  private lastToolId: string | undefined
  private readonly runMessages = new Map<string, unknown>()
  private readonly parentTools = new Map<string, string>()
  private readonly toolMessages = new Map<string, string>()
  private settled = true
  private readonly messageKeys = new WeakMap<object, string>()
  private messageKeySeq = 0

  constructor(private readonly options: PiEventMapperOptions) {
    this.startedAt = options.startedAt ?? Date.now()
    this.model = options.model
  }

  activeMessageId(): string {
    return this.ensureMessageId()
  }

  latestToolId(): string | undefined {
    return this.lastToolId
  }

  beginRun(): void {
    this.beginUserTurn()
    this.startedAt = Date.now()
    this.runMessages.clear()
    this.settled = false
  }

  push(event: PiSessionEvent): AgentEvent[] {
    const raw = asRecord(event.message)
    if (event.type === 'message_end' && raw?.['role'] === 'user') this.beginUserTurn()
    const notices = event.type === 'message_end' ? piTaskNotices(event.message) : []
    if (notices.length) return notices.flatMap((task) => {
      const updated = this.tasks.update(task)
      return this.replies.deliver({ id: `${stringField(raw ?? {}, 'id') ?? String(numberField(raw ?? {}, 'timestamp') ?? ++this.noticeSeq)}:${task.taskId}`, task: updated })
    })
    return this.replies.route(this.map(event).map((mapped) =>
      mapped.type === 'task.updated' || mapped.type === 'task.notification' ? { ...mapped, task: this.tasks.update(mapped.task) } : mapped))
  }

  private map(event: PiSessionEvent): AgentEvent[] {
    if ((event.type === 'task.updated' || event.type === 'task.notification') && event.task) return [{ type: event.type, task: event.task }]
    if (event.type === 'background_error') return [{ type: 'error', message: event.errorMessage ?? 'Background result delivery failed' }]
    switch (event.type) {
      case 'agent_start':
        if (this.settled) this.beginRun()
        return [{ type: 'session.state', state: 'running' }]
      case 'workflow_progress':
        return event.workflow ? this.mapWorkflow(event.workflow) : []
      case 'message_update':
        return this.mapMessageUpdate(event)
      case 'message_end':
        this.rememberRunMessages([event.message])
        return this.mapMessageEnd(event.message)
      case 'tool_execution_start':
        return this.mapToolExecutionStart(event)
      case 'tool_execution_update':
        return this.mapToolExecutionUpdate(event)
      case 'tool_execution_end':
        return this.mapToolExecutionEnd(event)
      case 'agent_end':
        this.rememberRunMessages(event.messages)
        return []
      case 'agent_settled':
        this.settled = true
        return [this.mapAgentEnd([...this.runMessages.values()], event.aborted)]
      case 'compaction_start':
        return [{ type: 'session.compacting' }]
      case 'compaction_end':
        return this.mapCompactionEnd(event)
      default:
        return []
    }
  }

  private mapMessageUpdate(event: PiSessionEvent): AgentEvent[] {
    const update = asRecord(event.assistantMessageEvent)
    if (update === undefined) return []
    const type = stringField(update, 'type')
    const index = numberField(update, 'contentIndex') ?? 0
    if (type === 'text_delta') {
      const text = stringField(update, 'delta')
      if (text === undefined || text === '') return []
      const messageId = this.ensureMessageId()
      const blockId = `${messageId}:${index}`
      this.rememberText(index, blockId, text)
      return [
        ...this.emitBlockStart(messageId, blockId, index, 'text'),
        { type: 'assistant.delta', messageId, blockId, index, text },
      ]
    }
    if (type === 'thinking_delta') {
      const text = stringField(update, 'delta')
      if (text === undefined || text === '') return []
      const messageId = this.ensureMessageId()
      const blockId = `${messageId}:${index}`
      this.rememberThinking(index, blockId, text)
      return [
        ...this.emitBlockStart(messageId, blockId, index, 'thinking'),
        { type: 'assistant.thinking_delta', messageId, blockId, index, text },
      ]
    }
    if (type === 'image_delta' || type === 'partial_image') {
      const image = imageFrom(update)
      if (image.url === undefined && image.b64 === undefined) return []
      const messageId = this.ensureMessageId()
      const blockId = `${messageId}:${index}`
      this.blocks.set(index, { type: 'image', blockId, index, ...image })
      return [
        ...this.emitBlockStart(messageId, blockId, index, 'image'),
        { type: 'assistant.image_delta', messageId, blockId, index, ...image },
      ]
    }
    if (type === 'toolcall_start') {
      return this.startTool(index, update, event.message)
    }
    if (type === 'toolcall_delta') {
      const events = this.startTool(index, update, event.message)
      const chunk = stringField(update, 'delta')
      const id = this.toolIdAt(index)
      const messageId = this.lastMessageId ?? this.ensureMessageId()
      if (id === undefined || chunk === undefined || chunk === '') return events
      events.push({
        type: 'tool.input_delta',
        messageId,
        blockId: id,
        index,
        id,
        chunk,
      })
      return events
    }
    if (type === 'toolcall_end') {
      return this.endToolCall(index, update)
    }
    this.rememberModel(asRecord(update['partial']) ?? asRecord(event.message))
    return []
  }

  private startTool(index: number, update: JsonRecord, message: unknown): AgentEvent[] {
    const toolCall =
      toolCallFrom(asRecord(update['partial']) ?? asRecord(message), index) ??
      asRecord(update['toolCall'])
    const pending = this.pendingAt(index)
    if (toolCall !== undefined) {
      const id = stringField(toolCall, 'id')
      const name = stringField(toolCall, 'name')
      if (id !== undefined) pending.id = id
      if (name !== undefined) pending.name = normalizeToolName(name)
    }
    const messageId = this.ensureMessageId()
    const placeholderId = pending.id ?? `${messageId}:${index}`
    const events = this.emitBlockStart(messageId, placeholderId, index, 'tool_use')
    events.push(...this.emitStarted(pending, index, toolCall?.['arguments']))
    return events
  }

  private endToolCall(index: number, update: JsonRecord): AgentEvent[] {
    const toolCall = asRecord(update['toolCall'])
    const pending = this.pendingAt(index)
    if (toolCall !== undefined) {
      const id = stringField(toolCall, 'id')
      const name = stringField(toolCall, 'name')
      if (id !== undefined) pending.id = id
      if (name !== undefined) pending.name = normalizeToolName(name)
    }
    const events = this.emitStarted(pending, index, toolCall?.['arguments'])
    if (pending.id !== undefined && toolCall?.['arguments'] !== undefined && pending.started) {
      const messageId = this.lastMessageId ?? this.ensureMessageId()
      events.push({
        type: 'tool.updated',
        messageId,
        blockId: pending.id,
        index,
        id: pending.id,
        name: pending.name ?? 'unknown',
        input: toolCall['arguments'],
      })
    }
    return events
  }

  private emitStarted(pending: PendingTool, index: number, input: unknown): AgentEvent[] {
    if (pending.id === undefined || pending.started) return []
    const name = pending.name ?? 'unknown'
    pending.started = true
    this.started.add(pending.id)
    this.tools.set(pending.id, name)
    this.indexByToolId.set(pending.id, index)
    const messageId = this.lastMessageId ?? this.ensureMessageId()
    this.blocks.set(index, {
      type: 'tool_use',
      blockId: pending.id,
      index,
      id: pending.id,
      name,
      ...(input === undefined ? {} : { input }),
    })
    return [
      input === undefined
        ? { type: 'tool.started', messageId, blockId: pending.id, index, id: pending.id, name }
        : { type: 'tool.started', messageId, blockId: pending.id, index, id: pending.id, name, input },
    ]
  }

  private mapMessageEnd(raw: unknown): AgentEvent[] {
    this.rememberModel(asRecord(raw))
    const message = asRecord(raw)
    if (message?.['role'] === 'toolResult') {
      const toolCallId = stringField(message, 'toolCallId')
      const toolName = stringField(message, 'toolName')
      return this.mapToolExecutionEnd({ type: 'tool_execution_end',
        ...(toolCallId === undefined ? {} : { toolCallId }), ...(toolName === undefined ? {} : { toolName }),
        result: message, isError: message['isError'] === true,
      })
    }
    if (message === undefined || stringField(message, 'role') !== 'assistant') {
      return []
    }
    const messageId = this.ensureMessageId(stringField(message, 'id'))
    const blocks = this.snapshotBlocks(message, messageId)
    this.currentMessageId = undefined
    this.pendingByIndex.clear()
    this.startedBlocks.clear()
    this.blocks.clear()
    return [{ type: 'assistant.message', messageId, blocks }]
  }

  private mapToolExecutionStart(event: PiSessionEvent): AgentEvent[] {
    const id = event.toolCallId
    if (id === undefined) return []
    const name = normalizeToolName(event.toolName ?? this.tools.get(id) ?? 'unknown')
    this.tools.set(id, name)
    this.lastToolId = id
    if (event.parentToolCallId) this.parentTools.set(id, event.parentToolCallId)
    const messageId = (event.parentToolCallId === undefined ? undefined : this.toolMessages.get(event.parentToolCallId)) ?? this.lastMessageId ?? this.ensureMessageId()
    this.toolMessages.set(id, messageId)
    const parent = event.parentToolCallId ? { parentToolCallId: event.parentToolCallId } : {}
    const index = this.indexByToolId.get(id)
    const events: AgentEvent[] = []
    if (!this.started.has(id)) {
      this.started.add(id)
      events.push(
        event.args === undefined
          ? { type: 'tool.started', messageId, blockId: id, ...(index === undefined ? {} : { index }), id, name, ...parent }
          : {
              type: 'tool.started',
              messageId,
              blockId: id,
              ...(index === undefined ? {} : { index }),
              id,
              name,
              input: event.args,
              ...parent,
            },
      )
    }
    events.push({
      type: 'tool.running',
      id,
      messageId,
      ...parent,
      blockId: id,
      ...(index === undefined ? {} : { index }),
    })
    return events
  }

  private mapToolExecutionUpdate(event: PiSessionEvent): AgentEvent[] {
    const id = event.toolCallId
    if (id === undefined) return []
    const workflow = this.workflowEvent(id, event.toolName ?? this.tools.get(id) ?? '', event.partialResult)
    const chunk = toolOutput(event.partialResult)
    const metadata = piToolResultMetadata(event.partialResult)
    if (workflow.length) return workflow
    if (chunk === '' && !metadata.modelCalls?.length && !metadata.artifacts?.length &&
      metadata.structuredContent === undefined && !metadata.resultContent?.length) return []
    const index = this.indexByToolId.get(id)
    const parentToolCallId = this.parentTools.get(id)
    const messageId = this.toolMessages.get(id)
    return [
      {
        type: 'tool.progress',
        id,
        channel: 'stdout',
        chunk,
        ...metadata,
        ...(parentToolCallId === undefined ? {} : { parentToolCallId }),
        ...(messageId === undefined ? {} : { messageId }),
        blockId: id,
        ...(index === undefined ? {} : { index }),
      },
    ]
  }

  private mapToolExecutionEnd(event: PiSessionEvent): AgentEvent[] {
    const id = event.toolCallId
    if (id === undefined) return []
    const name = normalizeToolName(event.toolName ?? this.tools.get(id) ?? 'unknown')
    const workflow = this.workflowEvent(id, name, event.result, true)
    const index = this.indexByToolId.get(id)
    const task = piBackgroundLaunch(id, name, event.result)
    const tasks: AgentEvent[] = task ? [{ type: 'task.updated', task }] : []
    const parentToolCallId = this.parentTools.get(id)
    const messageId = this.toolMessages.get(id) ?? this.lastMessageId
    return [
      ...tasks,
      ...workflow,
      {
        type: 'tool.completed',
        id,
        name,
        ok: event.isError !== true,
        output: completedToolOutput(name, event.result),
        ...piToolResultMetadata(event.result),
        ...(parentToolCallId === undefined ? {} : { parentToolCallId }),
        ...(messageId === undefined ? {} : { messageId }),
        blockId: id,
        ...(index === undefined ? {} : { index }),
      },
    ]
  }

  private workflowEvent(id: string, name: string, result: unknown, terminal = false): AgentEvent[] {
    const previous = this.workflows.get(id)
    // The embedded manager has richer timing/transcript state than tool details.
    if (previous?.workflowRunId && previous.agents.some((a) => a.startedAt !== undefined)) return []
    const workflow = piWorkflowToolResult(id, name, result, previous, terminal)
    if (!workflow) return []
    return this.mapWorkflow(workflow)
  }

  private mapWorkflow(workflow: WorkflowState): AgentEvent[] {
    const id = workflow.workflowToolUseId
    const previous = this.workflows.get(id)
    this.workflows.set(id, workflow)
    const events: AgentEvent[] = [{ type: 'workflow.progress', workflowToolUseId: id, workflow }]
    if (!['pending', 'running'].includes(workflow.status) && previous?.status !== workflow.status) {
      events.push({ type: 'workflow.completed', workflowToolUseId: id, status: workflow.status })
    }
    return events
  }

  private mapCompactionEnd(event: PiSessionEvent): AgentEvent[] {
    const record = asRecord(event.result)
    const summary = record === undefined ? undefined : stringField(record, 'summary')
    if (summary !== undefined && summary.trim() !== '') {
      return [{ type: 'session.compacted', summary }]
    }
    if (event.result !== undefined && event.result !== null && event.aborted !== true) {
      return [{ type: 'session.compacted' }]
    }
    const sessionId = this.options.sessionId === '' ? undefined : this.options.sessionId
    return [
      {
        type: 'run.failed',
        message: event.errorMessage ?? 'Conversation compaction failed',
        code: 'compaction_failed',
        ...(sessionId === undefined ? {} : { sessionId }),
        model: this.model === '' ? this.options.model : this.model,
      },
    ]
  }

  private rememberRunMessages(messages: unknown): void {
    if (!Array.isArray(messages)) return
    for (const message of messages) {
      const raw = asRecord(message)
      if (!raw || (raw['role'] !== 'assistant' && raw['role'] !== 'toolResult')) continue
      let key = this.messageKeys.get(raw)
      if (!key) {
        key = raw['role'] === 'toolResult' && typeof raw['toolCallId'] === 'string' ? `tool:${raw['toolCallId']}` :
          raw['id'] !== undefined || raw['timestamp'] !== undefined ?
            `${raw['role']}:${String(raw['id'] ?? raw['timestamp'])}:${String(raw['model'])}:${JSON.stringify(raw['content'])}` :
            `message:${++this.messageKeySeq}`
        this.messageKeys.set(raw, key)
      }
      this.runMessages.set(key, message)
    }
  }

  private mapAgentEnd(messages: unknown, aborted = false): AgentEvent {
    const model = this.model === '' ? this.options.model : this.model
    const accounting: RunAccounting = {
      durationMs: Math.max(0, Date.now() - this.startedAt),
      ...usageFromMessages(messages, model),
    }
    const sessionId = this.options.sessionId === '' ? undefined : this.options.sessionId
    const failure = assistantFailure(messages)
    if (failure?.aborted || aborted) {
        return {
          type: 'run.aborted',
          ...(sessionId === undefined ? {} : { sessionId }),
          model,
          message: failure?.message ?? 'aborted',
          ...accounting,
        }
    }
    if (failure !== undefined) {
      return {
        type: 'run.failed',
        message: failure.message,
        code: classifyPiFailure(failure.message),
        ...(sessionId === undefined ? {} : { sessionId }),
        model,
        ...accounting,
      }
    }
    return {
      type: 'run.completed',
      ...(sessionId === undefined ? {} : { sessionId }),
      model,
      durationMs: accounting.durationMs ?? 0,
      ...accounting,
    }
  }

  private snapshotBlocks(message: JsonRecord, messageId: string): ContentBlock[] {
    const remembered = [...this.blocks.values()].sort((left, right) => left.index - right.index)
    if (remembered.length > 0) return remembered
    return contentBlocksFromMessage(message, messageId)
  }

  private rememberText(index: number, blockId: string, text: string): void {
    const existing = this.blocks.get(index)
    if (existing?.type === 'text') {
      this.blocks.set(index, { ...existing, text: existing.text + text })
      return
    }
    this.blocks.set(index, { type: 'text', blockId, index, text })
  }

  private rememberThinking(index: number, blockId: string, text: string): void {
    const existing = this.blocks.get(index)
    if (existing?.type === 'thinking') {
      this.blocks.set(index, { ...existing, text: existing.text + text })
      return
    }
    this.blocks.set(index, { type: 'thinking', blockId, index, text })
  }

  private emitBlockStart(
    messageId: string,
    blockId: string,
    index: number,
    kind: BlockKind,
  ): AgentEvent[] {
    const key = `${messageId}:${index}:${kind}`
    if (this.startedBlocks.has(key)) return []
    this.startedBlocks.add(key)
    return [{ type: 'assistant.block_start', messageId, blockId, index, kind }]
  }

  private pendingAt(index: number): PendingTool {
    const existing = this.pendingByIndex.get(index)
    if (existing !== undefined) return existing
    const created: PendingTool = { id: undefined, name: undefined, started: false }
    this.pendingByIndex.set(index, created)
    return created
  }

  private toolIdAt(index: number): string | undefined {
    return this.pendingByIndex.get(index)?.id
  }

  private ensureMessageId(preferred?: string): string {
    if (this.currentMessageId !== undefined) return this.currentMessageId
    this.currentMessageId = preferred ?? `msg_${(this.messageSeq += 1)}`
    this.lastMessageId = this.currentMessageId
    return this.currentMessageId
  }

  private rememberModel(message: JsonRecord | undefined): void {
    const model = message === undefined ? undefined : stringField(message, 'model')
    if (model !== undefined && model !== '') this.model = model
  }
}

function toolCallFrom(message: JsonRecord | undefined, index: number): JsonRecord | undefined {
  if (message === undefined) return undefined
  const content = message['content']
  if (!Array.isArray(content)) return undefined
  return asRecord(content[index])
}

function contentBlocksFromMessage(message: JsonRecord, messageId: string): ContentBlock[] {
  const content = message['content']
  if (typeof content === 'string') {
    return content === ''
      ? []
      : [{ type: 'text', blockId: `${messageId}:0`, index: 0, text: content }]
  }
  if (!Array.isArray(content)) return []
  const blocks: ContentBlock[] = []
  content.forEach((item, index) => {
    const block = asRecord(item)
    if (block === undefined) return
    const type = stringField(block, 'type')
    if (type === 'text') {
      blocks.push({
        type: 'text',
        blockId: `${messageId}:${index}`,
        index,
        text: stringField(block, 'text') ?? '',
      })
      return
    }
    if (type === 'thinking') {
      blocks.push({
        type: 'thinking',
        blockId: `${messageId}:${index}`,
        index,
        text: stringField(block, 'thinking') ?? stringField(block, 'text') ?? '',
      })
      return
    }
    if (type === 'image' || type === 'image_url' || type === 'output_image') {
      blocks.push({
        type: 'image',
        blockId: `${messageId}:${index}`,
        index,
        ...imageFrom(block),
      })
      return
    }
    if (type === 'toolCall' || type === 'tool_use') {
      const id = stringField(block, 'id') ?? `${messageId}:${index}`
      blocks.push({
        type: 'tool_use',
        blockId: id,
        index,
        id,
        name: normalizeToolName(stringField(block, 'name') ?? 'unknown'),
        ...(block['arguments'] === undefined && block['input'] === undefined
          ? {}
          : { input: block['arguments'] ?? block['input'] }),
      })
    }
  })
  return blocks
}

function normalizeToolName(name: string): string {
  return canonicalProductToolName(name)
}

function completedToolOutput(name: string, value: unknown): string {
  if (isReadToolName(name)) {
    const encoded = encodeReadView(value)
    if (encoded !== '') return encoded
  }
  return toolOutput(value)
}

function toolOutput(value: unknown): string {
  if (typeof value === 'string') return value
  const record = asRecord(value)
  if (record === undefined) {
    if (value === undefined || value === null) return ''
    return JSON.stringify(value)
  }
  const patch = patchFromToolDetails(record)
  if (patch !== '') return patch
  const content = record['content']
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const text = content.filter(isRecord).map((block) => stringField(block, 'text') ?? '').join('')
    if (text !== '') return text
  }
  const details = record['details']
  if (typeof details === 'string') return details
  const detailRecord = asRecord(details)
  const output = detailRecord === undefined ? undefined : stringField(detailRecord, 'output')
  if (output !== undefined) return output
  return ''
}

function imageFrom(block: JsonRecord): { mime?: string; url?: string; b64?: string } {
  const source = asRecord(block['source']) ?? asRecord(block['image_url']) ?? block
  const url = stringField(source, 'url') ?? stringField(block, 'url')
  const b64 =
    stringField(source, 'data') ??
    stringField(source, 'b64') ??
    stringField(block, 'b64') ??
    stringField(block, 'partial_image_b64')
  const mime = stringField(source, 'media_type') ?? stringField(source, 'mime') ?? stringField(block, 'mime')
  return {
    ...(mime === undefined ? {} : { mime }),
    ...(url === undefined ? {} : { url }),
    ...(b64 === undefined ? {} : { b64 }),
  }
}

function assistantFailure(
  messages: unknown,
): { message: string; aborted: boolean } | undefined {
  if (!Array.isArray(messages)) return undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = asRecord(messages[index])
    if (message === undefined || stringField(message, 'role') !== 'assistant') continue
    const stopReason = stringField(message, 'stopReason')
    const errorMessage = stringField(message, 'errorMessage')
    if (stopReason !== 'error' && stopReason !== 'aborted') return undefined
    const aborted = stopReason === 'aborted'
    return {
      aborted,
      message:
        errorMessage !== undefined && errorMessage !== ''
          ? errorMessage
          : aborted
            ? 'aborted'
            : 'run failed',
    }
  }
  return undefined
}

// agent_end carries every message the run produced. Each assistant message is
// one model round-trip with its own usage, so the turn total is their sum,
// bucketed by the model that answered (a run can switch models mid-way).
function usageFromMessages(messages: unknown, fallbackModel: string): RunAccounting {
  if (!Array.isArray(messages)) return {}
  const byModel: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number | undefined }> = {}
  let numTurns = 0
  for (const raw of messages) {
    const message = asRecord(raw)
    if (message === undefined) continue
    if (stringField(message, 'role') === 'toolResult') {
      addToolUsage(message, byModel)
      continue
    }
    if (stringField(message, 'role') !== 'assistant') continue
    numTurns += 1
    const usage = asRecord(message['usage'])
    if (usage === undefined) continue
    const input = numberField(usage, 'input')
    const output = numberField(usage, 'output')
    if (input === undefined || output === undefined) continue
    const model = stringField(message, 'model') ?? fallbackModel
    const cost = asRecord(usage['cost'])
    const costUsd = cost === undefined ? undefined : numberField(cost, 'total')
    const bucket = byModel[model] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: undefined }
    bucket.input += input
    bucket.output += output
    bucket.cacheRead += numberField(usage, 'cacheRead') ?? 0
    bucket.cacheWrite += numberField(usage, 'cacheWrite') ?? 0
    if (costUsd !== undefined) bucket.costUsd = (bucket.costUsd ?? 0) + costUsd
    byModel[model] = bucket
  }
  const models = Object.entries(byModel)
  if (models.length === 0) return numTurns ? { numTurns } : {}

  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  let costUsd: number | undefined
  const perModel: Record<string, ModelTokenUsage> = {}
  for (const [model, bucket] of models) {
    total.input += bucket.input
    total.output += bucket.output
    total.cacheRead += bucket.cacheRead
    total.cacheWrite += bucket.cacheWrite
    if (bucket.costUsd !== undefined) costUsd = (costUsd ?? 0) + bucket.costUsd
    perModel[model] = {
      input: bucket.input, output: bucket.output, cacheRead: bucket.cacheRead, cacheWrite: bucket.cacheWrite,
      ...(bucket.costUsd === undefined ? {} : { costUsd: bucket.costUsd }),
    }
  }
  return {
    numTurns,
    usage: total,
    byModel: perModel,
    ...(costUsd === undefined ? {} : { costUsd }),
  }
}

interface UsageBucket { input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number | undefined }

function addToolUsage(message: JsonRecord, buckets: Record<string, UsageBucket>): void {
  const usage = asRecord(message['usage'])
  if (!usage) return
  const remainder: UsageBucket = {
    input: numberField(usage, 'input') ?? 0, output: numberField(usage, 'output') ?? 0,
    cacheRead: numberField(usage, 'cacheRead') ?? 0, cacheWrite: numberField(usage, 'cacheWrite') ?? 0,
    costUsd: numberField(asRecord(usage['cost']) ?? {}, 'total'),
  }
  const invocations = piToolResultMetadata(message).modelCalls ?? []
  for (const call of invocations) {
    if (!call.usage) continue
    const key = `${call.provider}/${call.model}`
    const bucket = buckets[key] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: undefined }
    for (const field of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
      // The outer tool result is the total; invocation records only attribute that total.
      const attributed = Math.min(remainder[field], call.usage[field] ?? 0)
      bucket[field] += attributed
      remainder[field] = Math.max(0, remainder[field] - attributed)
    }
    if (call.costUsd !== undefined) {
      const attributedCost = Math.min(remainder.costUsd ?? call.costUsd, call.costUsd)
      bucket.costUsd = (bucket.costUsd ?? 0) + attributedCost
      if (remainder.costUsd !== undefined) remainder.costUsd = Math.max(0, remainder.costUsd - attributedCost)
    }
    buckets[key] = bucket
  }
  if (remainder.input || remainder.output || remainder.cacheRead || remainder.cacheWrite || (remainder.costUsd ?? 0) > 0 || !invocations.length) {
    const bucket = buckets['Tools/summaries'] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: undefined }
    for (const field of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) bucket[field] += remainder[field]
    if (remainder.costUsd !== undefined) bucket.costUsd = (bucket.costUsd ?? 0) + remainder.costUsd
    buckets['Tools/summaries'] = bucket
  }
}

// Pi only exposes a free-text errorMessage, so the code is a best-effort read
// of it; the full text still travels in run.failed.message.
function classifyPiFailure(message: string): RunFailureCode {
  if (/\b(401|403)\b|unauthori[sz]ed|forbidden|invalid (api )?key|authentication/i.test(message)) return 'auth_error'
  if (/\b(4\d\d|5\d\d)\b|rate limit|overloaded|timed? ?out|ECONNRESET|ENOTFOUND|fetch failed/i.test(message)) return 'api_error'
  return 'provider_error'
}
