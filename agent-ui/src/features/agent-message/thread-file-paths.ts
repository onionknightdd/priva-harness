import { looksLikeFilePath, resolveAgainstCwd } from "@/lib/file-path"

import type { AgentThreadMessage } from "./agent-message-data"

const FENCED_BLOCK = /```[\s\S]*?```/g
const INLINE_CODE = /`([^`\n]+)`/g
const TOOL_PATH_KEYS = ["file_path", "path", "notebook_path"] as const

/**
 * Paths the transcript will render as file references: inline code spans
 * that look like paths (see AssistantMarkdownCode) and the file arguments
 * of tool calls (see ToolFileName). Resolving them before the turns mount
 * lets every reference render in its final form instead of settling later.
 */
export function collectThreadFilePaths(
  messages: readonly AgentThreadMessage[],
  cwd: string
): string[] {
  const paths = new Set<string>()
  const add = (raw: string) => {
    const text = raw.trim()
    if (text !== "" && looksLikeFilePath(text)) {
      paths.add(resolveAgainstCwd(text, cwd))
    }
  }

  for (const message of messages) {
    if (message.role !== "assistant") continue
    const texts = message.blocks?.length
      ? message.blocks.flatMap((block) => (block.type === "text" ? [block.text] : []))
      : [message.content]
    for (const text of texts) {
      for (const match of text.replace(FENCED_BLOCK, "").matchAll(INLINE_CODE)) {
        add(match[1] ?? "")
      }
    }
    for (const block of message.blocks ?? []) {
      if (block.type !== "tool_use" || typeof block.input !== "object" || block.input === null) continue
      for (const key of TOOL_PATH_KEYS) {
        const value = (block.input as Record<string, unknown>)[key]
        if (typeof value === "string") add(value)
      }
    }
  }

  return [...paths]
}
