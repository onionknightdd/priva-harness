import type { AgentEvent, TokenUsage } from '../../core/event/agent-event.js'

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
  private readonly pendingByIndex = new Map<number, PendingTool>()
  private readonly tools = new Map<string, string>()
  private readonly started = new Set<string>()

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
    const index = numberField(update, 'contentIndex')
    if (type === 'text_delta') {
      const text = stringField(update, 'delta')
      return text === undefined || text === ''
        ? []
        : [{ type: 'assistant', event: 'text_delta', text }]
    }
    if (type === 'thinking_delta') {
      const text = stringField(update, 'delta')
      return text === undefined || text === ''
        ? []
        : [{ type: 'assistant', event: 'thinking_delta', text }]
    }
    if (type === 'toolcall_start') {
      return this.startTool(index, update, event.message)
    }
    if (type === 'toolcall_delta') {
      const events = this.startTool(index, update, event.message)
      const chunk = stringField(update, 'delta')
      const id = this.toolIdAt(index)
      if (id === undefined || chunk === undefined || chunk === '') return events
      events.push({ type: 'tool', event: 'input_delta', id, chunk })
      return events
    }
    if (type === 'toolcall_end') {
      return this.endToolCall(index, update)
    }
    this.rememberModel(asRecord(update['partial']) ?? asRecord(event.message))
    return []
  }

  private startTool(
    index: number | undefined,
    update: JsonRecord,
    message: unknown,
  ): AgentEvent[] {
    const toolCall = toolCallFrom(
      asRecord(update['partial']) ?? asRecord(message),
      index,
    ) ?? asRecord(update['toolCall'])
    const pending = this.pendingAt(index)
    if (toolCall !== undefined) {
      const id = stringField(toolCall, 'id')
      const name = stringField(toolCall, 'name')
      if (id !== undefined) pending.id = id
      if (name !== undefined) pending.name = normalizeToolName(name)
    }
    return this.emitStarted(pending, toolCall?.['arguments'])
  }

  private endToolCall(index: number | undefined, update: JsonRecord): AgentEvent[] {
    const toolCall = asRecord(update['toolCall'])
    const pending = this.pendingAt(index)
    if (toolCall !== undefined) {
      const id = stringField(toolCall, 'id')
      const name = stringField(toolCall, 'name')
      if (id !== undefined) pending.id = id
      if (name !== undefined) pending.name = normalizeToolName(name)
    }
    return this.emitStarted(pending, toolCall?.['arguments'])
  }

  private emitStarted(pending: PendingTool, input: unknown): AgentEvent[] {
    if (pending.id === undefined || pending.started) return []
    const name = pending.name ?? 'unknown'
    pending.started = true
    this.started.add(pending.id)
    this.tools.set(pending.id, name)
    return input === undefined
      ? [{ type: 'tool', event: 'started', id: pending.id, name }]
      : [{ type: 'tool', event: 'started', id: pending.id, name, input }]
  }

  private mapMessageEnd(raw: unknown): AgentEvent[] {
    this.rememberModel(asRecord(raw))
    const message = asRecord(raw)
    // Pi emits message_end for the user prompt (and tool results) before any
    // model tokens. Those must not become assistant.message or the UI echoes
    // the user's text as the reply.
    if (message === undefined || stringField(message, 'role') !== 'assistant') {
      return []
    }
    const text = assistantText(raw)
    return text === '' ? [] : [{ type: 'assistant', event: 'message', text }]
  }

  private mapToolExecutionStart(event: PiSessionEvent): AgentEvent[] {
    const id = event.toolCallId
    if (id === undefined) return []
    const name = normalizeToolName(event.toolName ?? this.tools.get(id) ?? 'unknown')
    this.tools.set(id, name)
    const events: AgentEvent[] = []
    if (!this.started.has(id)) {
      this.started.add(id)
      events.push(event.args === undefined
        ? { type: 'tool', event: 'started', id, name }
        : { type: 'tool', event: 'started', id, name, input: event.args })
    }
    events.push({ type: 'tool', event: 'running', id })
    return events
  }

  private mapToolExecutionUpdate(event: PiSessionEvent): AgentEvent[] {
    const id = event.toolCallId
    if (id === undefined) return []
    const chunk = toolOutput(event.partialResult)
    return chunk === ''
      ? []
      : [{ type: 'tool', event: 'progress', id, channel: 'stdout', chunk }]
  }

  private mapToolExecutionEnd(event: PiSessionEvent): AgentEvent[] {
    const id = event.toolCallId
    if (id === undefined) return []
    const name = normalizeToolName(event.toolName ?? this.tools.get(id) ?? 'unknown')
    return [{
      type: 'tool',
      event: 'completed',
      id,
      name,
      ok: event.isError !== true,
      output: toolOutput(event.result),
    }]
  }

  private mapAgentEnd(messages: unknown): AgentEvent {
    const usage = usageFromMessages(messages)
    const durationMs = Math.max(0, Date.now() - this.startedAt)
    const model = this.model === '' ? this.options.model : this.model
    const failure = assistantFailure(messages)
    if (failure !== undefined) {
      return {
        type: 'run',
        event: 'failed',
        message: failure,
        sessionId: this.options.sessionId,
        harnessProvider: 'bambuddy',
        model,
        durationMs,
        ...(usage?.costUsd === undefined ? {} : { costUsd: usage.costUsd }),
        ...(usage === undefined ? {} : { usage: usage.tokens }),
      }
    }
    return {
      type: 'run',
      event: 'completed',
      sessionId: this.options.sessionId,
      harnessProvider: 'bambuddy',
      model,
      durationMs,
      ...(usage?.costUsd === undefined ? {} : { costUsd: usage.costUsd }),
      ...(usage === undefined ? {} : { usage: usage.tokens }),
    }
  }

  private pendingAt(index: number | undefined): PendingTool {
    const key = index ?? -1
    const existing = this.pendingByIndex.get(key)
    if (existing !== undefined) return existing
    const created: PendingTool = { id: undefined, name: undefined, started: false }
    this.pendingByIndex.set(key, created)
    return created
  }

  private toolIdAt(index: number | undefined): string | undefined {
    return this.pendingByIndex.get(index ?? -1)?.id
  }

  private rememberModel(message: JsonRecord | undefined): void {
    const model = message === undefined ? undefined : stringField(message, 'model')
    if (model !== undefined && model !== '') this.model = model
  }
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined
}

