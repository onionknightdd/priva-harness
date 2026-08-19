import type { AgentEvent, TokenUsage } from '../../core/event/agent-event.js'

export interface ClaudeSdkMessage {
  readonly type: string
  readonly subtype?: string
  readonly session_id?: string
  readonly event?: unknown
  readonly message?: unknown
  readonly duration_ms?: number
  readonly total_cost_usd?: number
  readonly usage?: unknown
  readonly is_error?: boolean
  readonly result?: string
  readonly errors?: readonly string[]
}

interface PendingTool {
  readonly id: string
  readonly name: string
}

export class ClaudeEventMapper {
  private sessionId: string | undefined
  private model: string | undefined
  private readonly pendingByIndex = new Map<number, PendingTool>()
  private readonly tools = new Map<string, string>()
  private readonly started = new Set<string>()

  push(message: ClaudeSdkMessage): AgentEvent[] {
    this.rememberSession(message)

    switch (message.type) {
      case 'stream_event':
        return this.mapStreamEvent(message.event)
      case 'assistant':
        return this.mapAssistant(message.message)
      case 'user':
        return this.mapUser(message.message)
      case 'system':
        this.rememberModel(message)
        return []
      case 'result':
        return [this.mapResult(message)]
      default:
        return []
    }
  }

  private mapStreamEvent(raw: unknown): AgentEvent[] {
    if (!isRecord(raw)) return []
    const type = stringField(raw, 'type')
    if (type === 'content_block_start') {
      return this.mapContentBlockStart(raw)
    }
    if (type === 'content_block_delta') {
      return this.mapContentBlockDelta(raw)
    }
    return []
  }

  private mapContentBlockStart(raw: JsonRecord): AgentEvent[] {
    const block = asRecord(raw['content_block'])
    if (block === undefined) return []
    if (stringField(block, 'type') !== 'tool_use') return []
    const id = stringField(block, 'id')
    if (id === undefined) return []
    const name = normalizeToolName(stringField(block, 'name') ?? 'unknown')
    const index = numberField(raw, 'index')
    if (index !== undefined) this.pendingByIndex.set(index, { id, name })
    this.tools.set(id, name)
    if (this.started.has(id)) return []
    this.started.add(id)
    const input = block['input']
    return input === undefined
      ? [{ type: 'tool', event: 'started', id, name }]
      : [{ type: 'tool', event: 'started', id, name, input }]
  }

  private mapContentBlockDelta(raw: JsonRecord): AgentEvent[] {
    const delta = asRecord(raw['delta'])
    if (delta === undefined) return []
    const deltaType = stringField(delta, 'type')
    if (deltaType === 'text_delta') {
      const text = stringField(delta, 'text')
      return text === undefined || text === ''
        ? []
        : [{ type: 'assistant', event: 'text_delta', text }]
    }
    if (deltaType === 'thinking_delta') {
      const text = stringField(delta, 'thinking')
      return text === undefined || text === ''
        ? []
        : [{ type: 'assistant', event: 'thinking_delta', text }]
    }
    if (deltaType === 'input_json_delta') {
      const chunk = stringField(delta, 'partial_json')
      if (chunk === undefined || chunk === '') return []
      const index = numberField(raw, 'index')
      const pending = index === undefined ? undefined : this.pendingByIndex.get(index)
      if (pending === undefined) return []
      return [{ type: 'tool', event: 'input_delta', id: pending.id, chunk }]
    }
    return []
  }

  private mapAssistant(raw: unknown): AgentEvent[] {
    const message = asRecord(raw)
    if (message === undefined) return []
    const model = stringField(message, 'model')
    if (model !== undefined) this.model = model

    const events: AgentEvent[] = []
    const textParts: string[] = []
    for (const block of contentBlocks(message['content'])) {
      const type = stringField(block, 'type')
      if (type === 'text') {
        const text = stringField(block, 'text')
        if (text !== undefined && text !== '') textParts.push(text)
        continue
      }
      if (type !== 'tool_use') continue
      const id = stringField(block, 'id')
      if (id === undefined) continue
      const name = normalizeToolName(stringField(block, 'name') ?? this.tools.get(id) ?? 'unknown')
      this.tools.set(id, name)
      if (!this.started.has(id)) {
        this.started.add(id)
        const input = block['input']
        events.push(input === undefined
          ? { type: 'tool', event: 'started', id, name }
          : { type: 'tool', event: 'started', id, name, input })
      }
    }
    const text = textParts.join('')
    if (text !== '') events.push({ type: 'assistant', event: 'message', text })
    return events
  }

