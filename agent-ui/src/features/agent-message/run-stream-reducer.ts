import {
  textFromBlocks,
  type AgentThreadMessage,
  type StreamBlock,
} from "./agent-message-data"

const STREAM_PROTOCOL_VERSION = 1

export type StreamFrame = {
  v?: number
  type?: string
  message?: string
  sessionId?: string
  parentToolUseId?: string
  agentId?: string
  messageId?: string
  blockId?: string
  index?: number
  kind?: string
  text?: string
  id?: string
  name?: string
  input?: unknown
  chunk?: string
  channel?: string
  ok?: boolean
  output?: string
  status?: string
  mime?: string
  b64?: string
  url?: string
  alt?: string
  blocks?: unknown
  body?: string
  source?: string
  senderName?: string
  workflowToolUseId?: string
  summary?: string
  prompt?: string
  result?: string
}

export function parseStreamFrame(raw: unknown): StreamFrame | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined
  }
  const frame = raw as StreamFrame
  if (typeof frame.type !== "string" || frame.type === "") {
    return undefined
  }
  if (frame.v !== undefined && frame.v !== STREAM_PROTOCOL_VERSION) {
    return undefined
  }
  return frame
}

export function applyStreamFrame(
  message: AgentThreadMessage,
  frame: StreamFrame
): AgentThreadMessage {
  if (frame.type === "error" || frame.type === "run.failed") {
    const errorText = frame.message?.trim() || message.content
    return { ...message, content: errorText, status: "error" }
  }
  if (frame.type === "run.aborted") {
    return { ...message, status: "complete" }
  }

  if (!isResultTextFrame(frame)) {
    return message
  }

  const withUuid =
    frame.type === "assistant.message" && frame.messageId
      ? { ...message, transcriptUuid: frame.messageId }
      : message

  const blocks = applyResultTextBlocks(withUuid.blocks ?? [], frame)
  return {
    ...withUuid,
    blocks,
    content: textFromBlocks(blocks),
  }
}

function isResultTextFrame(frame: StreamFrame): boolean {
  if (frame.parentToolUseId) {
    return false
  }
  if (frame.type === "assistant.delta") {
    return true
  }
  if (frame.type === "assistant.message") {
    return true
  }
  if (frame.type === "assistant.block_start") {
    return frame.kind === undefined || frame.kind === "text"
  }
  return false
}

function applyResultTextBlocks(
  blocks: StreamBlock[],
  frame: StreamFrame
): StreamBlock[] {
  if (frame.type === "assistant.block_start") {
    return upsertBlock(blocks, {
      type: "text",
      blockId: blockIdOf(frame),
      index: frame.index ?? 0,
      text: "",
    })
  }
  if (frame.type === "assistant.delta") {
    return appendText(blocks, frame)
  }
  if (frame.type === "assistant.message") {
    return mergeTextSnapshot(blocks, textBlocksFromSnapshot(frame.blocks))
  }
  return blocks
}

function appendText(blocks: StreamBlock[], frame: StreamFrame): StreamBlock[] {
  const text = frame.text ?? ""
  if (text === "") {
    return blocks
  }
  const id = blockIdOf(frame)
  const index = frame.index ?? 0
  const existing = blocks.find(
    (block) => block.blockId === id && block.type === "text"
  )
  if (existing && existing.type === "text") {
    return upsertBlock(blocks, { ...existing, text: existing.text + text })
  }
  return upsertBlock(blocks, { type: "text", blockId: id, index, text })
}

function textBlocksFromSnapshot(raw: unknown): StreamBlock[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const blocks: StreamBlock[] = []
  raw.forEach((item, index) => {
    if (typeof item !== "object" || item === null) {
      return
    }
    const block = item as Record<string, unknown>
    if (block.type !== "text") {
      return
    }
    const blockId =
      typeof block.blockId === "string" ? block.blockId : `${index}`
    const blockIndex = typeof block.index === "number" ? block.index : index
    blocks.push({
      type: "text",
      blockId,
      index: blockIndex,
      text: String(block.text ?? ""),
    })
  })
  return blocks
}

function mergeTextSnapshot(
  existing: StreamBlock[],
  snapshot: StreamBlock[]
): StreamBlock[] {
  const incoming = snapshot.filter((block) => block.type === "text")
  if (incoming.length > 0) {
    return incoming.sort((left, right) => left.index - right.index)
  }
  return existing.filter((block) => block.type === "text")
}

function upsertBlock(blocks: StreamBlock[], next: StreamBlock): StreamBlock[] {
  const index = blocks.findIndex((block) => block.blockId === next.blockId)
  if (index < 0) {
    return [...blocks, next].sort((left, right) => left.index - right.index)
  }
  const copy = [...blocks]
  copy[index] = next
  return copy.sort((left, right) => left.index - right.index)
}

function blockIdOf(frame: StreamFrame): string {
  return frame.blockId ?? `${frame.messageId ?? "msg"}:${frame.index ?? 0}`
}
