import type { AgentThreadMessage, NestedAgent, StreamBlock, ToolCard, WorkflowCard } from "@/features/agent-message/agent-message-data"

type ThreadApiMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt: string
  status: "streaming" | "complete" | "error"
  transcriptUuid?: string
  blocks?: unknown
  nestedAgents?: unknown
  workflows?: unknown
}

export function threadMessagesFromApi(
  messages: readonly ThreadApiMessage[]
): AgentThreadMessage[] {
  return messages.map((item) => ({
    id: item.id,
    role: item.role,
    content: item.content,
    createdAt: item.createdAt,
    status: item.status,
    ...(item.transcriptUuid ? { transcriptUuid: item.transcriptUuid } : {}),
    ...(item.role === "assistant"
      ? {
          blocks: snapshotBlocks(item.blocks),
          nestedAgents: snapshotNested(item.nestedAgents),
          workflows: snapshotWorkflows(item.workflows),
        }
      : {}),
  }))
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
    const blockId = typeof block.blockId === "string" ? block.blockId : String(index)
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
        ...(typeof block.startedAt === "number" && Number.isFinite(block.startedAt)
          ? { startedAt: block.startedAt }
          : {}),
        ...(typeof block.durationMs === "number" && Number.isFinite(block.durationMs)
          ? { durationMs: block.durationMs }
          : {}),
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
      const id = String(block.id ?? blockId)
      const tool = asToolCard(block.tool, id, String(block.name ?? "unknown"))
      blocks.push({
        type: "tool_use",
        blockId,
        index: blockIndex,
        id,
        name: String(block.name ?? "unknown"),
        ...(block.input === undefined ? {} : { input: block.input }),
        ...(tool === undefined ? {} : { tool }),
      })
      return
    }
    blocks.push({ type: "unknown", blockId, index: blockIndex, kind: String(type ?? "unknown") })
  })
  return blocks
}

function asToolCard(raw: unknown, id: string, fallbackName: string): ToolCard | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined
  }
  const record = raw as Record<string, unknown>
  const status: ToolCard["status"] =
    record.status === "completed" || record.status === "running" || record.status === "started"
      ? record.status
      : "started"
  return {
    id: typeof record.id === "string" ? record.id : id,
    name: typeof record.name === "string" ? record.name : fallbackName,
    status,
    ...(record.input === undefined ? {} : { input: record.input }),
    ...(typeof record.ok === "boolean" ? { ok: record.ok } : {}),
    ...(typeof record.output === "string" ? { output: record.output } : {}),
    ...(typeof record.launchStatus === "string" ? { launchStatus: record.launchStatus } : {}),
    ...(typeof record.agentId === "string" ? { agentId: record.agentId } : {}),
  }
}

function snapshotNested(raw: unknown): NestedAgent[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.flatMap((item) => {
    if (typeof item !== "object" || item === null) {
      return []
    }
    const record = item as Record<string, unknown>
    const parentToolUseId =
      typeof record.parentToolUseId === "string" ? record.parentToolUseId : ""
    if (parentToolUseId === "") {
      return []
    }
    const inbox = Array.isArray(record.inbox)
      ? record.inbox.flatMap((entry) => {
          if (typeof entry !== "object" || entry === null) {
            return []
          }
          const message = entry as Record<string, unknown>
          const body = typeof message.body === "string" ? message.body : ""
          if (body === "") {
            return []
          }
          return [
            {
              body,
              source: message.source === "coordinator" ? "coordinator" as const : "peer" as const,
              ...(typeof message.senderName === "string" ? { senderName: message.senderName } : {}),
            },
          ]
        })
      : []
    return [
      {
        parentToolUseId,
        status: record.status === "completed" ? "completed" as const : "running" as const,
        blocks: snapshotBlocks(record.blocks),
        inbox,
        ...(typeof record.agentId === "string" ? { agentId: record.agentId } : {}),
        ...(typeof record.name === "string" ? { name: record.name } : {}),
      },
    ]
  })
}

function snapshotWorkflows(raw: unknown): WorkflowCard[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.flatMap((item) => {
    if (typeof item !== "object" || item === null) {
      return []
    }
    const record = item as Record<string, unknown>
    const workflowToolUseId =
      typeof record.workflowToolUseId === "string" ? record.workflowToolUseId : ""
    if (workflowToolUseId === "") {
      return []
    }
    return [
      {
        workflowToolUseId,
        status: typeof record.status === "string" ? record.status : "running",
        ...(typeof record.name === "string" ? { name: record.name } : {}),
        ...(typeof record.summary === "string" ? { summary: record.summary } : {}),
      },
    ]
  })
}
