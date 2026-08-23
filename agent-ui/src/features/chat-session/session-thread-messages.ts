import type { SessionTranscriptMessage } from "@/lib/api/sandbox-sessions"
import { sessionTimestampToMs } from "@/lib/relative-time"

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

    if (item.parentToolUseId) {
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
        createdAt: createdAtFromTranscript(item),
        status: "complete" as const,
        ...(item.uuid ? { transcriptUuid: item.uuid } : {}),
      },
    ]
  })
}

function createdAtFromTranscript(item: SessionTranscriptMessage): string {
  if (item.timestamp == null) {
    return new Date().toISOString()
  }

  const fromMs = sessionTimestampToMs(item.timestamp)
  if (fromMs === null) {
    return new Date().toISOString()
  }

  return new Date(fromMs).toISOString()
}
