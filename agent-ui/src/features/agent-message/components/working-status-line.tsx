import { useTranslation } from "react-i18next"

import { LiveTextScope, StableText } from "@/components/motion/stable-text"
import { LoadingState } from "@/components/ui/loading-state"

import type { AgentThreadMessage } from "../agent-message-data"
import { useProcessElapsedLabel } from "../process-elapsed"
import { processStatusPieces } from "../process-status"

export function WorkingStatusLine({
  message,
}: {
  message: AgentThreadMessage
}) {
  const { t } = useTranslation()
  const elapsedLabel = useProcessElapsedLabel(message, true, t)
  const pieces = processStatusPieces(message, true, t, elapsedLabel)

  return (
    <div
      data-slot="working-status-line"
      className="flex w-full min-w-0 pl-1.5"
    >
      <div className="flex max-w-full min-w-0 items-center gap-2 py-0.5 text-left text-ui leading-snug font-medium text-muted-foreground/70">
        <LoadingState />
        <LiveTextScope>
          <StableText pieces={pieces} shimmer className="whitespace-normal" />
        </LiveTextScope>
      </div>
    </div>
  )
}
