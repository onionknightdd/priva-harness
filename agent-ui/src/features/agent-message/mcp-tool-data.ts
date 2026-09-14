import type { StreamBlock } from "./agent-message-data"
import { isCanvasTool } from "./canvas-html"
import { isImageEditTool, isImageGenTool, isImageReadTool } from "./image-tools"
import { isVisualizeTool } from "./visualize-jsx"

export type McpToolName = { serverName: string; toolName: string }

export function externalMcpToolName(name: string): McpToolName | null {
  if (isCanvasTool(name) || isVisualizeTool(name) || isImageGenTool(name) || isImageReadTool(name) || isImageEditTool(name)) return null
  const parts = name.trim().split("__")
  const serverName = parts[1]
  const toolName = parts.at(-1)
  if (parts.length < 3 || parts[0].toLowerCase() !== "mcp" || !serverName?.trim() || !toolName?.trim()) return null
  return { serverName, toolName }
}

export function mcpToolInputText(block: Extract<StreamBlock, { type: "tool_use" }>): string | undefined {
  const raw = block.tool?.inputRaw
  if (raw) {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2)
    } catch {
      // Input deltas can end inside a JSON token; show that partial input verbatim.
      return raw
    }
  }
  const input = block.tool?.input !== undefined ? block.tool.input : block.input
  return typeof input === "string" ? input : JSON.stringify(input, null, 2)
}
