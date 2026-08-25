import type { AgentEvent } from '../event/agent-event.js'
import type { ThreadBlock, ThreadMessage, ThreadNestedAgent } from './thread.js'

export function eventOpensThinking(event: AgentEvent): boolean {
  if (event.type === 'assistant.thinking_delta') return true
  if (event.type === 'assistant.block_start') return event.kind === 'thinking'
  if (event.type === 'assistant.message') {
    return event.blocks.some((block) => block.type === 'thinking')
  }
  return false
}

export function eventClosesThinking(event: AgentEvent): boolean {
  if (event.type === 'assistant.thinking_delta') return false
  if (event.type === 'assistant.block_start') return event.kind !== 'thinking'
  return (
    event.type === 'assistant.delta' ||
    event.type === 'assistant.image_delta' ||
    event.type === 'tool.started' ||
    event.type === 'assistant.message' ||
    event.type === 'run.completed' ||
    event.type === 'run.aborted' ||
    event.type === 'run.failed' ||
    event.type === 'error'
  )
}

export function stampThinkingTimes(
  blocks: readonly ThreadBlock[],
  previous: readonly ThreadBlock[],
  atMs: number,
  opensThinking: boolean,
  closesThinking: boolean,
): ThreadBlock[] {
  if (!Number.isFinite(atMs) || atMs <= 0) return [...blocks]
  const previousThinking = new Map(
    previous
      .filter(
        (block): block is Extract<ThreadBlock, { type: 'thinking' }> => block.type === 'thinking',
      )
      .map((block) => [block.blockId, block]),
  )

  const opened = blocks.map((block) => {
    if (block.type !== 'thinking') return block
    const prior = previousThinking.get(block.blockId)
    const startedAt = block.startedAt ?? prior?.startedAt ?? (opensThinking ? atMs : undefined)
    const durationMs = block.durationMs ?? prior?.durationMs
    if (startedAt === undefined && durationMs === undefined) return block
    return {
      ...block,
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(durationMs === undefined ? {} : { durationMs }),
    }
  })

  if (!closesThinking) return opened

  return opened.map((block) => {
    if (block.type !== 'thinking' || block.durationMs !== undefined) return block
    if (block.startedAt === undefined) return block
    return {
      ...block,
      durationMs: Math.max(0, atMs - block.startedAt),
    }
  })
}

export function stampMessageThinkingTimes(
  previous: ThreadMessage,
  next: ThreadMessage,
  event: AgentEvent,
  atMs: number,
): ThreadMessage {
  const opensThinking = eventOpensThinking(event)
  const closesThinking = eventClosesThinking(event)
  if (!opensThinking && !closesThinking) return next

  const parentId = 'parentToolUseId' in event ? event.parentToolUseId : undefined
  if (parentId !== undefined) {
    return {
      ...next,
      nestedAgents: stampNested(
        next.nestedAgents ?? [],
        previous.nestedAgents ?? [],
        parentId,
        atMs,
        opensThinking,
        closesThinking,
      ),
    }
  }

  return {
    ...next,
    blocks: stampThinkingTimes(
      next.blocks ?? [],
      previous.blocks ?? [],
      atMs,
      opensThinking,
      closesThinking,
    ),
  }
}

export function freezeOpenThinking(blocks: readonly ThreadBlock[], atMs: number): ThreadBlock[] {
  return stampThinkingTimes(blocks, blocks, atMs, false, true)
}

export function freezeMessageThinking(message: ThreadMessage, atMs: number): ThreadMessage {
  if (!Number.isFinite(atMs) || atMs <= 0) return message
  return {
    ...message,
    blocks: freezeOpenThinking(message.blocks ?? [], atMs),
    ...(message.nestedAgents === undefined
      ? {}
      : {
          nestedAgents: message.nestedAgents.map((agent) => ({
            ...agent,
            blocks: freezeOpenThinking(agent.blocks, atMs),
          })),
        }),
  }
}

function stampNested(
  agents: readonly ThreadNestedAgent[],
  previous: readonly ThreadNestedAgent[],
  parentId: string,
  atMs: number,
  opensThinking: boolean,
  closesThinking: boolean,
): ThreadNestedAgent[] {
  return agents.map((agent) => {
    if (agent.parentToolUseId !== parentId) return agent
    const prior = previous.find((item) => item.parentToolUseId === parentId)
    return {
      ...agent,
      blocks: stampThinkingTimes(
        agent.blocks,
        prior?.blocks ?? [],
        atMs,
        opensThinking,
        closesThinking,
      ),
    }
  })
}
