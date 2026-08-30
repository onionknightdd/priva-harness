import { useTranslation } from "react-i18next"

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
      <div className="flex max-w-full min-w-0 items-center py-0.5 text-left text-[15px] leading-snug font-medium text-muted-foreground/70">
        <span className="min-w-0 whitespace-normal shimmer">{statusText}</span>
      </div>
    </div>
  )
}
