import type {
  AgentEvent,
  BlockKind,
  ContentBlock,
  EventChannel,
  TokenUsage,
} from '../../core/event/agent-event.js'
import {
  asRecord,
  isRecord,
  numberField,
  stringField,
  type JsonRecord,
} from '../../core/event/json-record.js'
import { isAgentName, isTerminalStatus, isWorkflowName } from '../../core/event/tool-names.js'

export interface ClaudeSdkMessage {
  readonly type: string
  readonly subtype?: string
  readonly session_id?: string
  readonly parent_tool_use_id?: string | null
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
  private messageSeq = 0
  private currentMessageId: string | undefined
  private readonly pendingByIndex = new Map<number, PendingTool>()
  private readonly indexByToolId = new Map<string, number>()
  private readonly tools = new Map<string, string>()
  private readonly started = new Set<string>()
  private readonly startedBlocks = new Set<string>()
  private readonly blocksByMessage = new Map<string, Map<number, ContentBlock>>()
  private readonly agentIdByParent = new Map<string, string>()

  push(message: ClaudeSdkMessage): AgentEvent[] {
    this.rememberSession(message)
    const channel = this.channelOf(message)
    switch (message.type) {
      case 'stream_event':
        return this.mapStreamEvent(message.event, channel)
      case 'assistant':
        return this.mapAssistant(message.message, channel)
      case 'user':
        return this.mapUser(message.message, channel)
      case 'system':
        this.rememberModel(message)
        return this.mapSystem(message)
      case 'result':
        return [this.mapResult(message)]
      default:
        return []
    }
  }

  private mapStreamEvent(raw: unknown, channel: EventChannel): AgentEvent[] {
    const event = asRecord(raw)
    if (event === undefined) return []
    const type = stringField(event, 'type')
    if (type === 'message_start') {
      const nested = asRecord(event['message'])
      const id = nested === undefined ? undefined : stringField(nested, 'id')
      this.currentMessageId = id ?? this.ensureMessageId()
      const model = nested === undefined ? undefined : stringField(nested, 'model')
      if (model !== undefined) this.model = model
      return []
    }
    if (type === 'content_block_start') return this.mapContentBlockStart(event, channel)
    if (type === 'content_block_delta') return this.mapContentBlockDelta(event, channel)
    return []
  }

  private mapContentBlockStart(raw: JsonRecord, channel: EventChannel): AgentEvent[] {
    const block = asRecord(raw['content_block'])
    if (block === undefined) return []
    const index = numberField(raw, 'index') ?? 0
    const blockType = stringField(block, 'type') ?? 'unknown'
    const messageId = this.ensureMessageId()
    const kind = kindFromBlockType(blockType)

    if (blockType === 'tool_use') {
      const id = stringField(block, 'id')
      if (id === undefined) return []
      const name = normalizeToolName(stringField(block, 'name') ?? 'unknown')
      this.pendingByIndex.set(index, { id, name })
      this.indexByToolId.set(id, index)
      this.tools.set(id, name)
      const events = this.emitBlockStart(messageId, id, index, 'tool_use', channel)
      if (this.started.has(id)) return events
      this.started.add(id)
      events.push(this.toolStarted(messageId, id, index, name, block['input'], channel))
      const workflowName = workflowNameFrom(block['input'])
      if (isWorkflowName(name)) {
        events.push({
          type: 'workflow.started',
          workflowToolUseId: id,
          ...(workflowName === undefined ? {} : { name: workflowName }),
        })
      }
      return events
    }

    const blockId = stringField(block, 'id') ?? `${messageId}:${index}`
    const events = this.emitBlockStart(messageId, blockId, index, kind, channel)
    if (kind === 'image') {
      const image = imageFrom(block)
      events.push(
        withChannel(
          { type: 'assistant.image_delta', messageId, blockId, index, ...image, final: true },
          channel,
        ),
      )
    }
    return events
  }

