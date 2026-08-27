import type { TFunction } from "i18next"

import type { AgentThreadMessage } from "./agent-message-data"
import { formatToolActivitySummary } from "./tool-activity"

export function formatProcessStatusText(
  message: AgentThreadMessage,
  isStreaming: boolean,
  t: TFunction
): string {
  const blocks = [...(message.blocks ?? [])].sort(
    (left, right) => left.index - right.index
  )
  const summary = formatToolActivitySummary(blocks, t)
  const statusLabel = isStreaming
    ? t("agentMessage.thinking")
    : t("agentMessage.chainOfThought")
  if (summary === "") {
    return statusLabel
  }
  return `${statusLabel}${t("agentMessage.toolSummary.separator")}${summary}`
}
