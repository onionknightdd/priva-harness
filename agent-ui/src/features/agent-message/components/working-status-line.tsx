import { useTranslation } from "react-i18next"

import { ActionSwapRollText } from "@/components/motion/action-swap-roll"

import type { AgentThreadMessage } from "../agent-message-data"
import { formatProcessStatusText } from "../process-status"

export function WorkingStatusLine({
  message,
}: {
  message: AgentThreadMessage
}) {
  const { t } = useTranslation()
  const statusText = formatProcessStatusText(message, true, t)

  return (
    <div
      data-slot="working-status-line"
      className="flex w-full min-w-0 pl-1.5"
    >
      <div className="flex max-w-full min-w-0 items-center py-0.5 text-left text-ui leading-snug font-medium text-muted-foreground/70">
        {/* Same roll as tool-card titles, so "Running…" → "Reading 2 files"
            reads as one status updating rather than text being replaced. The
            shimmer sits inside the rolling layer so its text clip survives. */}
        <ActionSwapRollText value={statusText} className="max-w-full">
          <span className="shimmer">{statusText}</span>
        </ActionSwapRollText>
      </div>
    </div>
  )
}
