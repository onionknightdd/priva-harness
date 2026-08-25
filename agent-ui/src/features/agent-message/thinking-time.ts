import type { NestedAgent, StreamBlock, AgentThreadMessage } from "./agent-message-data"

type ThinkingFrame = {
  type?: string
  kind?: string
  blocks?: unknown
  parentToolUseId?: string
  ts?: number
}

export function frameOpensThinking(frame: ThinkingFrame): boolean {
  if (frame.type === "assistant.thinking_delta") {
    return true
  }
  if (frame.type === "assistant.block_start") {
    return frame.kind === "thinking"
  }
  if (frame.type === "assistant.message") {
    return (
      Array.isArray(frame.blocks) &&
      frame.blocks.some(
        (block) =>
          typeof block === "object" &&
          block !== null &&
          (block as { type?: unknown }).type === "thinking"
      )
    )
  }
  return false
}

export function frameClosesThinking(frame: ThinkingFrame): boolean {
  if (frame.type === "assistant.thinking_delta") {
    return false
  }
  if (frame.type === "assistant.block_start") {
    return frame.kind !== "thinking"
  }
  return (
    frame.type === "assistant.delta" ||
    frame.type === "assistant.image_delta" ||
    frame.type === "tool.started" ||
    frame.type === "assistant.message" ||
    frame.type === "run.completed" ||
    frame.type === "run.aborted" ||
    frame.type === "run.failed" ||
    frame.type === "error"
  )
}

export function stampThinkingTimes(
  blocks: StreamBlock[],
  previous: StreamBlock[],
  atMs: number,
  opensThinking: boolean,
  closesThinking: boolean
): StreamBlock[] {
  if (!Number.isFinite(atMs) || atMs <= 0) {
    return blocks
  }
  const previousThinking = new Map(
    previous
      .filter(
        (block): block is Extract<StreamBlock, { type: "thinking" }> =>
          block.type === "thinking"
      )
      .map((block) => [block.blockId, block])
  )

  const opened = blocks.map((block) => {
    if (block.type !== "thinking") {
      return block
    }
    const prior = previousThinking.get(block.blockId)
    const startedAt = block.startedAt ?? prior?.startedAt ?? (opensThinking ? atMs : undefined)
    const durationMs = block.durationMs ?? prior?.durationMs
    if (startedAt === undefined && durationMs === undefined) {
      return block
    }
    return {
      ...block,
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(durationMs === undefined ? {} : { durationMs }),
    }
  })

  if (!closesThinking) {
    return opened
  }

  return opened.map((block) => {
    if (block.type !== "thinking" || block.durationMs !== undefined) {
      return block
    }
    if (block.startedAt === undefined) {
      return block
    }
    return {
      ...block,
      durationMs: Math.max(0, atMs - block.startedAt),
    }
  })
}

export function stampMessageThinkingTimes(
  previous: AgentThreadMessage,
  next: AgentThreadMessage,
  frame: ThinkingFrame,
  atMs: number
): AgentThreadMessage {
  const opensThinking = frameOpensThinking(frame)
  const closesThinking = frameClosesThinking(frame)
  if (!opensThinking && !closesThinking) {
    return next
  }

  const parentId = frame.parentToolUseId
  if (parentId !== undefined && parentId !== "") {
    return {
      ...next,
      nestedAgents: stampNested(
        next.nestedAgents ?? [],
        previous.nestedAgents ?? [],
        parentId,
        atMs,
        opensThinking,
        closesThinking
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
      closesThinking
    ),
  }
}

export function freezeOpenThinking(blocks: StreamBlock[], atMs: number): StreamBlock[] {
  return stampThinkingTimes(blocks, blocks, atMs, false, true)
}

export function freezeMessageThinking(
  message: AgentThreadMessage,
  atMs: number
): AgentThreadMessage {
  if (!Number.isFinite(atMs) || atMs <= 0) {
    return message
  }
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
  agents: NestedAgent[],
  previous: NestedAgent[],
  parentId: string,
  atMs: number,
  opensThinking: boolean,
  closesThinking: boolean
): NestedAgent[] {
  return agents.map((agent) => {
    if (agent.parentToolUseId !== parentId) {
      return agent
    }
    const prior = previous.find((item) => item.parentToolUseId === parentId)
    return {
      ...agent,
      blocks: stampThinkingTimes(
        agent.blocks,
        prior?.blocks ?? [],
        atMs,
        opensThinking,
        closesThinking
      ),
    }
  })
}

export function frameAtMs(frame: ThinkingFrame, fallback = Date.now()): number {
  return typeof frame.ts === "number" && Number.isFinite(frame.ts) && frame.ts > 0
    ? frame.ts
    : fallback
}
