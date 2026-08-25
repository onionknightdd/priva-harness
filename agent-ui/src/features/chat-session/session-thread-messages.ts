import type { SessionTranscriptMessage } from "@/lib/api/sandbox-sessions"
import { sessionTimestampToMs } from "@/lib/relative-time"

import type {
  AgentThreadMessage,
  NestedAgent,
  StreamBlock,
} from "@/features/agent-message/agent-message-data"
import { textFromBlocks } from "@/features/agent-message/agent-message-data"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function blocksFromContent(content: unknown): StreamBlock[] {
  if (typeof content === "string") {
    return content === ""
      ? []
      : [{ type: "text", blockId: "0", index: 0, text: content }]
  }
  if (!Array.isArray(content)) {
    return []
  }
  const blocks: StreamBlock[] = []
  content.forEach((part, index) => {
    if (typeof part === "string") {
      blocks.push({ type: "text", blockId: String(index), index, text: part })
      return
    }
    if (!isRecord(part)) {
      return
    }
    const type = part.type
    if (type === "text" || typeof part.text === "string") {
      const text = typeof part.text === "string" ? part.text : String(part.content ?? "")
      if (text.trim() === "") {
        return
      }
      blocks.push({ type: "text", blockId: String(index), index, text })
      return
    }
    if (type === "thinking") {
      blocks.push({
        type: "thinking",
        blockId: String(index),
        index,
        text: String(part.thinking ?? part.text ?? ""),
      })
      return
    }
    if (type === "image" || type === "image_url") {
      blocks.push({
        type: "image",
        blockId: String(index),
        index,
        ...(typeof part.url === "string" ? { url: part.url } : {}),
        ...(typeof part.alt === "string" ? { alt: part.alt } : {}),
      })
      return
    }
    if (type === "tool_use") {
      const id = String(part.id ?? index)
      blocks.push({
        type: "tool_use",
        blockId: id,
        index,
        id,
        name: String(part.name ?? "unknown"),
        ...(part.input === undefined ? {} : { input: part.input }),
      })
    }
  })
  return blocks
}

function isToolResultMessage(message: unknown): boolean {
  if (!isRecord(message)) {
    return false
  }
  const content = message.content
  if (!Array.isArray(content)) {
    return false
  }
  return content.some((part) => isRecord(part) && part.type === "tool_result")
}

export function threadMessagesFromTranscript(
  messages: readonly SessionTranscriptMessage[]
): AgentThreadMessage[] {
  const nestedByParent = new Map<string, NestedAgent>()
  const mains: AgentThreadMessage[] = []

  for (const item of messages) {
    if (item.type !== "user" && item.type !== "assistant") {
      continue
    }

    if (item.parentToolUseId) {
      if (item.type === "user" && isToolResultMessage(item.message)) {
        continue
      }
      if (item.type === "user") {
        continue
      }
      const blocks = blocksFromContent(isRecord(item.message) ? item.message.content : item.message)
      const existing = nestedByParent.get(item.parentToolUseId)
      if (existing === undefined) {
        nestedByParent.set(item.parentToolUseId, {
          parentToolUseId: item.parentToolUseId,
          status: "completed",
          blocks,
          inbox: [],
        })
      } else {
        nestedByParent.set(item.parentToolUseId, {
          ...existing,
          blocks: [...existing.blocks, ...blocks],
        })
      }
      continue
    }

    if (item.type === "user" && isToolResultMessage(item.message)) {
      continue
    }

    const blocks = blocksFromContent(isRecord(item.message) ? item.message.content : item.message)
    const content = textFromBlocks(blocks).trim()
    if (content === "" && !blocks.some((block) => block.type === "tool_use" || block.type === "image")) {
      continue
    }

    mains.push({
      id: item.uuid || crypto.randomUUID(),
      role: item.type,
      content,
      createdAt: createdAtFromTranscript(item),
      status: "complete",
      ...(item.uuid ? { transcriptUuid: item.uuid } : {}),
      ...(item.type === "assistant" ? { blocks } : {}),
    })
  }

  return mains.map((message) => {
    if (message.role !== "assistant" || message.blocks === undefined) {
      return message
    }
    const nestedAgents = message.blocks.flatMap((block) => {
      if (block.type !== "tool_use") {
        return []
      }
      const nested = nestedByParent.get(block.id)
      return nested === undefined ? [] : [nested]
    })
    return nestedAgents.length === 0 ? message : { ...message, nestedAgents }
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
