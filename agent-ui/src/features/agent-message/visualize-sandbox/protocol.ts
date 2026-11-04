export const VISUALIZE_SANDBOX_SOURCE = "visualize-sandbox"
export const VISUALIZE_HOST_SOURCE = "visualize-host"

export type VisualizeSandboxMessage =
  | { source: typeof VISUALIZE_SANDBOX_SOURCE; kind: "ready"; id: string }
  | { source: typeof VISUALIZE_SANDBOX_SOURCE; kind: "asset"; id: string; requestId: string; path: string }
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
  if (record.kind === "ready") return true
  if (record.kind === "asset") {
    return typeof record.requestId === "string" && record.requestId.length > 0 && record.requestId.length <= 128
      && typeof record.path === "string" && record.path.length > 0 && record.path.length <= 4096
  }
  return false
}
