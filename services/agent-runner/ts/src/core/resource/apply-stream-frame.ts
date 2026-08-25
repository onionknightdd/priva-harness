import type { AgentEvent } from '../event/agent-event.js'
import { isAgentName } from '../event/tool-names.js'
import {
  textFromThreadBlocks,
  threadBlocksFromContent,
  type ThreadBlock,
  type ThreadInboxMessage,
  type ThreadMessage,
  type ThreadNestedAgent,
  type ThreadToolCard,
  type ThreadWorkflowCard,
} from './thread.js'

export function applyStreamFrame(message: ThreadMessage, event: AgentEvent): ThreadMessage {
  if (event.type === 'error' || event.type === 'run.failed') {
    const errorText = event.message.trim() === '' ? message.content : event.message.trim()
    return { ...message, content: errorText, status: 'error' }
  }
  if (event.type === 'run.aborted') {
    return { ...message, status: 'complete' }
  }

  if (event.type.startsWith('workflow.')) {
    return {
      ...withWorkflow(message, event),
      content: textFromThreadBlocks(message.blocks ?? []),
    }
  }

  const withUuid =
    event.type === 'assistant.message' && parentToolUseIdOf(event) === undefined
      ? { ...message, transcriptUuid: event.messageId }
      : message

  if (parentToolUseIdOf(event) !== undefined) {
    const nestedAgents = applyNested(withUuid.nestedAgents ?? [], event)
    return {
      ...withUuid,
      nestedAgents,
      content: textFromThreadBlocks(withUuid.blocks ?? []),
    }
  }

  const blocks = applyMainBlocks(withUuid.blocks ?? [], event)
  return {
    ...withUuid,
    blocks,
    nestedAgents: applyNested(withUuid.nestedAgents ?? [], event),
    content: textFromThreadBlocks(blocks),
  }
}

function applyMainBlocks(blocks: readonly ThreadBlock[], event: AgentEvent): ThreadBlock[] {
  switch (event.type) {
    case 'assistant.block_start':
      return upsertBlock(blocks, placeholderBlock(event))
    case 'assistant.delta':
      return appendText(blocks, event.messageId, event.blockId, event.index ?? 0, event.text, 'text')
    case 'assistant.thinking_delta':
      return appendText(
        blocks,
        event.messageId,
        event.blockId,
        event.index ?? 0,
        event.text,
        'thinking',
      )
    case 'assistant.image_delta':
      return upsertBlock(blocks, {
        type: 'image',
        blockId: event.blockId,
        index: event.index ?? 0,
        ...(event.mime === undefined ? {} : { mime: event.mime }),
        ...(event.url === undefined ? {} : { url: event.url }),
        ...(event.b64 === undefined ? {} : { b64: event.b64 }),
      })
    case 'assistant.message':
      return mergeSnapshot(blocks, threadBlocksFromContent(event.blocks))
    case 'tool.input_delta':
      return applyToolInputDelta(blocks, event)
    case 'tool.started':
    case 'tool.updated':
    case 'tool.running':
    case 'tool.progress':
    case 'tool.completed':
      return syncTools(blocks, event)
    default:
      return [...blocks]
  }
}

function applyNested(
  agents: readonly ThreadNestedAgent[],
  event: AgentEvent,
): ThreadNestedAgent[] {
  const parentId = parentToolUseIdOf(event)
  if (parentId === undefined) {
    if (event.type === 'agent.completed') {
      return agents.map((agent) =>
        agent.agentId === event.agentId ? { ...agent, status: 'completed' } : agent,
      )
    }
    return [...agents]
  }

  const existing = agents.find((agent) => agent.parentToolUseId === parentId)
  const agentId = agentIdOf(event)
  const name = nameOf(event)
  const current: ThreadNestedAgent = existing ?? {
    parentToolUseId: parentId,
    status: 'running',
    blocks: [],
    inbox: [],
    ...(agentId === undefined ? {} : { agentId }),
    ...(name === undefined ? {} : { name }),
  }

  let next = current
  if (event.type === 'agent.message' && event.body !== '') {
    const senderName = event.senderName
    const item: ThreadInboxMessage = {
      body: event.body,
      source: event.source === 'coordinator' ? 'coordinator' : 'peer',
      ...(senderName === undefined ? {} : { senderName }),
    }
    next = { ...current, inbox: [...current.inbox, item] }
  } else if (event.type === 'agent.started') {
    const startedName = event.name
    next = {
      ...current,
      status: 'running',
      agentId: event.agentId,
      ...(startedName === undefined ? {} : { name: startedName }),
    }
  } else if (event.type === 'agent.completed') {
    next = { ...current, status: 'completed' }
  } else if (
    event.type === 'tool.completed' &&
    event.status !== 'async_launched' &&
    isAgentName(event.name)
  ) {
    next = { ...current, status: 'completed' }
  } else {
    next = { ...current, blocks: applyMainBlocks(current.blocks, event) }
  }

  if (existing === undefined) return [...agents, next]
  return agents.map((agent) => (agent.parentToolUseId === parentId ? next : agent))
}

