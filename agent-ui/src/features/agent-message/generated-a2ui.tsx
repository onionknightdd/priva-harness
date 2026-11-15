import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Skeleton } from "@/components/ui/skeleton"

import type { StreamBlock } from "./agent-message-data"
import { A2uiVisual } from "./a2ui/a2ui-visual"
import { a2uiMessagesFromTool } from "./a2ui-tool-data"
import { uiActionMessage } from "./ui-action"
import { useUiActionContinue } from "./ui-action-context"

export function GeneratedA2ui({ block }: { block: Extract<StreamBlock, { type: "tool_use" }> }) {
  const { t } = useTranslation()
  const continueTurn = useUiActionContinue()
  const { output, ok, status } = block.tool ?? {}
  // Preserve the processor and form state while unrelated text/tool frames arrive.
  const messages = useMemo(() => a2uiMessagesFromTool(status ? { output, ok, status } : undefined), [output, ok, status])
  if (status !== "completed") return (
    <div data-slot="generated-visual" role="status" aria-label={t("agentMessage.visualPreparing")} className="min-w-0">
      <Skeleton className="h-40 w-full rounded-2xl motion-reduce:animate-none" />
      <span className="sr-only">{t("agentMessage.visualPreparing")}</span>
    </div>
  )
  // Tool failures are rendered as expandable process records, including after a successful retry.
  if (ok === false) return null
  if (!messages) return (
    <div data-slot="generated-visual" role="alert" className="rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground">
      {t("agentMessage.visualFailed")}
    </div>
  )
  return <div data-slot="generated-visual" className="min-w-0">
    <A2uiVisual messages={messages} onAction={continueTurn ? (action) => continueTurn(uiActionMessage(block.id, action)) : undefined} />
  </div>
}
