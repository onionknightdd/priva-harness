export const VISUALIZE_SANDBOX_SOURCE = "visualize-sandbox"

export type VisualizeSandboxMessage =
  | {
      source: typeof VISUALIZE_SANDBOX_SOURCE
      kind: "resize"
      id: string
      height: number
    }
  | {
      source: typeof VISUALIZE_SANDBOX_SOURCE
      kind: "error"
      id: string
      message: string
    }

export function isVisualizeSandboxMessage(
  value: unknown
): value is VisualizeSandboxMessage {
  if (typeof value !== "object" || value === null) {
    return false
  }
  const record = value as Record<string, unknown>
  if (record.source !== VISUALIZE_SANDBOX_SOURCE) {
    return false
  }
  if (typeof record.id !== "string" || record.id === "") {
    return false
  }
  if (record.kind === "resize") {
    return typeof record.height === "number" && Number.isFinite(record.height)
  }
  if (record.kind === "error") {
    return typeof record.message === "string"
  }
  return false
}