function withWorkflow(message: ThreadMessage, event: AgentEvent): ThreadMessage {
  const id = workflowIdOf(event)
  const workflows = [...(message.workflows ?? [])]
  const index = workflows.findIndex((card) => card.workflowToolUseId === id)
  const found = index >= 0 ? workflows[index] : undefined
  const current: ThreadWorkflowCard = found ?? { workflowToolUseId: id, status: 'running' }

  let next = current
  if (event.type === 'workflow.started') {
    const workflowName = event.name
    next = {
      ...current,
      status: 'running',
      ...(workflowName === undefined ? {} : { name: workflowName }),
    }
  } else if (event.type === 'workflow.notification') {
    const summary = event.summary
    next = {
      ...current,
      status: event.status,
      ...(summary === undefined ? {} : { summary }),
    }
  } else if (event.type === 'workflow.completed') {
    next = { ...current, status: event.status }
  }

  if (index >= 0) workflows[index] = next
  else workflows.push(next)
  return { ...message, workflows }
}

function syncTools(blocks: readonly ThreadBlock[], event: AgentEvent): ThreadBlock[] {
  if (
    event.type !== 'tool.started' &&
    event.type !== 'tool.updated' &&
    event.type !== 'tool.running' &&
    event.type !== 'tool.progress' &&
    event.type !== 'tool.completed'
  ) {
    return [...blocks]
  }

  const id = event.id
  const existingIndex = blocks.findIndex((block) => block.type === 'tool_use' && block.id === id)
  const existingBlock = existingIndex >= 0 ? blocks[existingIndex] : undefined
  const input = inputOf(event)
  const base: Extract<ThreadBlock, { type: 'tool_use' }> =
    existingBlock?.type === 'tool_use'
      ? existingBlock
      : {
          type: 'tool_use',
          blockId: blockIdOf(event) ?? id,
          index: indexOf(event) ?? blocks.length,
          id,
          name: nameOf(event) ?? 'unknown',
          ...(input === undefined ? {} : { input }),
        }

  const status: ThreadToolCard['status'] =
    event.type === 'tool.completed'
      ? 'completed'
      : event.type === 'tool.running' || event.type === 'tool.progress'
        ? 'running'
        : 'started'

  const launchStatus = statusOf(event)
  const toolAgentId = agentIdOf(event)
  const nextInput = mergeToolInput(base.tool?.input ?? base.input, input)
  const tool: ThreadToolCard = {
    id,
    name: nameOf(event) ?? base.tool?.name ?? base.name,
    status,
    ...(nextInput === undefined ? {} : { input: nextInput }),
    ...(isUsefulInput(input) || base.tool?.inputRaw === undefined
      ? {}
      : { inputRaw: base.tool.inputRaw }),
    ...(event.type === 'tool.completed'
      ? { ok: event.ok, output: event.output }
      : {}),
    ...(launchStatus === undefined ? {} : { launchStatus }),
    ...(toolAgentId === undefined ? {} : { agentId: toolAgentId }),
  }

  const nextBlock: ThreadBlock = {
    ...base,
    name: tool.name,
    tool,
    ...(nextInput === undefined ? {} : { input: nextInput }),
  }
  if (existingIndex < 0) return [...blocks, withMergedIndex(blocks, nextBlock)]
  const next = [...blocks]
  next[existingIndex] = nextBlock
  return next
}

