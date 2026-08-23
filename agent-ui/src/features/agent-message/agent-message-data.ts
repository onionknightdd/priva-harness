export type AgentMessageRole = "user" | "assistant"

export type AgentMessageStatus = "streaming" | "complete" | "error"

export type AgentThreadMessage = {
  id: string
  role: AgentMessageRole
  content: string
  createdAt: string
  status: AgentMessageStatus
  transcriptUuid?: string
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
