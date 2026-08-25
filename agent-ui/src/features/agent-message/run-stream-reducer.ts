import {
  textFromBlocks,
  type AgentThreadMessage,
  type NestedAgent,
  type StreamBlock,
  type ToolCard,
  type WorkflowCard,
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

  if (frame.type?.startsWith("workflow.")) {
    return {
      ...withWorkflow(message, frame),
      content: textFromBlocks(message.blocks ?? []),
    }
  }

  const withUuid =
    frame.type === "assistant.message" &&
    frame.messageId &&
    !frame.parentToolUseId
      ? { ...message, transcriptUuid: frame.messageId }
      : message

  if (frame.parentToolUseId) {
    const nestedAgents = applyNested(withUuid.nestedAgents ?? [], frame)
    return {
      ...withUuid,
      nestedAgents,
      content: textFromBlocks(withUuid.blocks ?? []),
    }
  }

  const blocks = applyMainBlocks(withUuid.blocks ?? [], frame)
  return {
    ...withUuid,
    blocks,
    nestedAgents: applyNested(withUuid.nestedAgents ?? [], frame),
    content: textFromBlocks(blocks),
  }
}

function applyMainBlocks(blocks: StreamBlock[], frame: StreamFrame): StreamBlock[] {
  switch (frame.type) {
    case "assistant.block_start":
      return upsertBlock(blocks, placeholderBlock(frame))
    case "assistant.delta":
      return appendText(blocks, frame, "text")
    case "assistant.thinking_delta":
      return appendText(blocks, frame, "thinking")
    case "assistant.image_delta":
      return upsertBlock(blocks, {
        type: "image",
        blockId: blockIdOf(frame),
        index: frame.index ?? 0,
        ...(frame.mime === undefined ? {} : { mime: frame.mime }),
        ...(frame.url === undefined ? {} : { url: frame.url }),
        ...(frame.b64 === undefined ? {} : { b64: frame.b64 }),
        ...(frame.alt === undefined ? {} : { alt: frame.alt }),
      })
    case "assistant.message":
      return mergeSnapshot(blocks, snapshotBlocks(frame.blocks))
    case "tool.started":
    case "tool.updated":
    case "tool.running":
    case "tool.progress":
    case "tool.completed":
      return syncTools(blocks, frame)
    default:
      return blocks
  }
}

function applyNested(agents: NestedAgent[], frame: StreamFrame): NestedAgent[] {
  const parentId = frame.parentToolUseId
  if (parentId === undefined || parentId === "") {
    if (frame.type === "agent.started") {
      return agents
    }
    if (frame.type === "agent.completed") {
      return agents.map((agent) =>
        agent.agentId === frame.agentId ? { ...agent, status: "completed" } : agent
      )
    }
    return agents
  }

  const existing = agents.find((agent) => agent.parentToolUseId === parentId)
  const current: NestedAgent = existing ?? {
    parentToolUseId: parentId,
    status: "running",
    blocks: [],
    inbox: [],
    ...(frame.agentId === undefined ? {} : { agentId: frame.agentId }),
    ...(frame.name === undefined ? {} : { name: frame.name }),
  }

  let next = current
  if (frame.type === "agent.message" && frame.body) {
    next = {
      ...current,
      inbox: [
        ...current.inbox,
        {
          body: frame.body,
          source: frame.source === "coordinator" ? "coordinator" : "peer",
          ...(frame.senderName === undefined ? {} : { senderName: frame.senderName }),
        },
      ],
    }
  } else if (frame.type === "agent.started") {
    next = {
      ...current,
      status: "running",
      ...(frame.agentId === undefined ? {} : { agentId: frame.agentId }),
      ...(frame.name === undefined ? {} : { name: frame.name }),
    }
  } else if (frame.type === "agent.completed") {
    next = { ...current, status: "completed" }
  } else if (
    frame.type === "tool.completed" &&
    frame.status !== "async_launched" &&
    (frame.name === "agent" || frame.name === "task")
  ) {
    next = { ...current, status: "completed" }
  } else {
    next = { ...current, blocks: applyMainBlocks(current.blocks, frame) }
  }

  if (existing === undefined) {
    return [...agents, next]
  }
  return agents.map((agent) => (agent.parentToolUseId === parentId ? next : agent))
}

function withWorkflow(message: AgentThreadMessage, frame: StreamFrame): AgentThreadMessage {
  const id = frame.workflowToolUseId ?? frame.id ?? "workflow"
  const workflows = [...(message.workflows ?? [])]
  const index = workflows.findIndex((card) => card.workflowToolUseId === id)
  const current: WorkflowCard =
    index >= 0
      ? workflows[index]
      : { workflowToolUseId: id, status: "running" }

  let next = current
  if (frame.type === "workflow.started") {
    next = {
      ...current,
      status: "running",
      ...(frame.name === undefined ? {} : { name: frame.name }),
    }
  } else if (frame.type === "workflow.notification") {
    next = {
      ...current,
      status: frame.status ?? current.status,
      ...(frame.summary === undefined ? {} : { summary: frame.summary }),
    }
  } else if (frame.type === "workflow.completed") {
    next = { ...current, status: frame.status ?? "completed" }
  }

  if (index >= 0) {
    workflows[index] = next
  } else {
    workflows.push(next)
  }
  return { ...message, workflows }
}

