import type { AgentThreadMessage, NestedAgent, StreamBlock } from "./agent-message-data"
import type { WorkflowStatus } from "./workflow-data"
import type { BackgroundTask, TaskNotification } from "./background-task-store"

export type AgentToolView = {
  backgroundTask?: BackgroundTask
  notifications: TaskNotification[]
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

/** A notification can live in a later turn while its Agent view belongs to the launch tool. */
export function agentToolsForThread(messages: readonly AgentThreadMessage[]): AgentToolView[] {
  const notifications = messages.flatMap((message) => (message.blocks ?? []).flatMap((block) =>
    block.type === "task_notification" ? [block.notification] : []))
  return messages.flatMap(agentToolsForMessage).map((agent) => ({ ...agent,
    notifications: notifications.filter((notification) => notification.task.toolUseId === agent.id ||
      notification.task.taskId === agent.backgroundTask?.taskId),
  }))
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
      const task = tool?.backgroundTask
      const blocks = agent?.blocks ?? []
      const state: WorkflowStatus = task ? task.status === "paused" ? "running" : task.status
        : agent?.status === "failed" || agent?.status === "cancelled" ? agent.status
        : tool?.ok === false ? "failed"
        : agent?.status === "completed" ? "completed"
        : tool?.status === "completed" && tool.launchStatus !== "async_launched" ? "completed"
        : agent?.status === "running" || message.status === "streaming" ? "running" : "unknown"
      return [{ id, label: field("description") ?? field("name") ?? agent?.name ?? field("subagent_type") ?? "Agent",
        type: field("subagent_type"), model: field("model"), agentId: agent?.agentId ?? tool?.agentId,
        backgroundTask: task,
        notifications: (message.blocks ?? []).flatMap((block) => block.type === "task_notification" &&
          (block.notification.task.toolUseId === id || block.notification.task.taskId === task?.taskId) ? [block.notification] : []),
        tokens: task?.tokens ?? tool?.tokens, durationMs: task?.durationMs ?? tool?.durationMs,
        state, prompt: field("prompt"),
        output: task ? task.result ?? undefined : tool?.status === "completed" && tool.launchStatus !== "async_launched" ? tool.output : undefined,
        blocks, inbox: agent?.inbox ?? [], toolCount: blocks.filter((block) => block.type === "tool_use" && block.name.toLowerCase() !== "structuredoutput").length,
      }]
    })
}