// Claude JSONL often stores one content block per assistant line, then a new
// message id after each tool_result. Keep earlier messages as a prefix, place
// this snapshot's blocks after it in snapshot order, and keep a single thinking row.
function mergeSnapshot(
  existing: readonly ThreadBlock[],
  snapshot: readonly ThreadBlock[],
): ThreadBlock[] {
  const existingThinking = existing.find(
    (block): block is Extract<ThreadBlock, { type: 'thinking' }> => block.type === 'thinking',
  )
  const incoming: ThreadBlock[] = []
  for (const block of snapshot) {
    if (block.type === 'thinking') {
      if (block.text.trim() === '') continue
      if (existingThinking !== undefined && existingThinking.text.trim() !== '') continue
      incoming.push(block)
      continue
    }
    if (block.type === 'text' && block.text === '') continue
    incoming.push(alignSnapshotText(existing, block))
  }

  const incomingIds = new Set(incoming.map(snapshotIdentity))
  const prefix = existing.filter((block) => !incomingIds.has(snapshotIdentity(block)))
  let nextIndex = prefix.length === 0 ? 0 : Math.max(...prefix.map((block) => block.index)) + 1
  const suffix = incoming.map((block) => {
    const previous = existing.find((item) => snapshotIdentity(item) === snapshotIdentity(block))
    const merged = previous === undefined ? block : mergeSnapshotBlock(previous, block)
    const indexed = { ...merged, index: nextIndex }
    nextIndex += 1
    return indexed
  })
  return [...prefix, ...suffix]
}

function snapshotIdentity(block: ThreadBlock): string {
  if (block.type === 'tool_use') return `tool:${block.id}`
  if (block.type === 'thinking') return 'thinking'
  return `block:${block.blockId}`
}

function alignSnapshotText(existing: readonly ThreadBlock[], block: ThreadBlock): ThreadBlock {
  if (block.type !== 'text' || block.text.trim() === '') return block
  const match = existing.find(
    (item) => item.type === 'text' && item.index === block.index && item.text === block.text,
  )
  if (match === undefined) return block
  return { ...block, blockId: match.blockId }
}

