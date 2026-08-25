import type {
  AgentEvent,
  BlockKind,
  ContentBlock,
  TokenUsage,
} from '../../core/event/agent-event.js'
import {
  asRecord,
  isRecord,
  numberField,
  stringField,
  type JsonRecord,
} from '../../core/event/json-record.js'

import { patchFromToolDetails } from '../../core/event/tool-patch.js'

export interface PiSessionEvent {
  readonly type: string
  readonly assistantMessageEvent?: unknown
  readonly message?: unknown
  readonly messages?: unknown
  readonly toolCallId?: string
  readonly toolName?: string
  readonly args?: unknown
  readonly partialResult?: unknown
  readonly result?: unknown
  readonly isError?: boolean
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
  private readonly startedAt: number
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

  constructor(private readonly options: PiEventMapperOptions) {
    this.startedAt = options.startedAt ?? Date.now()
    this.model = options.model
  }

  push(event: PiSessionEvent): AgentEvent[] {
    switch (event.type) {
      case 'message_update':
        return this.mapMessageUpdate(event)
      case 'message_end':
        return this.mapMessageEnd(event.message)
      case 'tool_execution_start':
        return this.mapToolExecutionStart(event)
      case 'tool_execution_update':
        return this.mapToolExecutionUpdate(event)
      case 'tool_execution_end':
        return this.mapToolExecutionEnd(event)
      case 'agent_end':
        return [this.mapAgentEnd(event.messages)]
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
    const messageId = this.lastMessageId ?? this.ensureMessageId()
    const index = this.indexByToolId.get(id)
    const events: AgentEvent[] = []
    if (!this.started.has(id)) {
      this.started.add(id)
      events.push(
        event.args === undefined
          ? { type: 'tool.started', messageId, blockId: id, ...(index === undefined ? {} : { index }), id, name }
          : {
              type: 'tool.started',
              messageId,
              blockId: id,
              ...(index === undefined ? {} : { index }),
              id,
              name,
              input: event.args,
            },
      )
    }
    events.push({
      type: 'tool.running',
      id,
      ...(this.lastMessageId === undefined ? {} : { messageId: this.lastMessageId }),
      blockId: id,
      ...(index === undefined ? {} : { index }),
    })
    return events
  }

  private mapToolExecutionUpdate(event: PiSessionEvent): AgentEvent[] {
    const id = event.toolCallId
    if (id === undefined) return []
    const chunk = toolOutput(event.partialResult)
    if (chunk === '') return []
    const index = this.indexByToolId.get(id)
    return [
      {
        type: 'tool.progress',
        id,
        channel: 'stdout',
        chunk,
        ...(this.lastMessageId === undefined ? {} : { messageId: this.lastMessageId }),
        blockId: id,
        ...(index === undefined ? {} : { index }),
      },
    ]
  }

  private mapToolExecutionEnd(event: PiSessionEvent): AgentEvent[] {
    const id = event.toolCallId
    if (id === undefined) return []
    const name = normalizeToolName(event.toolName ?? this.tools.get(id) ?? 'unknown')
    const index = this.indexByToolId.get(id)
    return [
      {
        type: 'tool.completed',
        id,
        name,
        ok: event.isError !== true,
        output: toolOutput(event.result),
        ...(this.lastMessageId === undefined ? {} : { messageId: this.lastMessageId }),
        blockId: id,
        ...(index === undefined ? {} : { index }),
      },
    ]
  }

  private mapAgentEnd(messages: unknown): AgentEvent {
    const usage = usageFromMessages(messages)
    const durationMs = Math.max(0, Date.now() - this.startedAt)
    const model = this.model === '' ? this.options.model : this.model
    const sessionId = this.options.sessionId === '' ? undefined : this.options.sessionId
    const failure = assistantFailure(messages)
    if (failure !== undefined) {
      if (failure.aborted) {
        return {
          type: 'run.aborted',
          ...(sessionId === undefined ? {} : { sessionId }),
          model,
          message: failure.message,
        }
      }
      return {
        type: 'run.failed',
        message: failure.message,
        ...(sessionId === undefined ? {} : { sessionId }),
        model,
        durationMs,
        ...(usage?.costUsd === undefined ? {} : { costUsd: usage.costUsd }),
        ...(usage === undefined ? {} : { usage: usage.tokens }),
      }
    }
    return {
      type: 'run.completed',
      ...(sessionId === undefined ? {} : { sessionId }),
      model,
      durationMs,
      ...(usage?.costUsd === undefined ? {} : { costUsd: usage.costUsd }),
      ...(usage === undefined ? {} : { usage: usage.tokens }),
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
  return name.toLowerCase()
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

function usageFromMessages(
  messages: unknown,
): { tokens: TokenUsage; costUsd?: number } | undefined {
  if (!Array.isArray(messages)) return undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = asRecord(messages[index])
    if (message === undefined) continue
    const usage = asRecord(message['usage'])
    if (usage === undefined) continue
    const input = numberField(usage, 'input')
    const output = numberField(usage, 'output')
    if (input === undefined || output === undefined) continue
    const cacheRead = numberField(usage, 'cacheRead')
    const cacheWrite = numberField(usage, 'cacheWrite')
    const cost = asRecord(usage['cost'])
    const costUsd = cost === undefined ? undefined : numberField(cost, 'total')
    return {
      tokens: {
        input,
        output,
        ...(cacheRead === undefined ? {} : { cacheRead }),
        ...(cacheWrite === undefined ? {} : { cacheWrite }),
      },
      ...(costUsd === undefined ? {} : { costUsd }),
    }
  }
  return undefined
}
