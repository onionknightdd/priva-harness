import {
  textFromBlocks,
  type AgentThreadMessage,
  type NestedAgent,
  type StreamBlock,
  type ToolCard,
  type WorkflowCard,
} from "./agent-message-data"
import { applyThreadCompactFrame } from "./slash-command-envelope"
import { frameAtMs, stampMessageThinkingTimes } from "./thinking-time"

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
  ts?: number
  runId?: string
  seq?: number
  firstSeq?: number
  lastSeq?: number
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

export function applyThreadStreamFrame(
  messages: readonly AgentThreadMessage[],
  assistantId: string,
  frame: StreamFrame
): AgentThreadMessage[] {
  const withAssistant = messages.map((message) =>
    message.id === assistantId &&
    frame.type !== "session.compacting" &&
    frame.type !== "session.compacted"
      ? applyStreamFrame(message, frame)
      : message
  )
  return applyThreadCompactFrame(withAssistant, assistantId, frame)
}

export function applyStreamFrame(
  message: AgentThreadMessage,
  frame: StreamFrame
): AgentThreadMessage {
  const next = applyStreamContent(message, frame)
  return stampMessageThinkingTimes(message, next, frame, frameAtMs(frame))
}

function applyStreamContent(
  message: AgentThreadMessage,
  frame: StreamFrame
): AgentThreadMessage {
  if (frame.type === "error" || frame.type === "run.failed") {
    const errorText = frame.message?.trim() || message.content
    return { ...message, content: errorText, status: "error" }
  }
  if (frame.type === "run.aborted" || frame.type === "run.completed") {
    return { ...message, status: frame.type === "run.aborted" ? "complete" : message.status }
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
    case "tool.input_delta":
      return applyToolInputDelta(blocks, frame)
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

  const nextInput = mergeToolInput(base.tool?.input ?? base.input, frame.input)
  const tool: ToolCard = {
    id,
    name: frame.name ?? base.tool?.name ?? base.name,
    status:
      kind === "tool.completed"
        ? "completed"
        : kind === "tool.running" || kind === "tool.progress"
          ? "running"
          : "started",
    ...(nextInput === undefined ? {} : { input: nextInput }),
    ...(isUsefulInput(frame.input) || base.tool?.inputRaw === undefined
      ? {}
      : { inputRaw: base.tool.inputRaw }),
    ...(kind === "tool.completed" ? { ok: frame.ok !== false, output: frame.output ?? "" } : {}),
    ...(frame.status === undefined ? {} : { launchStatus: frame.status }),
    ...(frame.agentId === undefined ? {} : { agentId: frame.agentId }),
  }

  const nextBlock: StreamBlock = {
    ...base,
    name: tool.name,
    tool,
    ...(nextInput === undefined ? {} : { input: nextInput }),
  }
  if (existingIndex < 0) {
    return [...blocks, withMergedIndex(blocks, nextBlock)]
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
      blocks.push({
        type: "thinking",
        blockId,
        index: blockIndex,
        text: String(block.text ?? ""),
        ...optionalTime(block.startedAt, "startedAt"),
        ...optionalTime(block.durationMs, "durationMs"),
      })
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

// Claude JSONL often stores one content block per assistant line, then a new
// message id after each tool_result. Keep earlier messages as a prefix, place
// this snapshot's blocks after it in snapshot order, and keep a single thinking row.
function mergeSnapshot(existing: StreamBlock[], snapshot: StreamBlock[]): StreamBlock[] {
  const existingThinking = existing.find(
    (block): block is Extract<StreamBlock, { type: "thinking" }> =>
      block.type === "thinking"
  )
  const incoming: StreamBlock[] = []
  for (const block of snapshot) {
    if (block.type === "thinking") {
      if (block.text.trim() === "") {
        continue
      }
      if (existingThinking !== undefined && existingThinking.text.trim() !== "") {
        continue
      }
      incoming.push(block)
      continue
    }
    if (block.type === "text" && block.text === "") {
      continue
    }
    incoming.push(alignSnapshotText(existing, block))
  }

  const incomingIds = new Set(incoming.map(snapshotIdentity))
  const prefix = existing.filter(
    (block) => !incomingIds.has(snapshotIdentity(block))
  )
  let nextIndex =
    prefix.length === 0 ? 0 : Math.max(...prefix.map((block) => block.index)) + 1
  const suffix = incoming.map((block) => {
    const previous = existing.find(
      (item) => snapshotIdentity(item) === snapshotIdentity(block)
    )
    const merged =
      previous === undefined ? block : mergeSnapshotBlock(previous, block)
    const indexed = { ...merged, index: nextIndex }
    nextIndex += 1
    return indexed
  })
  return [...prefix, ...suffix]
}

function snapshotIdentity(block: StreamBlock): string {
  if (block.type === "tool_use") {
    return `tool:${block.id}`
  }
  if (block.type === "thinking") {
    return "thinking"
  }
  return `block:${block.blockId}`
}

function alignSnapshotText(existing: StreamBlock[], block: StreamBlock): StreamBlock {
  if (block.type !== "text" || block.text.trim() === "") {
    return block
  }
  const match = existing.find(
    (item) =>
      item.type === "text" &&
      item.index === block.index &&
      item.text === block.text
  )
  if (match === undefined) {
    return block
  }
  return { ...block, blockId: match.blockId }
}

function mergeSnapshotBlock(previous: StreamBlock, incoming: StreamBlock): StreamBlock {
  if (previous.type === "tool_use" && incoming.type === "tool_use") {
    const input = mergeToolInput(
      previous.tool?.input ?? previous.input,
      incoming.input ?? incoming.tool?.input
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
  if (previous.type === "thinking" && incoming.type === "thinking") {
    return withThinkingTimes(incoming, previous)
  }
  return incoming
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isUsefulInput(input: unknown): boolean {
  if (input === undefined || input === null) {
    return false
  }
  if (Array.isArray(input)) {
    return input.length > 0
  }
  if (isPlainObject(input)) {
    return Object.keys(input).length > 0
  }
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
  if (match?.[1] === undefined || match[1] === "") {
    return undefined
  }
  try {
    return JSON.parse(`"${match[1]}"`) as string
  } catch {
    return match[1]
  }
}

function extractPartialToolInput(raw: string): Record<string, unknown> | undefined {
  const input: Record<string, unknown> = {}
  for (const field of [
    "command",
    "description",
    "file_path",
    "path",
    "content",
    "contents",
    "old_string",
    "new_string",
  ] as const) {
    const value = extractJsonStringField(raw, field)
    if (value !== undefined) {
      input[field] = value
    }
  }
  return isUsefulInput(input) ? input : undefined
}

function parseToolInputJson(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === "") {
    return undefined
  }
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return extractPartialToolInput(trimmed)
  }
}

function applyToolInputDelta(blocks: StreamBlock[], frame: StreamFrame): StreamBlock[] {
  const chunk = frame.chunk ?? ""
  if (chunk === "") {
    return blocks
  }
  const index = blocks.findIndex(
    (block) =>
      block.type === "tool_use" &&
      ((frame.id !== undefined && block.id === frame.id) ||
        (frame.blockId !== undefined && block.blockId === frame.blockId))
  )
  if (index < 0) {
    return blocks
  }
  const current = blocks[index]
  if (current?.type !== "tool_use") {
    return blocks
  }
  const nextRaw = `${current.tool?.inputRaw ?? ""}${chunk}`
  const nextInput = mergeToolInput(
    current.tool?.input ?? current.input,
    parseToolInputJson(nextRaw)
  )
  const tool: ToolCard = {
    id: current.id,
    name: current.tool?.name ?? current.name,
    status: current.tool?.status ?? "started",
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

function withMergedIndex(existing: StreamBlock[], block: StreamBlock): StreamBlock {
  const taken = existing.some(
    (item) => item.index === block.index && item.blockId !== block.blockId
  )
  if (!taken) {
    return block
  }
  const nextIndex =
    existing.length === 0 ? 0 : Math.max(...existing.map((item) => item.index)) + 1
  return { ...block, index: nextIndex }
}

function withThinkingTimes(
  block: Extract<StreamBlock, { type: "thinking" }>,
  previous: Extract<StreamBlock, { type: "thinking" }> | undefined
): StreamBlock {
  if (previous === undefined) {
    return block
  }
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

function optionalTime(
  value: unknown,
  key: "startedAt" | "durationMs"
): { startedAt: number } | { durationMs: number } | Record<string, never> {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return {}
  }
  return { [key]: value } as { startedAt: number } | { durationMs: number }
}

function upsertBlock(blocks: StreamBlock[], next: StreamBlock): StreamBlock[] {
  const index = blocks.findIndex((block) => block.blockId === next.blockId)
  if (index < 0) {
    return [...blocks, withMergedIndex(blocks, next)].sort(
      (left, right) => left.index - right.index
    )
  }
  const copy = [...blocks]
  copy[index] = next
  return copy.sort((left, right) => left.index - right.index)
}

function blockIdOf(frame: StreamFrame): string {
  return frame.blockId ?? `${frame.messageId ?? "msg"}:${frame.index ?? 0}`
}
