import type { TFunction } from "i18next"

import type { AgentThreadMessage } from "./agent-message-data"
import {
  countPhrasePieces,
  joinStatusText,
  type StatusPiece,
} from "./status-pieces"
import { toolActivityClauses } from "./tool-activity"

export function processStatusPieces(
  message: AgentThreadMessage,
  isStreaming: boolean,
  t: TFunction,
  elapsedLabel: string
): StatusPiece[] {
  const blocks = [...(message.blocks ?? [])].sort(
    (left, right) => left.index - right.index
  )
  const pieces: StatusPiece[] = [
    { id: "elapsed", text: elapsedLabel, steady: true },
  ]
  const separator = t("agentMessage.toolSummary.separator")
  const background = blocks.filter(
    (block) =>
      block.type === "tool_use" &&
      block.tool?.backgroundTask &&
      ["pending", "running", "paused"].includes(block.tool.backgroundTask.status)
  ).length
  if (background && !isStreaming) {
    if (separator) pieces.push({ id: "background:sep", text: separator })
    pieces.push(...countPhrasePieces(t, "backgroundTasks.count", background, "background"))
    return pieces
  }
  for (const clause of toolActivityClauses(blocks)) {
    if (separator) pieces.push({ id: `${clause.id}:sep`, text: separator })
    pieces.push(
      ...countPhrasePieces(t, clause.labelKey, clause.count, clause.id)
    )
  }
  return pieces
}

export function formatProcessStatusText(
  message: AgentThreadMessage,
  isStreaming: boolean,
  t: TFunction,
  elapsedLabel: string
): string {
  return joinStatusText(processStatusPieces(message, isStreaming, t, elapsedLabel))
}
