export type AgentMessageRole = "user" | "assistant"

export type AgentMessageStatus = "streaming" | "complete" | "error"

export type ToolCardStatus = "started" | "running" | "completed"

export type StreamBlock =
  | {
      type: "text"
      blockId: string
      index: number
      text: string
    }
  | {
      type: "thinking"
      blockId: string
      index: number
      text: string
    }
  | {
      type: "image"
      blockId: string
      index: number
      mime?: string
      url?: string
      b64?: string
      alt?: string
    }
  | {
      type: "tool_use"
      blockId: string
      index: number
      id: string
      name: string
      input?: unknown
      tool?: ToolCard
    }
  | {
      type: "unknown"
      blockId: string
      index: number
      kind: string
    }

export type ToolCard = {
  id: string
  name: string
  input?: unknown
  status: ToolCardStatus
  ok?: boolean
  output?: string
  launchStatus?: string
  agentId?: string
}

export type NestedInboxMessage = {
  body: string
  source: "peer" | "coordinator"
  senderName?: string
}

export type NestedAgent = {
  parentToolUseId: string
  agentId?: string
  name?: string
  status: "running" | "completed"
  blocks: StreamBlock[]
  inbox: NestedInboxMessage[]
}

export type WorkflowCard = {
  workflowToolUseId: string
  name?: string
  status: string
  summary?: string
}

export type AgentThreadMessage = {
  id: string
  role: AgentMessageRole
  content: string
  createdAt: string
  status: AgentMessageStatus
  transcriptUuid?: string
  blocks?: StreamBlock[]
  nestedAgents?: NestedAgent[]
  workflows?: WorkflowCard[]
}

export function createAgentThreadMessage(
  role: AgentMessageRole,
  content: string,
  status: AgentMessageStatus = "complete"
): AgentThreadMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
    status,
  }
}

export function textFromBlocks(blocks: readonly StreamBlock[]): string {
  return [...blocks]
    .filter((block): block is Extract<StreamBlock, { type: "text" }> => block.type === "text")
    .sort((left, right) => left.index - right.index)
    .map((block) => block.text)
    .join("")
}

export function assistantHasProcess(message: AgentThreadMessage): boolean {
  if ((message.nestedAgents?.length ?? 0) > 0) {
    return true
  }
  if ((message.workflows?.length ?? 0) > 0) {
    return true
  }
  return (message.blocks ?? []).some((block) => {
    if (block.type === "tool_use" || block.type === "image") {
      return true
    }
    return block.type === "thinking" && block.text.trim() !== ""
  })
}