function syncTools(blocks: StreamBlock[], frame: StreamFrame): StreamBlock[] {
  const id = frame.id
  if (id === undefined) {
    return blocks
  }
  const kind = frame.type
  if (
    kind !== "tool.started" &&
    kind !== "tool.updated" &&
    kind !== "tool.running" &&
    kind !== "tool.progress" &&
    kind !== "tool.completed"
  ) {
    return blocks
  }

  const existingIndex = blocks.findIndex(
    (block) => block.type === "tool_use" && block.id === id
  )
  const base: Extract<StreamBlock, { type: "tool_use" }> =
    existingIndex >= 0 && blocks[existingIndex]?.type === "tool_use"
      ? blocks[existingIndex]
      : {
          type: "tool_use",
          blockId: frame.blockId ?? id,
          index: frame.index ?? blocks.length,
          id,
          name: frame.name ?? "unknown",
          ...(frame.input === undefined ? {} : { input: frame.input }),
        }

  const tool: ToolCard = {
    id,
    name: frame.name ?? base.tool?.name ?? base.name,
    status:
      kind === "tool.completed"
        ? "completed"
        : kind === "tool.running" || kind === "tool.progress"
          ? "running"
          : "started",
    ...(frame.input === undefined ? {} : { input: frame.input }),
    ...(base.tool?.input === undefined ? {} : { input: base.tool.input }),
    ...(kind === "tool.completed" ? { ok: frame.ok !== false, output: frame.output ?? "" } : {}),
    ...(frame.status === undefined ? {} : { launchStatus: frame.status }),
    ...(frame.agentId === undefined ? {} : { agentId: frame.agentId }),
  }

  const nextBlock: StreamBlock = { ...base, name: tool.name, tool }
  if (existingIndex < 0) {
    return [...blocks, nextBlock]
  }
  const next = [...blocks]
  next[existingIndex] = nextBlock
  return next
}

function appendText(
  blocks: StreamBlock[],
  frame: StreamFrame,
  type: "text" | "thinking"
): StreamBlock[] {
  const text = frame.text ?? ""
  if (text === "") {
    return blocks
  }
  const id = blockIdOf(frame)
  const index = frame.index ?? 0
  const existing = blocks.find((block) => block.blockId === id && block.type === type)
  if (existing && existing.type === type) {
    return upsertBlock(blocks, { ...existing, text: existing.text + text })
  }
  return upsertBlock(blocks, { type, blockId: id, index, text })
}

function placeholderBlock(frame: StreamFrame): StreamBlock {
  const index = frame.index ?? 0
  const id = blockIdOf(frame)
  if (frame.kind === "thinking") {
    return { type: "thinking", blockId: id, index, text: "" }
  }
  if (frame.kind === "image") {
    return { type: "image", blockId: id, index }
  }
  if (frame.kind === "tool_use") {
    return {
      type: "tool_use",
      blockId: id,
      index,
      id: frame.id ?? id,
      name: frame.name ?? "unknown",
    }
  }
  return { type: "text", blockId: id, index, text: "" }
}

function snapshotBlocks(raw: unknown): StreamBlock[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const blocks: StreamBlock[] = []
  raw.forEach((item, index) => {
    if (typeof item !== "object" || item === null) {
      return
    }
    const block = item as Record<string, unknown>
    const type = block.type
    const blockId = typeof block.blockId === "string" ? block.blockId : `${index}`
    const blockIndex = typeof block.index === "number" ? block.index : index
    if (type === "text") {
      blocks.push({ type: "text", blockId, index: blockIndex, text: String(block.text ?? "") })
      return
    }
    if (type === "thinking") {
      blocks.push({ type: "thinking", blockId, index: blockIndex, text: String(block.text ?? "") })
      return
    }
    if (type === "image") {
      blocks.push({
        type: "image",
        blockId,
        index: blockIndex,
        ...(typeof block.mime === "string" ? { mime: block.mime } : {}),
        ...(typeof block.url === "string" ? { url: block.url } : {}),
        ...(typeof block.b64 === "string" ? { b64: block.b64 } : {}),
        ...(typeof block.alt === "string" ? { alt: block.alt } : {}),
      })
      return
    }
    if (type === "tool_use") {
      blocks.push({
        type: "tool_use",
        blockId,
        index: blockIndex,
        id: String(block.id ?? blockId),
        name: String(block.name ?? "unknown"),
        ...(block.input === undefined ? {} : { input: block.input }),
      })
      return
    }
    blocks.push({ type: "unknown", blockId, index: blockIndex, kind: String(type ?? "unknown") })
  })
  return blocks
}

function mergeSnapshot(existing: StreamBlock[], snapshot: StreamBlock[]): StreamBlock[] {
  const tools = new Map<string, Extract<StreamBlock, { type: "tool_use" }>>()
  for (const block of existing) {
    if (block.type === "tool_use") {
      tools.set(block.id, block)
    }
  }

  const snapshotTools: StreamBlock[] = []
  const snapshotText: StreamBlock[] = []
  const snapshotThinking: StreamBlock[] = []
  const snapshotImages: StreamBlock[] = []
  const snapshotUnknown: StreamBlock[] = []
  const seen = new Set<string>()

  for (const block of snapshot) {
    if (block.type === "tool_use") {
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
            }
      )
      seen.add(block.id)
      continue
    }
    if (block.type === "thinking") {
      snapshotThinking.push(block)
      continue
    }
    if (block.type === "image") {
      snapshotImages.push(block)
      continue
    }
    if (block.type === "unknown") {
      snapshotUnknown.push(block)
      continue
    }
    snapshotText.push(block)
  }

  for (const [id, block] of tools) {
    if (!seen.has(id)) {
      snapshotTools.push(block)
    }
  }

  const keep = (type: StreamBlock["type"], incoming: StreamBlock[]) =>
    incoming.length > 0 ? incoming : existing.filter((block) => block.type === type)

  return [
    ...keep("thinking", snapshotThinking),
    ...keep("text", snapshotText),
    ...keep("image", snapshotImages),
    ...keep("unknown", snapshotUnknown),
    ...snapshotTools,
  ].sort((left, right) => left.index - right.index)
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
