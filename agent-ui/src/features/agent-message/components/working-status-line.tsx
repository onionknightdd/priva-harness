import { LoadingState } from "@/components/ui/loading-state"

import type { AgentThreadMessage } from "../agent-message-data"
import { ProcessStatusText } from "./process-status-text"

export function WorkingStatusLine({
  message,
}: {
  message: AgentThreadMessage
}) {
  return (
    <div
      data-slot="working-status-line"
      className="flex w-full min-w-0 pl-1.5"
    >
      <div className="flex max-w-full min-w-0 items-center gap-2 py-0.5 text-left text-ui leading-snug font-medium text-muted-foreground/70">
        <LoadingState />
        <ProcessStatusText message={message} isStreaming />
      </div>
    </div>
  )
}
