import { AgentToRendererMessageSchema } from "@a2ui/web_core/v1_0"
import { z } from "zod-v3"

import type { ToolCard } from "./agent-message-data"

const outputSchema = z.object({
  format: z.literal("a2ui"),
  version: z.literal("1.0"),
  messages: z.array(AgentToRendererMessageSchema).nonempty(),
}).strict()

export function isGeneratedVisualTool(name: string): boolean {
  return /^(?:mcp__[a-z0-9_-]+__)?render_ui$/.test(name.trim().toLowerCase())
}

/** A rejected tool attempt is process history, not a generated answer. */
export function isFailedGeneratedVisual(block: { name: string; tool?: Pick<ToolCard, "status" | "ok"> }): boolean {
  return isGeneratedVisualTool(block.name) && block.tool?.status === "completed" && block.tool.ok === false
}

/** Input is model source, never a renderable result. Only consume successful canonical output. */
export function a2uiMessagesFromTool(tool: Pick<ToolCard, "output" | "ok" | "status"> | undefined) {
  if (tool?.status !== "completed" || tool.ok !== true || !tool.output) return null
  try {
    const parsed = outputSchema.safeParse(JSON.parse(tool.output))
    if (!parsed.success) return null
    const messages = parsed.data.messages
    if (messages.filter((message) => "createSurface" in message).length !== 1) return null
    for (const message of messages) {
      const operation = "createSurface" in message ? message.createSurface
        : "updateComponents" in message ? message.updateComponents
          : "updateDataModel" in message ? message.updateDataModel : null
      if (!operation || operation.surfaceId !== "main") return null
    }
    return messages
  } catch {
    return null
  }
}
