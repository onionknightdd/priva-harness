import type { TFunction } from "i18next"

import type { StreamBlock } from "./agent-message-data"
import {
  countPhrasePieces,
  type StatusPiece,
} from "./status-pieces"
import { toolActivityClauses } from "./tool-activity"

export function processActivityPieces(
  blocks: readonly StreamBlock[],
  isStreaming: boolean,
  t: TFunction
): StatusPiece[] {
  const pieces: StatusPiece[] = []
  const separator = t("agentMessage.toolSummary.separator")
  if (!isStreaming) {
    const background = blocks.filter(
      (block) =>
        block.type === "tool_use" &&
        block.tool?.backgroundTask &&
        ["pending", "running", "paused"].includes(block.tool.backgroundTask.status)
    ).length
    if (background) {
      if (separator) pieces.push({ id: "background:sep", text: separator })
      pieces.push(...countPhrasePieces(t, "backgroundTasks.count", background, "background"))
      return pieces
    }
  }
  for (const clause of toolActivityClauses(blocks)) {
    if (separator) pieces.push({ id: `${clause.id}:sep`, text: separator })
    pieces.push(
      ...countPhrasePieces(t, clause.labelKey, clause.count, clause.id)
    )
  }
  return pieces
}

/** Text and tool output stream independently of the fields used by the summary. */
export function sameProcessActivity(
  previous: readonly StreamBlock[],
  next: readonly StreamBlock[]
): boolean {
  if (previous === next) return true
  let left = 0
  let right = 0
  while (left < previous.length || right < next.length) {
    while (left < previous.length && previous[left].type !== "tool_use") left++
    while (right < next.length && next[right].type !== "tool_use") right++
    const before = previous[left++]
    const after = next[right++]
    if (before === after) continue
    if (before?.type !== "tool_use" || after?.type !== "tool_use") return false
    if (before.name !== after.name ||
      before.tool?.status !== after.tool?.status ||
      before.tool?.launchStatus !== after.tool?.launchStatus ||
      before.tool?.backgroundTask?.status !== after.tool?.backgroundTask?.status) return false
  }
  return true
}