  private mapContentBlockDelta(raw: JsonRecord, channel: EventChannel): AgentEvent[] {
    const delta = asRecord(raw['delta'])
    if (delta === undefined) return []
    const index = numberField(raw, 'index') ?? 0
    const messageId = this.ensureMessageId()
    const deltaType = stringField(delta, 'type')

    if (deltaType === 'text_delta') {
      const text = stringField(delta, 'text')
      if (text === undefined || text === '') return []
      const blockId = `${messageId}:${index}`
      return [
        ...this.emitBlockStart(messageId, blockId, index, 'text', channel),
        withChannel({ type: 'assistant.delta', messageId, blockId, index, text }, channel),
      ]
    }
    if (deltaType === 'thinking_delta') {
      const text = stringField(delta, 'thinking') ?? stringField(delta, 'text')
      if (text === undefined || text === '') return []
      const blockId = `${messageId}:${index}`
      return [
        ...this.emitBlockStart(messageId, blockId, index, 'thinking', channel),
        withChannel({ type: 'assistant.thinking_delta', messageId, blockId, index, text }, channel),
      ]
    }
    if (deltaType === 'input_json_delta') {
      const chunk = stringField(delta, 'partial_json')
      if (chunk === undefined || chunk === '') return []
      const pending = this.pendingByIndex.get(index)
      if (pending === undefined) return []
      return [
        withChannel(
          {
            type: 'tool.input_delta',
            messageId,
            blockId: pending.id,
            index,
            id: pending.id,
            chunk,
          },
          channel,
        ),
      ]
    }
    if (deltaType === 'image_delta' || deltaType === 'partial_image') {
      const image = imageFrom(delta)
      if (image.url === undefined && image.b64 === undefined) return []
      const blockId = `${messageId}:${index}`
      return [
        ...this.emitBlockStart(messageId, blockId, index, 'image', channel),
        withChannel({ type: 'assistant.image_delta', messageId, blockId, index, ...image }, channel),
      ]
    }
    return []
  }

  private mapAssistant(raw: unknown, channel: EventChannel): AgentEvent[] {
    const message = asRecord(raw)
    if (message === undefined) return []
    const model = stringField(message, 'model')
    if (model !== undefined) this.model = model
    const messageId = this.ensureMessageId(stringField(message, 'id'))
    const events: AgentEvent[] = []
    const incoming: ContentBlock[] = []

    for (const [offset, block] of contentBlocks(message['content']).entries()) {
      const type = stringField(block, 'type')
      const index = numberField(block, 'index') ?? offset
      if (type === 'text') {
        incoming.push({
          type: 'text',
          blockId: `${messageId}:${index}`,
          index,
          text: stringField(block, 'text') ?? '',
        })
        continue
      }
      if (type === 'thinking') {
        incoming.push({
          type: 'thinking',
          blockId: `${messageId}:${index}`,
          index,
          text: stringField(block, 'thinking') ?? stringField(block, 'text') ?? '',
        })
        continue
      }
      if (type === 'image' || type === 'image_url' || type === 'output_image') {
        incoming.push({
          type: 'image',
          blockId: `${messageId}:${index}`,
          index,
          ...imageFrom(block),
        })
        continue
      }
      if (type !== 'tool_use') {
        incoming.push({
          type: 'unknown',
          blockId: `${messageId}:${index}`,
          index,
          kind: type ?? 'unknown',
          data: block,
        })
        continue
      }
      const id = stringField(block, 'id')
      if (id === undefined) continue
      const name = normalizeToolName(stringField(block, 'name') ?? this.tools.get(id) ?? 'unknown')
      this.tools.set(id, name)
      const toolIndex =
        this.indexByToolId.get(id) ??
        nextFreeToolIndex(this.blocksByMessage.get(messageId), index, id)
      this.indexByToolId.set(id, toolIndex)
      incoming.push({
        type: 'tool_use',
        blockId: id,
        index: toolIndex,
        id,
        name,
        ...(block['input'] === undefined ? {} : { input: block['input'] }),
      })
      if (!this.started.has(id)) {
        this.started.add(id)
        events.push(...this.emitBlockStart(messageId, id, toolIndex, 'tool_use', channel))
        events.push(this.toolStarted(messageId, id, toolIndex, name, block['input'], channel))
        const workflowName = workflowNameFrom(block['input'])
        if (isWorkflowName(name)) {
          events.push({
            type: 'workflow.started',
            workflowToolUseId: id,
            ...(workflowName === undefined ? {} : { name: workflowName }),
          })
        }
      } else if (block['input'] !== undefined) {
        events.push(
          withChannel(
            {
              type: 'tool.updated',
              messageId,
              blockId: id,
              index: toolIndex,
              id,
              name,
              input: block['input'],
            },
            channel,
          ),
        )
      }
    }

    events.push(
      withChannel(
        { type: 'assistant.message', messageId, blocks: this.mergeBlocks(messageId, incoming) },
        channel,
      ),
    )
    return events
  }

