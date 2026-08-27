import type { TFunction } from "i18next"

import type { StreamBlock, ToolCard } from "./agent-message-data"
import { isVisualizeTool } from "./visualize-jsx"

export type ToolActivityKind = "read" | "edit" | "write" | "bash" | "other"

export type ToolActivityCounts = Record<
  ToolActivityKind,
  { running: number; completed: number }
>

const KIND_ORDER: readonly ToolActivityKind[] = [
  "read",
  "edit",
  "write",
  "bash",
  "other",
]

const RUNNING_KEYS: Record<ToolActivityKind, { one: string; many: string }> = {
  read: {
    one: "agentMessage.toolSummary.runningReadOne",
    many: "agentMessage.toolSummary.runningReadMany",
  },
  edit: {
    one: "agentMessage.toolSummary.runningEditOne",
    many: "agentMessage.toolSummary.runningEditMany",
  },
  write: {
    one: "agentMessage.toolSummary.runningWriteOne",
    many: "agentMessage.toolSummary.runningWriteMany",
  },
  bash: {
    one: "agentMessage.toolSummary.runningBashOne",
    many: "agentMessage.toolSummary.runningBashMany",
  },
  other: {
    one: "agentMessage.toolSummary.runningOtherOne",
    many: "agentMessage.toolSummary.runningOtherMany",
  },
}

const DONE_KEYS: Record<ToolActivityKind, { one: string; many: string }> = {
  read: {
    one: "agentMessage.toolSummary.doneReadOne",
    many: "agentMessage.toolSummary.doneReadMany",
  },
  edit: {
    one: "agentMessage.toolSummary.doneEditOne",
    many: "agentMessage.toolSummary.doneEditMany",
  },
  write: {
    one: "agentMessage.toolSummary.doneWriteOne",
    many: "agentMessage.toolSummary.doneWriteMany",
  },
  bash: {
    one: "agentMessage.toolSummary.doneBashOne",
    many: "agentMessage.toolSummary.doneBashMany",
  },
  other: {
    one: "agentMessage.toolSummary.doneOtherOne",
    many: "agentMessage.toolSummary.doneOtherMany",
  },
}

export function isBashTool(name: string): boolean {
  const id = name.trim().toLowerCase()
  return id === "bash" || id === "shell"
}

export function isWriteTool(name: string): boolean {
  return name.trim().toLowerCase() === "write"
}

export function isEditTool(name: string): boolean {
  return name.trim().toLowerCase() === "edit"
}

export function isReadTool(name: string): boolean {
  return name.trim().toLowerCase() === "read"
}

export function isToolRunning(tool: ToolCard | undefined): boolean {
  if (tool?.launchStatus === "async_launched") {
    return true
  }
  return tool?.status !== "completed"
}

export function toolItemStatusLabel(
  name: string,
  running: boolean,
  t: TFunction
): string {
  if (isVisualizeTool(name)) {
    return t(
      running
        ? "agentMessage.toolItem.visualizeRunning"
        : "agentMessage.toolItem.visualizeDone"
    )
  }
  const kind = classifyToolName(name)
  if (kind === "other") {
    return t(
      running
        ? "agentMessage.toolItem.otherRunning"
        : "agentMessage.toolItem.otherDone",
      { name }
    )
  }
  return t(
    running
      ? `agentMessage.toolItem.${kind}Running`
      : `agentMessage.toolItem.${kind}Done`
  )
}

export function classifyToolName(name: string): ToolActivityKind {
  if (isReadTool(name)) return "read"
  if (isEditTool(name)) return "edit"
  if (isWriteTool(name)) return "write"
  if (isBashTool(name)) return "bash"
  return "other"
}

function emptyToolActivityCounts(): ToolActivityCounts {
  return {
    read: { running: 0, completed: 0 },
    edit: { running: 0, completed: 0 },
    write: { running: 0, completed: 0 },
    bash: { running: 0, completed: 0 },
    other: { running: 0, completed: 0 },
  }
}

export function countToolActivity(
  blocks: readonly StreamBlock[]
): ToolActivityCounts {
  const counts = emptyToolActivityCounts()
  for (const block of blocks) {
    if (block.type !== "tool_use") continue
    const kind = classifyToolName(block.name)
    if (isToolRunning(block.tool)) {
      counts[kind].running += 1
    } else {
      counts[kind].completed += 1
    }
  }
  return counts
}

export function formatToolActivitySummary(
  blocks: readonly StreamBlock[],
  t: TFunction
): string {
  const counts = countToolActivity(blocks)
  const parts: string[] = []
  for (const kind of KIND_ORDER) {
    const running = counts[kind].running
    if (running > 0) {
      parts.push(t(countKey(RUNNING_KEYS[kind], running), { count: running }))
    }
  }
  for (const kind of KIND_ORDER) {
    const completed = counts[kind].completed
    if (completed > 0) {
      parts.push(t(countKey(DONE_KEYS[kind], completed), { count: completed }))
    }
  }
  return parts.join(t("agentMessage.toolSummary.separator"))
}

function countKey(
  keys: { one: string; many: string },
  count: number
): string {
  return count === 1 ? keys.one : keys.many
}
