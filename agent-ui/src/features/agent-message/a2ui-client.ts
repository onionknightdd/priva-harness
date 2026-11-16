import { AgentToRendererMessageSchema, type AgentToRendererMessage } from "@a2ui/web_core/v1_0"
import { z } from "zod-v3"

const outputSchema = z.object({
  format: z.literal("a2ui"),
  version: z.literal("1.0"),
  messages: z.array(AgentToRendererMessageSchema).nonempty(),
}).strict()

export function compiledA2uiMessages(output: unknown): AgentToRendererMessage[] {
  const parsed = outputSchema.parse(output)
  const messages = parsed.messages
  if (messages.filter((message) => "createSurface" in message).length !== 1) throw new Error("The dashboard must create exactly one surface.")
  for (const message of messages) {
    const operation = "createSurface" in message ? message.createSurface
      : "updateComponents" in message ? message.updateComponents
        : "updateDataModel" in message ? message.updateDataModel : null
    if (!operation || operation.surfaceId !== "main") throw new Error("The dashboard must use the main surface.")
  }
  return messages
}

// Complete blocks are immutable during streaming. Share their pure compilation across
// StrictMode/remounts, without retaining an unbounded history of conversation content.
const compiled = new Map<string, Promise<AgentToRendererMessage[]>>()
const MAX_CACHED_BLOCKS = 32
export function compileDashboard(source: string): Promise<AgentToRendererMessage[]> {
  const cached = compiled.get(source)
  if (cached) return cached
  const pending = requestCompilation(source)
  compiled.set(source, pending)
  if (compiled.size > MAX_CACHED_BLOCKS) compiled.delete(compiled.keys().next().value!)
  void pending.catch(() => { if (compiled.get(source) === pending) compiled.delete(source) })
  return pending
}

async function requestCompilation(source: string): Promise<AgentToRendererMessage[]> {
  const response = await fetch("/api/sandbox/a2ui/compile", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source }),
  })
  const result: unknown = await response.json()
  if (!response.ok) {
    const detail = result && typeof result === "object" && "error" in result ? result.error : undefined
    throw new Error(typeof detail === "string" && detail.trim() ? detail : `Dashboard compilation failed (${response.status}).`)
  }
  return compiledA2uiMessages(result)
}
