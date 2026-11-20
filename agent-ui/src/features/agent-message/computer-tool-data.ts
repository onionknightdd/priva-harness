import type { StreamFrame } from "./run-stream-reducer"

const cuaJsTool = "mcp__cua_repl__js"
const TITLED_JS_TOOLS = new Set([cuaJsTool, "mcp__node_repl__js", "mcp__registered_computers__js"])
/** MCP servers whose tools operate a desktop. Their cards use the pointer icon. */
export const DESKTOP_MCP_SERVERS: readonly string[] = ["cua_repl", "registered_computers"]
// Only the documented single-statement selections identify a native app without
// evaluating JavaScript or guessing which surface owns a persistent binding.
const selectNativeApp = /^(?:(?:let|const|var)\s+[\w$]+\s*=\s*)?await\s+cua\.getApp\(\s*(?:(["'])[^"'\\\r\n]+\1|\{\s*windowId\s*:\s*\d+\s*\})\s*\)\s*;?$/u
const launchNativeApp = /^await\s+cua\.computer\.launch_app\(\s*\{\s*app\s*:\s*(["'])[^"'\\\r\n]+\1\s*\}\s*\)\s*;?$/u

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

/** The model names each `js` call of the Computer Use plugin; the card shows that name once it is complete. */
export function replToolTitle(name: string, inputText: string | undefined): string | undefined {
  if (!TITLED_JS_TOOLS.has(name)) return undefined
  const title = completeArgs(inputText)?.title
  return typeof title === "string" ? title.trim() || undefined : undefined
}
