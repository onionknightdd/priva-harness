import type { SessionTranscriptMessage } from "@/lib/api/sandbox-sessions"

import type { AgentThreadMessage } from "@/features/agent-message/agent-message-data"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return ""
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part
      }

      if (!isRecord(part)) {
        return ""
      }

      if (typeof part.text === "string") {
        return part.text
      }

      if (typeof part.content === "string") {
        return part.content
      }

      return ""
    })
    .filter((part) => part.trim() !== "")
    .join("\n")
}

function textFromSessionMessage(message: unknown): string {
  if (typeof message === "string") {
    return message
  }

  if (!isRecord(message)) {
    return ""
  }

  const fromContent = textFromContent(message.content)
  if (fromContent.trim() !== "") {
    return fromContent
  }

  if (typeof message.text === "string") {
    return message.text
  }

  if (typeof message.summary === "string") {
    return message.summary
  }

  return ""
}

export function threadMessagesFromTranscript(
  messages: readonly SessionTranscriptMessage[]
): AgentThreadMessage[] {
  return messages.flatMap((item) => {
    if (item.type !== "user" && item.type !== "assistant") {
      return []
    }

    const content = textFromSessionMessage(item.message).trim()
    if (content === "") {
      return []
    }

    return [
      {
        id: item.uuid || crypto.randomUUID(),
        role: item.type,
        content,
        createdAt: new Date().toISOString(),
        status: "complete" as const,
      },
    ]
  })
}