  private mapUser(raw: unknown, channel: EventChannel): AgentEvent[] {
    const message = asRecord(raw)
    if (message === undefined) return []
    const blocks = contentBlocks(message['content'])
    const hasToolResult = blocks.some((block) => stringField(block, 'type') === 'tool_result')
    if (channel.parentToolUseId !== undefined && !hasToolResult) {
      return this.deliveryEvents(blocks, channel)
    }

    const events: AgentEvent[] = []
    for (const block of blocks) {
      if (stringField(block, 'type') !== 'tool_result') continue
      const id = stringField(block, 'tool_use_id') ?? stringField(block, 'id')
      if (id === undefined) continue
      const name = this.tools.get(id) ?? 'unknown'
      const output = toolOutput(block['content'])
      const launch = parseAgentLaunch(block, output)
      if (launch?.agentId !== undefined) {
        this.agentIdByParent.set(id, launch.agentId)
      }
      const messageId = this.ensureMessageId()
      const index = this.indexByToolId.get(id)
      events.push(
        withChannel(
          {
            type: 'tool.completed',
            messageId,
            blockId: id,
            ...(index === undefined ? {} : { index }),
            id,
            name,
            ok: block['is_error'] !== true,
            output,
            ...(launch?.status === undefined ? {} : { status: launch.status }),
            ...(launch?.agentId === undefined ? {} : { agentId: launch.agentId }),
          },
          {
            ...channel,
            ...(launch?.agentId === undefined ? {} : { agentId: launch.agentId }),
          },
        ),
      )
      if (isWorkflowName(name) && block['is_error'] === true) {
        events.push({ type: 'workflow.completed', workflowToolUseId: id, status: 'failed' })
      }
      if (channel.parentToolUseId !== undefined) {
        events.push(...this.deliveryEvents(contentBlocks(block['content']), channel))
      }
    }
    return events
  }

  private mapSystem(message: ClaudeSdkMessage): AgentEvent[] {
    const record = message as unknown as JsonRecord
    const subtype = message.subtype ?? stringField(record, 'subtype')
    if (
      subtype === 'init' ||
      subtype === 'status' ||
      subtype === 'thinking_tokens' ||
      subtype === undefined
    ) {
      return []
    }
    const data = flattenTaskPayload(record)
    const taskType = (stringField(data, 'subtype') ?? subtype).toLowerCase()
    const taskId = stringField(data, 'task_id') ?? stringField(data, 'taskId') ?? ''
    const workflowToolUseId =
      stringField(data, 'tool_use_id') ?? stringField(data, 'workflow_tool_use_id')
    const status = stringField(data, 'status') ?? stringField(data, 'state') ?? ''

    if (isWorkflowTask(data, taskType)) {
      if (taskType.includes('started')) {
        const name = stringField(data, 'workflow_name')
        return [
          {
            type: 'workflow.started',
            workflowToolUseId: workflowToolUseId ?? taskId,
            ...(name === undefined ? {} : { name }),
          },
        ]
      }
      if (taskType.includes('progress')) {
        return [
          {
            type: 'workflow.progress',
            workflowToolUseId: workflowToolUseId ?? taskId,
            ...(taskId === '' ? {} : { taskId }),
            ...(data['phases'] === undefined ? {} : { phases: data['phases'] }),
            ...(data['agents'] === undefined ? {} : { agents: data['agents'] }),
            ...(data['workflow_progress'] === undefined
              ? {}
              : { workflowProgress: data['workflow_progress'] }),
          },
        ]
      }
      if (taskType.includes('updated')) {
        return [{ type: 'workflow.updated', taskId: taskId || 'unknown', patch: data['patch'] ?? data }]
      }
      if (taskType.includes('notification')) {
        const summary = stringField(data, 'summary')
        const events: AgentEvent[] = [
          {
            type: 'workflow.notification',
            taskId: taskId || 'unknown',
            ...(workflowToolUseId === undefined ? {} : { workflowToolUseId }),
            status: status || 'unknown',
            ...(summary === undefined ? {} : { summary }),
          },
        ]
        if (isTerminalStatus(status) && workflowToolUseId !== undefined) {
          events.push({ type: 'workflow.completed', workflowToolUseId, status })
        }
        return events
      }
      return []
    }

    if (isAgentTask(data, taskType)) {
      const agentId =
        stringField(data, 'agent_id') ??
        stringField(data, 'agentId') ??
        (workflowToolUseId === undefined ? undefined : this.agentIdByParent.get(workflowToolUseId)) ??
        (taskId === '' ? undefined : taskId)
      if (agentId === undefined) return []
      if (taskType.includes('started')) {
        const name = stringField(data, 'subagent_type')
        return [{ type: 'agent.started', agentId, ...(name === undefined ? {} : { name }) }]
      }
      if (isTerminalStatus(status)) {
        return [
          {
            type: 'agent.completed',
            agentId,
            ok: status !== 'failed' && status !== 'error' && status !== 'killed',
          },
        ]
      }
    }
    return []
  }

