import type { AgentThreadMessage } from "@/features/agent-message/agent-message-data"

type ThreadApiMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt: string
  status: "streaming" | "complete" | "error"
  transcriptUuid?: string
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
  }))
}
