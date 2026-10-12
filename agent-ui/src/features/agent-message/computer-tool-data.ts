import type { McpToolName } from "./mcp-tool-data"
import type { StreamFrame } from "./run-stream-reducer"

export function isLiveComputerToolStart(frame: StreamFrame): boolean {
  if (frame.type !== "tool.started" || frame.replay || typeof frame.name !== "string") return false
  const [prefix, serverName, ...toolName] = frame.name.trim().split("__")
  return prefix.toLowerCase() === "mcp" && serverName === "computer" && Boolean(toolName.at(-1)?.trim())
}

export function computerToolTitleKey(name: McpToolName, inputText: string | undefined): string | null {
  if (name.serverName !== "computer") return null
  const baseKey = `computerTool.names.${name.toolName}`
  if (!inputText) return baseKey

  let input: unknown
  try {
    input = JSON.parse(inputText)
  } catch {
    // Streaming arguments may not be complete enough to name the specific action yet.
    return baseKey
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) return baseKey
  const args = input as Record<string, unknown>

  if (name.toolName === "set_agent_cursor_enabled" && typeof args.enabled === "boolean") {
    return `computerTool.actions.cursor_${args.enabled ? "show" : "hide"}`
  }
  if (name.toolName === "browser_dialog" && typeof args.action === "string"
    && ["inspect", "accept", "dismiss"].includes(args.action)) {
    return `computerTool.actions.dialog_${args.action}`
  }
  if (name.toolName === "browser_pointer" && typeof args.action === "string"
    && ["hover", "right_click", "double_click", "scroll", "drag"].includes(args.action)) {
    return `computerTool.actions.pointer_${args.action}`
  }
  if ((name.toolName === "install_ffmpeg" || name.toolName === "install_extension")
    && (args.confirm === undefined || typeof args.confirm === "boolean")) {
    const extension = name.toolName === "install_extension" ? "extension" : "ffmpeg"
    return `computerTool.actions.${extension}_${args.confirm === true ? "install" : "preview"}`
  }
  return baseKey
}
