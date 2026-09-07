import type { AgentThreadMessage, NestedAgent, StreamBlock } from "./agent-message-data"
import type { WorkflowStatus } from "./workflow-data"

export type AgentToolView = {
  id: string
  label: string
  type?: string
  model?: string
  agentId?: string
  state: WorkflowStatus
  prompt?: string
  output?: string
  blocks: StreamBlock[]
  inbox: NestedAgent["inbox"]
  tokens?: number
  durationMs?: number
  toolCount: number
}

export function isAgentTool(name: string) {
  return ["agent", "task"].includes(name.trim().toLowerCase())
}

export function agentToolsForMessage(message: AgentThreadMessage): AgentToolView[] {
  const nested = message.nestedAgents ?? []
  const calls = [...(message.blocks ?? []), ...nested.flatMap((agent) => agent.blocks)]
    .filter((block): block is Extract<StreamBlock, { type: "tool_use" }> => block.type === "tool_use" && isAgentTool(block.name))
  const ids = new Set<string>()
  return [...calls.map((call) => ({ call, agent: nested.find((item) => item.parentToolUseId === call.id) })),
    ...nested.filter((agent) => !calls.some((call) => call.id === agent.parentToolUseId)).map((agent) => ({ call: undefined, agent }))]
    .flatMap(({ call, agent }) => {
      const id = call?.id ?? agent!.parentToolUseId
      if (ids.has(id)) return []
      ids.add(id)
      const raw = call?.tool?.input ?? call?.input
      const input = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {}
      const field = (key: string) => typeof input[key] === "string" ? input[key] as string : undefined
      const tool = call?.tool
      const blocks = agent?.blocks ?? []
      const state: WorkflowStatus = agent?.status === "failed" || agent?.status === "cancelled" ? agent.status
        : tool?.ok === false ? "failed"
        : agent?.status === "completed" ? "completed"
        : tool?.status === "completed" && tool.launchStatus !== "async_launched" ? "completed"
        : agent?.status === "running" || message.status === "streaming" ? "running" : "unknown"
      return [{ id, label: field("description") ?? field("name") ?? agent?.name ?? field("subagent_type") ?? "Agent",
        type: field("subagent_type"), model: field("model"), agentId: agent?.agentId ?? tool?.agentId,
        tokens: tool?.tokens, durationMs: tool?.durationMs,
        state, prompt: field("prompt"),
        output: tool?.status === "completed" && tool.launchStatus !== "async_launched" ? tool.output : undefined,
        blocks, inbox: agent?.inbox ?? [], toolCount: blocks.filter((block) => block.type === "tool_use" && block.name.toLowerCase() !== "structuredoutput").length,
      }]
    })
}