  private mapResult(message: ClaudeSdkMessage): AgentEvent {
    const sessionId = omitEmpty(message.session_id ?? this.sessionId)
    const model = this.model ?? 'unknown'
    const durationMs = message.duration_ms ?? 0
    const usage = mapUsage(message.usage)
    const costUsd = message.total_cost_usd
    if (isAbortResult(message)) {
      return {
        type: 'run.aborted',
        ...(sessionId === undefined ? {} : { sessionId }),
        model,
        ...(message.result ? { message: message.result } : {}),
      }
    }
    const failed =
      message.is_error === true ||
      (message.subtype !== undefined && message.subtype !== 'success')
    if (failed) {
      return {
        type: 'run.failed',
        message: failureMessage(message),
        ...(sessionId === undefined ? {} : { sessionId }),
        model,
        durationMs,
        ...(costUsd === undefined ? {} : { costUsd }),
        ...(usage === undefined ? {} : { usage }),
      }
    }
    return {
      type: 'run.completed',
      ...(sessionId === undefined ? {} : { sessionId }),
      model,
      durationMs,
      ...(costUsd === undefined ? {} : { costUsd }),
      ...(usage === undefined ? {} : { usage }),
    }
  }

  private deliveryEvents(blocks: JsonRecord[], channel: EventChannel): AgentEvent[] {
    if (channel.parentToolUseId === undefined) return []
    const delivery = parseDelivery(blocks)
    if (delivery === undefined) return []
    return [
      withChannel(
        {
          type: 'agent.message',
          parentToolUseId: channel.parentToolUseId,
          direction: 'received',
          body: delivery.body,
          source: delivery.source,
          ...(delivery.senderName === undefined ? {} : { senderName: delivery.senderName }),
          ...(delivery.senderAgentId === undefined ? {} : { senderAgentId: delivery.senderAgentId }),
        },
        channel,
      ),
    ]
  }

  private toolStarted(
    messageId: string,
    id: string,
    index: number,
    name: string,
    input: unknown,
    channel: EventChannel,
  ): AgentEvent {
    return withChannel(
      input === undefined
        ? { type: 'tool.started', messageId, blockId: id, index, id, name }
        : { type: 'tool.started', messageId, blockId: id, index, id, name, input },
      channel,
    )
  }

  private emitBlockStart(
    messageId: string,
    blockId: string,
    index: number,
    kind: BlockKind,
    channel: EventChannel,
  ): AgentEvent[] {
    const key = `${messageId}:${index}:${kind}`
    if (this.startedBlocks.has(key)) return []
    this.startedBlocks.add(key)
    return [
      withChannel(
        { type: 'assistant.block_start', messageId, blockId, index, kind },
        channel,
      ),
    ]
  }

  private mergeBlocks(messageId: string, incoming: ContentBlock[]): ContentBlock[] {
    const existing = this.blocksByMessage.get(messageId) ?? new Map<number, ContentBlock>()
    let nextIndex = maxIndex(existing) + 1
    for (const block of incoming) {
      const toolIndex = block.type === 'tool_use' ? findToolIndex(existing, block.id) : undefined
      let index = toolIndex ?? block.index
      const occupant = existing.get(index)
      if (occupant !== undefined && !sameMergeSlot(occupant, block)) {
        index = nextIndex
        nextIndex += 1
      }
      existing.set(index, withMergedAddress(messageId, block, index))
      if (index >= nextIndex) nextIndex = index + 1
    }
    this.blocksByMessage.set(messageId, existing)
    return [...existing.values()].sort((left, right) => left.index - right.index)
  }