function stringField(record: JsonRecord, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

function numberField(record: JsonRecord, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeToolName(name: string): string {
  return name.toLowerCase()
}

function toolCallFrom(message: JsonRecord | undefined, index: number | undefined): JsonRecord | undefined {
  if (message === undefined || index === undefined) return undefined
  const content = message['content']
  if (!Array.isArray(content)) return undefined
  const block: unknown = content[index]
  return asRecord(block)
}

function assistantText(raw: unknown): string {
  const message = asRecord(raw)
  if (message === undefined) return ''
  const content = message['content']
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(isRecord)
    .filter((block) => stringField(block, 'type') === 'text')
    .map((block) => stringField(block, 'text') ?? '')
    .join('')
}

function toolOutput(value: unknown): string {
  if (typeof value === 'string') return value
  const record = asRecord(value)
  if (record === undefined) {
    if (value === undefined || value === null) return ''
    return JSON.stringify(value)
  }
  const content = record['content']
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const text = content
      .filter(isRecord)
      .map((block) => stringField(block, 'text') ?? '')
      .join('')
    if (text !== '') return text
  }
  const details = record['details']
  if (typeof details === 'string') return details
  const detailRecord = asRecord(details)
  const output = detailRecord === undefined ? undefined : stringField(detailRecord, 'output')
  if (output !== undefined) return output
  return ''
}

function assistantFailure(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = asRecord(messages[index])
    if (message === undefined || stringField(message, 'role') !== 'assistant') continue
    const stopReason = stringField(message, 'stopReason')
    const errorMessage = stringField(message, 'errorMessage')
    if (stopReason !== 'error' && stopReason !== 'aborted') return undefined
    if (errorMessage !== undefined && errorMessage !== '') return errorMessage
    return stopReason === 'aborted' ? 'aborted' : 'run failed'
  }
  return undefined
}

function usageFromMessages(messages: unknown): { tokens: TokenUsage; costUsd?: number } | undefined {
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