function mergeSnapshotBlock(previous: ThreadBlock, incoming: ThreadBlock): ThreadBlock {
  if (previous.type === 'tool_use' && incoming.type === 'tool_use') {
    const input = mergeToolInput(
      previous.tool?.input ?? previous.input,
      incoming.input ?? incoming.tool?.input,
    )
    const tool =
      previous.tool === undefined
        ? incoming.tool
        : {
            ...previous.tool,
            ...(incoming.tool ?? {}),
            ...(input === undefined ? {} : { input }),
          }
    return {
      ...incoming,
      ...(tool === undefined ? {} : { tool }),
      ...(input === undefined ? {} : { input }),
    }
  }
  if (previous.type === 'thinking' && incoming.type === 'thinking') {
    return withThinkingTimes(incoming, previous)
  }
  return incoming
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUsefulInput(input: unknown): boolean {
  if (input === undefined || input === null) return false
  if (Array.isArray(input)) return input.length > 0
  if (isPlainObject(input)) return Object.keys(input).length > 0
  return true
}

function mergeToolInput(previous: unknown, incoming: unknown): unknown {
  if (!isUsefulInput(incoming)) {
    return isUsefulInput(previous) ? previous : (incoming ?? previous)
  }
  if (isPlainObject(previous) && isPlainObject(incoming)) {
    return { ...previous, ...incoming }
  }
  return incoming
}

function extractJsonStringField(raw: string, field: string): string | undefined {
  const match = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`).exec(raw)
  if (match?.[1] === undefined || match[1] === '') return undefined
  try {
    return JSON.parse(`"${match[1]}"`) as string
  } catch {
    return match[1]
  }
}

function extractPartialToolInput(raw: string): Record<string, unknown> | undefined {
  const input: Record<string, unknown> = {}
  for (const field of [
    'command',
    'description',
    'file_path',
    'path',
    'content',
    'contents',
    'old_string',
    'new_string',
  ] as const) {
    const value = extractJsonStringField(raw, field)
    if (value !== undefined) input[field] = value
  }
  return isUsefulInput(input) ? input : undefined
}

function parseToolInputJson(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return extractPartialToolInput(trimmed)
  }
}

function applyToolInputDelta(blocks: readonly ThreadBlock[], event: AgentEvent): ThreadBlock[] {
  if (event.type !== 'tool.input_delta') return [...blocks]
  if (event.chunk === '') return [...blocks]
  const index = blocks.findIndex(
    (block) =>
      block.type === 'tool_use' &&
      (block.id === event.id || block.blockId === event.blockId),
  )
  if (index < 0) return [...blocks]
  const current = blocks[index]
  if (current?.type !== 'tool_use') return [...blocks]
  const nextRaw = `${current.tool?.inputRaw ?? ''}${event.chunk}`
  const nextInput = mergeToolInput(
    current.tool?.input ?? current.input,
    parseToolInputJson(nextRaw),
  )
  const tool: ThreadToolCard = {
    id: current.id,
    name: current.tool?.name ?? current.name,
    status: current.tool?.status ?? 'started',
    ...current.tool,
    ...(nextInput === undefined ? {} : { input: nextInput }),
    inputRaw: nextRaw,
  }
  const next = [...blocks]
  next[index] = {
    ...current,
    tool,
    ...(nextInput === undefined ? {} : { input: nextInput }),
  }
  return next
}

function withMergedIndex(existing: readonly ThreadBlock[], block: ThreadBlock): ThreadBlock {
  const taken = existing.some((item) => item.index === block.index && item.blockId !== block.blockId)
  if (!taken) return block
  const nextIndex =
    existing.length === 0 ? 0 : Math.max(...existing.map((item) => item.index)) + 1
  return { ...block, index: nextIndex }
}

function appendText(
  blocks: readonly ThreadBlock[],
  messageId: string,
  blockId: string,
  index: number,
  text: string,
  type: 'text' | 'thinking',
): ThreadBlock[] {
  if (text === '') return [...blocks]
  const existing = blocks.find((block) => block.blockId === blockId && block.type === type)
  if (existing?.type === type) {
    return upsertBlock(blocks, { ...existing, text: existing.text + text })
  }
  return upsertBlock(blocks, { type, blockId: blockId || `${messageId}:${index}`, index, text })
}

function placeholderBlock(event: Extract<AgentEvent, { type: 'assistant.block_start' }>): ThreadBlock {
  const index = event.index ?? 0
  if (event.kind === 'thinking') {
    return { type: 'thinking', blockId: event.blockId, index, text: '' }
  }
  if (event.kind === 'image') {
    return { type: 'image', blockId: event.blockId, index }
  }
  if (event.kind === 'tool_use') {
    return {
      type: 'tool_use',
      blockId: event.blockId,
      index,
      id: event.blockId,
      name: 'unknown',
    }
  }
  return { type: 'text', blockId: event.blockId, index, text: '' }
}

function withThinkingTimes(
  block: Extract<ThreadBlock, { type: 'thinking' }>,
  previous: Extract<ThreadBlock, { type: 'thinking' }> | undefined,
): ThreadBlock {
  if (previous === undefined) return block
  return {
    ...block,
    ...(block.startedAt === undefined && previous.startedAt !== undefined
      ? { startedAt: previous.startedAt }
      : {}),
    ...(block.durationMs === undefined && previous.durationMs !== undefined
      ? { durationMs: previous.durationMs }
      : {}),
  }
}

function upsertBlock(blocks: readonly ThreadBlock[], next: ThreadBlock): ThreadBlock[] {
  const index = blocks.findIndex((block) => block.blockId === next.blockId)
  if (index < 0) {
    return [...blocks, withMergedIndex(blocks, next)].sort((left, right) => left.index - right.index)
  }
  const copy = [...blocks]
  copy[index] = next
  return copy.sort((left, right) => left.index - right.index)
}

function parentToolUseIdOf(event: AgentEvent): string | undefined {
  return 'parentToolUseId' in event ? event.parentToolUseId : undefined
}

function agentIdOf(event: AgentEvent): string | undefined {
  return 'agentId' in event ? event.agentId : undefined
}

function nameOf(event: AgentEvent): string | undefined {
  return 'name' in event ? event.name : undefined
}

function inputOf(event: AgentEvent): unknown {
  return 'input' in event ? event.input : undefined
}

function statusOf(event: AgentEvent): string | undefined {
  return 'status' in event ? event.status : undefined
}

function blockIdOf(event: AgentEvent): string | undefined {
  return 'blockId' in event ? event.blockId : undefined
}

function indexOf(event: AgentEvent): number | undefined {
  return 'index' in event ? event.index : undefined
}

function workflowIdOf(event: AgentEvent): string {
  if ('workflowToolUseId' in event) {
    const id = event.workflowToolUseId
    if (typeof id === 'string' && id !== '') return id
  }
  if ('id' in event && typeof event.id === 'string') return event.id
  return 'workflow'
}

export function emptyAssistantMessage(id: string, createdAt: string): ThreadMessage {
  return {
    id,
    role: 'assistant',
    content: '',
    createdAt,
    status: 'streaming',
    blocks: [],
  }
}
