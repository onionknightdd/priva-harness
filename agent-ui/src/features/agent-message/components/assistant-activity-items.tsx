import type { ReactNode } from "react"

import type { AgentActivityItem } from "@/components/agents/agent-activity"

import type {
  NestedAgent,
  StreamBlock,
  ToolCard,
  WorkflowCard,
  AgentThreadMessage,
} from "../agent-message-data"

type Translate = (key: string, options?: { count: number }) => string

export function assistantHasProcess(message: AgentThreadMessage): boolean {
  if ((message.nestedAgents?.length ?? 0) > 0) {
    return true
  }
  if ((message.workflows?.length ?? 0) > 0) {
    return true
  }
  return (message.blocks ?? []).some((block) => {
    if (block.type === "tool_use" || block.type === "image") {
      return true
    }
    return block.type === "thinking" && block.text.trim() !== ""
  })
}

export function assistantProcessCount(message: AgentThreadMessage): number {
  const blocks = message.blocks ?? []
  const thinking =
    blocks.some((block) => block.type === "thinking" && block.text.trim() !== "")
      ? 1
      : 0
  const images = blocks.filter((block) => block.type === "image").length
  const tools = blocks.filter((block) => block.type === "tool_use").length
  return (
    thinking +
    images +
    tools +
    (message.nestedAgents?.length ?? 0) +
    (message.workflows?.length ?? 0)
  )
}

export function buildAssistantActivityItems(
  message: AgentThreadMessage,
  t: Translate
): AgentActivityItem[] {
  const items: AgentActivityItem[] = []
  const blocks = [...(message.blocks ?? [])].sort(
    (left, right) => left.index - right.index
  )

  for (const block of blocks) {
    if (block.type === "thinking" && block.text.trim() !== "") {
      items.push({
        id: block.blockId,
        type: "text",
        content: (
          <p className="whitespace-pre-wrap">{block.text}</p>
        ),
      })
      continue
    }

    if (block.type === "image") {
      const imageItem = imageActivityItem(block, t)
      if (imageItem !== undefined) {
        items.push(imageItem)
      }
      continue
    }

    if (block.type === "tool_use") {
      items.push(...toolActivityItems(block, t))
    }
  }

  for (const agent of message.nestedAgents ?? []) {
    items.push(...nestedAgentActivityItems(agent, t))
  }

  for (const workflow of message.workflows ?? []) {
    items.push(workflowActivityItem(workflow, t))
  }

  return items
}

function imageActivityItem(
  image: Extract<StreamBlock, { type: "image" }>,
  t: Translate
): AgentActivityItem | undefined {
  // `tool`/`trace` rows truncate their detail chip, so images go in a `text` item.
  const src =
    image.url ??
    (image.b64 === undefined
      ? undefined
      : `data:${image.mime ?? "image/png"};base64,${image.b64}`)
  if (src === undefined) {
    return undefined
  }

  const caption = image.alt || t("agentMessage.generatedImage")

  return {
    id: image.blockId,
    type: "text",
    content: (
      <figure className="flex flex-col gap-2">
        <img
          alt={image.alt ?? ""}
          src={src}
          className="max-h-72 max-w-full rounded-lg border border-border/60"
        />
        <figcaption className="text-xs">{caption}</figcaption>
      </figure>
    ),
  }
}

function toolActivityItems(
  block: Extract<StreamBlock, { type: "tool_use" }>,
  t: Translate
): AgentActivityItem[] {
  const tool = block.tool
  const items: AgentActivityItem[] = [
    {
      id: block.id,
      type: "tool",
      action: toolAction(block.name),
      target: block.name,
    },
  ]

  const statusText = toolStatusText(tool, t)
  if (statusText !== undefined) {
    items.push({
      id: `${block.id}-status`,
      type: "text",
      content: statusText,
    })
  }

  if (tool?.output) {
    items.push({
      id: `${block.id}-output`,
      type: "text",
      content: (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">
          {tool.output}
        </pre>
      ),
    })
  }

  return items
}

function nestedAgentActivityItems(
  agent: NestedAgent,
  t: Translate
): AgentActivityItem[] {
  const running = agent.status === "running"
  const items: AgentActivityItem[] = [
    {
      id: agent.parentToolUseId,
      type: "step",
      label: t("agentMessage.nestedAgent"),
      status: running ? "active" : "complete",
      meta: running
        ? t("agentMessage.runInBackground")
        : (agent.name ?? agent.agentId ?? agent.parentToolUseId),
    },
  ]

  const text = agent.blocks
    .filter((block) => block.type === "text")
    .sort((left, right) => left.index - right.index)
    .map((block) => block.text)
    .join("")
  if (text) {
    items.push({
      id: `${agent.parentToolUseId}-text`,
      type: "text",
      content: <p className="whitespace-pre-wrap">{text}</p>,
    })
  }

  if (agent.inbox.length > 0) {
    items.push({
      id: `${agent.parentToolUseId}-inbox`,
      type: "search",
      query: t("agentMessage.nestedAgent"),
      results: agent.inbox.map((item, index) => ({
        id: `${agent.parentToolUseId}-inbox-${index}`,
        title: item.body,
        domain:
          item.source === "coordinator"
            ? t("agentMessage.coordinatorMessage")
            : t("agentMessage.peerMessage"),
      })),
    })
  }

  const nestedTools = [...agent.blocks]
    .filter(
      (item): item is Extract<StreamBlock, { type: "tool_use" }> =>
        item.type === "tool_use"
    )
    .sort((left, right) => left.index - right.index)
  for (const block of nestedTools) {
    items.push(...toolActivityItems(block, t))
  }

  return items
}

function workflowActivityItem(
  workflow: WorkflowCard,
  t: Translate
): AgentActivityItem {
  const running =
    workflow.status !== "completed" &&
    workflow.status !== "complete" &&
    workflow.status !== "failed" &&
    workflow.status !== "error"

  return {
    id: workflow.workflowToolUseId,
    type: "step",
    label: workflow.name ?? t("agentMessage.workflow"),
    status: running ? "active" : "complete",
    meta: workflow.summary ?? workflow.status,
  }
}

function toolAction(name: string): "read" | "edit" | "run" {
  const normalized = name.toLowerCase()
  if (normalized.includes("read") || normalized.includes("view")) {
    return "read"
  }
  if (
    normalized.includes("edit") ||
    normalized.includes("write") ||
    normalized.includes("replace")
  ) {
    return "edit"
  }
  return "run"
}

function toolStatusText(tool: ToolCard | undefined, t: Translate): ReactNode {
  if (tool?.launchStatus === "async_launched") {
    return t("agentMessage.runInBackground")
  }
  if (tool?.status === "completed" && tool.ok === false) {
    return t("agentMessage.toolFailed")
  }
  return undefined
}
