import type { McpToolName } from "./mcp-tool-data"
import type { StreamFrame } from "./run-stream-reducer"

const cuaJsTool = "mcp__cua_repl__js"
// Only the documented single-statement selections identify a native app without
// evaluating JavaScript or guessing which surface owns a persistent binding.
const selectNativeApp = /^(?:(?:let|const|var)\s+[\w$]+\s*=\s*)?await\s+cua\.getApp\(\s*(?:(["'])[^"'\\\r\n]+\1|\{\s*windowId\s*:\s*\d+\s*\})\s*\)\s*;?$/u
const launchNativeApp = /^await\s+cua\.computer\.launch_app\(\s*\{\s*app\s*:\s*(["'])[^"'\\\r\n]+\1\s*\}\s*\)\s*;?$/u

export function isLiveComputerToolStart(frame: StreamFrame): boolean {
  if (frame.type !== "tool.started" || frame.replay || typeof frame.name !== "string") return false
  const [prefix, serverName, ...toolName] = frame.name.trim().split("__")
  return prefix.toLowerCase() === "mcp" && serverName === "computer" && Boolean(toolName.at(-1)?.trim())
}

export function isLiveCuaAppSelection(frame: StreamFrame, pending: Set<string>): boolean {
  if (frame.type === "session.snapshot") pending.clear()
  if (!frame.id || frame.replay) return false
  if (frame.type === "tool.completed") pending.delete(frame.id)
  if (frame.name !== cuaJsTool) return false
  if (frame.type === "tool.started") pending.add(frame.id)
  else if (frame.type !== "tool.updated") return false
  if (!pending.has(frame.id) || typeof frame.input !== "object" || !frame.input || !("code" in frame.input)) return false
  const code = frame.input.code
  if (typeof code !== "string" || !(selectNativeApp.test(code.trim()) || launchNativeApp.test(code.trim()))) return false
  pending.delete(frame.id)
  return true
}

function completeArgs(inputText: string | undefined): Record<string, unknown> | undefined {
  if (!inputText) return undefined
  try {
    const input: unknown = JSON.parse(inputText)
    if (typeof input === "object" && input !== null && !Array.isArray(input)) return input as Record<string, unknown>
  } catch {
    // Streaming input can end inside a JSON token.
  }
  return undefined
}

export function cuaToolTitle(name: string, inputText: string | undefined, succeeded: boolean): string | undefined {
  if (name !== cuaJsTool) return undefined
  const args = completeArgs(inputText)
  const label = succeeded && typeof args?.completion_summary === "string" ? args.completion_summary : args?.title
  return typeof label === "string" ? label.trim() || undefined : undefined
}

export function computerToolTitleKey(name: McpToolName, inputText: string | undefined): string | null {
  if (name.serverName !== "computer") return null
  const baseKey = `computerTool.names.${name.toolName}`
  const args = completeArgs(inputText)
  if (!args) return baseKey

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
