import type { FileReadView } from "@/components/agents/file-read"

const IMAGE_PATH = /\.(png|jpe?g|gif|webp|bmp|svg)$/i

export function isImageFilePath(path: string | undefined): boolean {
  if (path === undefined) {
    return false
  }
  const trimmed = path.trim()
  if (trimmed === "") {
    return false
  }
  return IMAGE_PATH.test(trimmed)
}

export function parseFileReadOutput(
  output: string | undefined
): FileReadView | undefined {
  if (output === undefined) {
    return undefined
  }
  const trimmed = output.trim()
  if (trimmed === "") {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>
      if (record["$read"] === "text" && typeof record.content === "string") {
        return {
          kind: "text",
          content: record.content,
          startLine:
            typeof record.startLine === "number" &&
            Number.isFinite(record.startLine)
              ? record.startLine
              : 1,
        }
      }
      if (record["$read"] === "image" && typeof record.b64 === "string") {
        if (record.b64 === "") {
          return undefined
        }
        return {
          kind: "image",
          mime: typeof record.mime === "string" ? record.mime : "image/png",
          b64: record.b64,
          ...(typeof record.width === "number" ? { width: record.width } : {}),
          ...(typeof record.height === "number"
            ? { height: record.height }
            : {}),
        }
      }
    }
  } catch {
    // Older sessions stored Read output as plain text.
  }
  return { kind: "text", content: output, startLine: 1 }
}
