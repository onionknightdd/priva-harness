import { memo } from "react"
import { useTranslation } from "react-i18next"

import { LiveTextScope, StableText } from "@/components/motion/stable-text"
import { cn } from "@/lib/utils"

import type { AgentThreadMessage, StreamBlock } from "../agent-message-data"
import { useProcessElapsedLabel, type ProcessElapsedMessage } from "../process-elapsed"
import { processActivityPieces, sameProcessActivity } from "../process-status"

const EMPTY_BLOCKS: readonly StreamBlock[] = []

const ProcessElapsedText = memo(function ProcessElapsedText({
  isStreaming,
  ...message
}: ProcessElapsedMessage & { isStreaming: boolean }) {
  const { t } = useTranslation()
  const label = useProcessElapsedLabel(message, isStreaming, t)
  return <span className="inline-block whitespace-pre align-baseline">{label}</span>
})

const ProcessActivityText = memo(function ProcessActivityText({
  blocks,
  isStreaming,
}: {
  blocks: readonly StreamBlock[]
  isStreaming: boolean
}) {
  const { t } = useTranslation()
  return <StableText pieces={processActivityPieces(blocks, isStreaming, t)} className="whitespace-normal" />
}, (previous, next) => previous.isStreaming === next.isStreaming && sameProcessActivity(previous.blocks, next.blocks))

/** The visible clock and the summary's accessible text form one current sentence. */
export function ProcessStatusText({
  message,
  isStreaming,
}: {
  message: AgentThreadMessage
  isStreaming: boolean
}) {
  return (
    <span className={cn("relative inline min-w-0 whitespace-normal", isStreaming && "status-line-shimmer")}>
      <ProcessElapsedText
        id={message.id}
        createdAt={message.createdAt}
        status={message.status}
        durationMs={message.durationMs}
        isStreaming={isStreaming}
      />
      <LiveTextScope>
        <ProcessActivityText blocks={message.blocks ?? EMPTY_BLOCKS} isStreaming={isStreaming} />
      </LiveTextScope>
    </span>
  )
}
