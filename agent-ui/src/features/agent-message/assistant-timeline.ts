import { textFromBlocks, type AgentThreadMessage, type StreamBlock } from "./agent-message-data"
import type { TaskNotification } from "./background-task-store"

/** Notification boundaries keep each answer beside the delivery that prompted it. */
export function assistantTimeline(message: AgentThreadMessage) {
  const messageTools = new Set((message.blocks ?? []).flatMap((block) => block.type === "tool_use" ? [block.id] : []))
  const sections: { id: string; notification?: TaskNotification; blocks: StreamBlock[] }[] = [
    { id: message.id, blocks: [] },
  ]
  for (const block of [...(message.blocks ?? [])].sort((a, b) => a.index - b.index)) {
    if (block.type === "task_notification") sections.push({ id: block.blockId, notification: block.notification, blocks: [] })
    else sections.at(-1)!.blocks.push(block)
  }
  return sections.map((section, index) => {
    const tools = new Set(section.blocks.flatMap((block) => block.type === "tool_use" ? [block.id] : []))
    const nestedAgents = (message.nestedAgents ?? []).filter((agent) => tools.has(agent.parentToolUseId))
    const workflows = (message.workflows ?? []).filter((workflow) => tools.has(workflow.workflowToolUseId))
    return { id: section.id, notification: section.notification, message: {
      ...message, blocks: section.blocks,
      interactions: message.interactions?.filter((item) => item.request.toolUseId && messageTools.has(item.request.toolUseId) ? tools.has(item.request.toolUseId) : index === 0),
      content: sections.length === 1 && !section.blocks.length ? message.content : textFromBlocks(section.blocks),
      nestedAgents: sections.length === 1 ? message.nestedAgents : nestedAgents,
      workflows: sections.length === 1 ? message.workflows : workflows,
      status: index === sections.length - 1 ? message.status : "complete",
    } as AgentThreadMessage }
  })
}