  private mapUser(raw: unknown): AgentEvent[] {
    const message = asRecord(raw)
    if (message === undefined) return []
    const events: AgentEvent[] = []
    for (const block of contentBlocks(message['content'])) {
      if (stringField(block, 'type') !== 'tool_result') continue
      const id = stringField(block, 'tool_use_id') ?? stringField(block, 'id')
      if (id === undefined) continue
      const name = this.tools.get(id) ?? 'unknown'
      const ok = block['is_error'] !== true
      events.push({
        type: 'tool',
        event: 'completed',
        id,
        name,
        ok,
        output: toolOutput(block['content']),
      })
    }
    return events
  }

  private mapResult(message: ClaudeSdkMessage): AgentEvent {
    const sessionId = message.session_id ?? this.sessionId
    const model = this.model ?? 'unknown'
    const durationMs = message.duration_ms ?? 0
    const usage = mapUsage(message.usage)
    const costUsd = message.total_cost_usd
    const failed = message.is_error === true || (message.subtype !== undefined && message.subtype !== 'success')
    if (failed) {
      return {
        type: 'run',
        event: 'failed',
        message: failureMessage(message),
        harnessProvider: 'claude',
        ...(sessionId === undefined ? {} : { sessionId }),
        model,
        durationMs,
        ...(costUsd === undefined ? {} : { costUsd }),
        ...(usage === undefined ? {} : { usage }),
      }
    }
    return {
      type: 'run',
      event: 'completed',
      sessionId: sessionId ?? '',
      harnessProvider: 'claude',
      model,
      durationMs,
      ...(costUsd === undefined ? {} : { costUsd }),
      ...(usage === undefined ? {} : { usage }),
    }
  }

  private rememberSession(message: ClaudeSdkMessage): void {
    if (message.session_id !== undefined && message.session_id !== '') {
      this.sessionId = message.session_id
    }
  }

  private rememberModel(message: ClaudeSdkMessage): void {
    const record = message as unknown as JsonRecord
    const model = stringField(record, 'model')
    if (model !== undefined) this.model = model
    const nested = asRecord(record['data']) ?? asRecord(record['message'])
    const nestedModel = nested === undefined ? undefined : stringField(nested, 'model')
    if (nestedModel !== undefined) this.model = nestedModel
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

function contentBlocks(value: unknown): JsonRecord[] {
  if (typeof value === 'string') {
    return value === '' ? [] : [{ type: 'text', text: value }]
  }
  if (!Array.isArray(value)) return []
  return value.filter(isRecord)
}

function normalizeToolName(name: string): string {
  return name.toLowerCase()
}

function toolOutput(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(isRecord)
      .map((block) => stringField(block, 'text') ?? '')
      .join('')
  }
  if (content === undefined || content === null) return ''
  return JSON.stringify(content)
}

function mapUsage(usage: unknown): TokenUsage | undefined {
  const record = asRecord(usage)
  if (record === undefined) return undefined
  const input = numberField(record, 'input_tokens') ?? numberField(record, 'input')
  const output = numberField(record, 'output_tokens') ?? numberField(record, 'output')
  if (input === undefined || output === undefined) return undefined
  const cacheRead = numberField(record, 'cache_read_input_tokens') ?? numberField(record, 'cacheRead')
  const cacheWrite = numberField(record, 'cache_creation_input_tokens') ?? numberField(record, 'cacheWrite')
  return {
    input,
    output,
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWrite }),
  }
}

function failureMessage(message: ClaudeSdkMessage): string {
  if (message.errors !== undefined && message.errors.length > 0) {
    return message.errors.join('; ')
  }
  if (message.result !== undefined && message.result !== '') return message.result
  return message.subtype ?? 'run failed'
}