  private ensureMessageId(preferred?: string): string {
    if (preferred !== undefined && preferred !== '') {
      this.currentMessageId = preferred
      return preferred
    }
    if (this.currentMessageId !== undefined) return this.currentMessageId
    this.currentMessageId = `msg_${(this.messageSeq += 1)}`
    return this.currentMessageId
  }

  private channelOf(message: ClaudeSdkMessage): EventChannel {
    const parent =
      typeof message.parent_tool_use_id === 'string' && message.parent_tool_use_id !== ''
        ? message.parent_tool_use_id
        : undefined
    if (parent === undefined) return {}
    const agentId = this.agentIdByParent.get(parent)
    return {
      parentToolUseId: parent,
      ...(agentId === undefined ? {} : { agentId }),
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

function withChannel<T extends AgentEvent>(event: T, channel: EventChannel): T {
  return {
    ...event,
    ...(channel.parentToolUseId === undefined ? {} : { parentToolUseId: channel.parentToolUseId }),
    ...(channel.agentId === undefined ? {} : { agentId: channel.agentId }),
  }
}

function contentBlocks(value: unknown): JsonRecord[] {
  if (typeof value === 'string') return value === '' ? [] : [{ type: 'text', text: value }]
  if (!Array.isArray(value)) return []
  return value.filter(isRecord)
}

function normalizeToolName(name: string): string {
  return name.toLowerCase()
}

function kindFromBlockType(type: string): BlockKind {
  if (type === 'text') return 'text'
  if (type === 'thinking') return 'thinking'
  if (type === 'tool_use') return 'tool_use'
  if (type === 'image' || type === 'image_url' || type === 'output_image') return 'image'
  return 'unknown'
}

function toolOutput(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.filter(isRecord).map((block) => stringField(block, 'text') ?? '').join('')
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
  if (message.errors !== undefined && message.errors.length > 0) return message.errors.join('; ')
  if (message.result !== undefined && message.result !== '') return message.result
  return message.subtype ?? 'run failed'
}

function isAbortResult(message: ClaudeSdkMessage): boolean {
  const subtype = message.subtype?.toLowerCase() ?? ''
  return subtype === 'interrupt' || subtype === 'aborted' || subtype === 'cancelled' || subtype === 'canceled'
}

function workflowNameFrom(input: unknown): string | undefined {
  const record = asRecord(input)
  if (record === undefined) return undefined
  return stringField(record, 'name') ?? stringField(record, 'workflow_name')
}

function imageFrom(block: JsonRecord): { mime?: string; url?: string; b64?: string; alt?: string } {
  const source = asRecord(block['source']) ?? asRecord(block['image_url']) ?? block
  const url = stringField(source, 'url') ?? stringField(block, 'url')
  const b64 = stringField(source, 'data') ?? stringField(source, 'b64') ?? stringField(block, 'b64')
  const mime = stringField(source, 'media_type') ?? stringField(source, 'mime') ?? stringField(block, 'mime')
  const alt = stringField(block, 'alt')
  return {
    ...(mime === undefined ? {} : { mime }),
    ...(url === undefined ? {} : { url }),
    ...(b64 === undefined ? {} : { b64 }),
    ...(alt === undefined ? {} : { alt }),
  }
}

function parseAgentLaunch(
  block: JsonRecord,
  output: string,
): { agentId?: string; status?: string } | undefined {
  const result = asRecord(block['toolUseResult']) ?? asRecord(block['tool_use_result'])
  let parsed: JsonRecord | undefined
  if (output.startsWith('{')) {
    try {
      parsed = asRecord(JSON.parse(output) as unknown)
    } catch {
      parsed = undefined
    }
  }
  const agentId =
    (result === undefined ? undefined : stringField(result, 'agentId') ?? stringField(result, 'agent_id')) ??
    (parsed === undefined ? undefined : stringField(parsed, 'agentId') ?? stringField(parsed, 'agent_id'))
  const rawStatus =
    (result === undefined ? undefined : stringField(result, 'status')) ??
    (parsed === undefined ? undefined : stringField(parsed, 'status')) ??
    (output.includes('async_launched') || output.includes('async_launched')
      ? 'async_launched'
      : undefined)
  const status = rawStatus === 'async_launched' ? 'async_launched' : rawStatus
  if (agentId === undefined && status === undefined) return undefined
  return {
    ...(agentId === undefined ? {} : { agentId }),
    ...(status === undefined ? {} : { status }),
  }
}

const AGENT_MESSAGE_RE = /<agent-message\b([^>]*)>([\s\S]*?)<\/agent-message>/iu
const AGENT_MESSAGE_FROM_RE = /\bfrom\s*=\s*(?:"([^"]*)"|'([^']*)')/iu
const COORDINATOR_PREFIX = 'The coordinator sent a message while you were working:\n'
const COORDINATOR_SUFFIX = '\n\nAddress this before completing your current task.'

function parseDelivery(
  blocks: JsonRecord[],
): { body: string; source: 'peer' | 'coordinator'; senderName?: string; senderAgentId?: string } | undefined {
  const text = blocks.map((block) => stringField(block, 'text') ?? toolOutput(block['content'])).join('\n')
  if (text.trim() === '') return undefined
  const peer = AGENT_MESSAGE_RE.exec(text)
  if (peer) {
    const body = peer[2]?.trim() ?? ''
    if (body === '') return undefined
    const sender = AGENT_MESSAGE_FROM_RE.exec(peer[1] ?? '')
    const senderName = (sender?.[1] ?? sender?.[2])?.trim()
    return {
      body,
      source: 'peer',
      ...(senderName === undefined || senderName === '' ? {} : { senderName }),
    }
  }
  const prefixAt = text.indexOf(COORDINATOR_PREFIX)
  if (prefixAt < 0) return undefined
  let body = text.slice(prefixAt + COORDINATOR_PREFIX.length)
  const suffixAt = body.lastIndexOf(COORDINATOR_SUFFIX)
  if (suffixAt >= 0) body = body.slice(0, suffixAt)
  body = body.trim()
  if (body === '') return undefined
  return { body, source: 'coordinator', senderName: 'main', senderAgentId: 'main' }
}

function flattenTaskPayload(record: JsonRecord): JsonRecord {
  const data = asRecord(record['data']) ?? {}
  const nested = asRecord(data['data']) ?? {}
  return { ...record, ...data, ...nested }
}

function isWorkflowTask(data: JsonRecord, taskType: string): boolean {
  return (
    stringField(data, 'workflow_name') !== undefined ||
    data['workflow_progress'] !== undefined ||
    stringField(data, 'task_type') === 'workflow' ||
    taskType.includes('workflow')
  )
}

function isAgentTask(data: JsonRecord, taskType: string): boolean {
  return (
    stringField(data, 'subagent_type') !== undefined ||
    isAgentName(stringField(data, 'tool_name') ?? '') ||
    taskType.includes('agent') ||
    taskType.includes('subagent')
  )
}

function omitEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value
}

function maxIndex(blocks: Map<number, ContentBlock>): number {
  let max = -1
  for (const index of blocks.keys()) {
    if (index > max) max = index
  }
  return max
}

function findToolIndex(blocks: Map<number, ContentBlock>, id: string): number | undefined {
  for (const [index, block] of blocks) {
    if (block.type === 'tool_use' && block.id === id) return index
  }
  return undefined
}

function nextFreeToolIndex(
  existing: Map<number, ContentBlock> | undefined,
  requested: number,
  toolId: string,
): number {
  if (existing === undefined) return requested
  const occupant = existing.get(requested)
  if (occupant === undefined) return requested
  if (occupant.type === 'tool_use' && occupant.id === toolId) return requested
  return maxIndex(existing) + 1
}

function sameMergeSlot(occupant: ContentBlock, incoming: ContentBlock): boolean {
  if (occupant.type !== incoming.type) return false
  if (occupant.type === 'tool_use' && incoming.type === 'tool_use') {
    return occupant.id === incoming.id
  }
  return true
}

function withMergedAddress(messageId: string, block: ContentBlock, index: number): ContentBlock {
  if (block.type === 'tool_use') return { ...block, index }
  return { ...block, index, blockId: `${messageId}:${index}` }
}
