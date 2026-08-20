export type ChatRole = "user" | "assistant"

export type ChatMessageStatus = "streaming" | "complete"

export type ChatMessage = {
  id: string
  role: ChatRole
  content: string
  createdAt: string
  status: ChatMessageStatus
}

export function createChatMessage(
  role: ChatRole,
  content: string,
  status: ChatMessageStatus = "complete"
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
    status,
  }
}
