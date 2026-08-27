import { isTaskBoardTool } from "./task-plan"

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
      startedAt?: number
      durationMs?: number
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
  inputRaw?: string
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

export function answerTextBlock(
  blocks: readonly StreamBlock[]
): Extract<StreamBlock, { type: "text" }> | undefined {
  const texts = [...blocks]
    .filter(
      (block): block is Extract<StreamBlock, { type: "text" }> =>
        block.type === "text" && block.text.trim() !== ""
    )
    .sort((left, right) => left.index - right.index)
  const last = texts.at(-1)
  if (last === undefined) {
    return undefined
  }
  const hasLater = blocks.some(
    (block) => block.index > last.index && blockHasVisibleContent(block)
  )
  if (hasLater) {
    return undefined
  }
  return last
}

function blockHasVisibleContent(block: StreamBlock): boolean {
  if (block.type === "thinking" || block.type === "text") {
    return block.text.trim() !== ""
  }
  if (block.type === "tool_use") {
    return !isTaskBoardTool(block.name)
  }
  return block.type === "image"
}

export function textFromBlocks(blocks: readonly StreamBlock[]): string {
  return answerTextBlock(blocks)?.text ?? ""
}

export function isProcessBlock(
  block: StreamBlock,
  blocks: readonly StreamBlock[]
): boolean {
  if (block.type === "thinking") {
    return block.text.trim() !== ""
  }
  if (block.type === "image") {
    return true
  }
  if (block.type === "tool_use") {
    return !isTaskBoardTool(block.name)
  }
  if (block.type !== "text" || block.text.trim() === "") {
    return false
  }
  const answer = answerTextBlock(blocks)
  if (answer === undefined) {
    return true
  }
  if (answer.blockId === block.blockId) {
    return false
  }
  return answer.text.trim() !== block.text.trim()
}

export function assistantHasProcess(message: AgentThreadMessage): boolean {
  if ((message.nestedAgents?.length ?? 0) > 0) {
    return true
  }
  if ((message.workflows?.length ?? 0) > 0) {
    return true
  }
  const blocks = message.blocks ?? []
  return blocks.some((block) => isProcessBlock(block, blocks))
}
