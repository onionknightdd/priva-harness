import { isAbsoluteFilePath, normalizeFilePath } from "@/lib/file-path"

import type { StreamBlock } from "./agent-message-data"
import { isImageFilePath } from "./file-read-view"

export type ImageToolBlock = Extract<StreamBlock, { type: "tool_use" }>

export function imageToolInput(block: ImageToolBlock): Record<string, unknown> {
  return { ...inputRecord(block.input), ...inputRecord(block.tool?.input) }
}

export function imageToolString(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  return typeof value === "string" ? value.trim() : ""
}

export function imageOutputPath(output: string | undefined): string {
  const path = output?.trim() ?? ""
  if (/[\r\n]/.test(path) || !isAbsoluteFilePath(path) || !isImageFilePath(path)) {
    return ""
  }
  return normalizeFilePath(path)
}

function inputRecord(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
}
