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
  const nextInput = input ?? base.tool?.input ?? base.input
  const tool: ThreadToolCard = {
    id,
    name: nameOf(event) ?? base.tool?.name ?? base.name,
    status,
    ...(nextInput === undefined ? {} : { input: nextInput }),
    ...(event.type === 'tool.completed'
      ? { ok: event.ok, output: event.output }
      : {}),
    ...(launchStatus === undefined ? {} : { launchStatus }),
    ...(toolAgentId === undefined ? {} : { agentId: toolAgentId }),
  }

  const nextBlock: ThreadBlock = { ...base, name: tool.name, tool }
  if (existingIndex < 0) return [...blocks, nextBlock]
  const next = [...blocks]
  next[existingIndex] = nextBlock
  return next
}

function mergeSnapshot(
  existing: readonly ThreadBlock[],
  snapshot: readonly ThreadBlock[],
): ThreadBlock[] {
  const tools = new Map<string, Extract<ThreadBlock, { type: 'tool_use' }>>()
  for (const block of existing) {
    if (block.type === 'tool_use') tools.set(block.id, block)
  }

  const snapshotTools: ThreadBlock[] = []
  const snapshotText: ThreadBlock[] = []
  const snapshotThinking: ThreadBlock[] = []
  const snapshotImages: ThreadBlock[] = []
  const snapshotUnknown: ThreadBlock[] = []
  const seen = new Set<string>()

  for (const block of snapshot) {
    if (block.type === 'tool_use') {
      const previous = tools.get(block.id)
      snapshotTools.push(
        previous === undefined
          ? block
          : {
              ...block,
              ...(previous.tool === undefined ? {} : { tool: previous.tool }),
              ...(block.input === undefined && previous.input !== undefined
                ? { input: previous.input }
                : {}),
            },
      )
      seen.add(block.id)
      continue
    }
    if (block.type === 'thinking') {
      const previous = existing.find(
        (item): item is Extract<ThreadBlock, { type: 'thinking' }> =>
          item.type === 'thinking' && item.blockId === block.blockId,
      ) ?? existing.find(
        (item): item is Extract<ThreadBlock, { type: 'thinking' }> =>
          item.type === 'thinking' && item.index === block.index,
      )
      snapshotThinking.push(withThinkingTimes(block, previous))
      continue
    }
    if (block.type === 'image') {
      snapshotImages.push(block)
      continue
    }
    if (block.type === 'unknown') {
      snapshotUnknown.push(block)
      continue
    }
    snapshotText.push(block)
  }

  for (const [id, block] of tools) {
    if (!seen.has(id)) snapshotTools.push(block)
  }

  const keep = (type: ThreadBlock['type'], incoming: readonly ThreadBlock[]) =>
    incoming.length > 0 ? incoming : existing.filter((block) => block.type === type)

  return [
    ...keep('thinking', snapshotThinking),
    ...keep('text', snapshotText),
    ...keep('image', snapshotImages),
    ...keep('unknown', snapshotUnknown),
    ...snapshotTools,
  ].sort((left, right) => left.index - right.index)
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
    return [...blocks, next].sort((left, right) => left.index - right.index)
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
