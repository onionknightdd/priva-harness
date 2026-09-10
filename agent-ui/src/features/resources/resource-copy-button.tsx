import * as React from "react"
import { CheckIcon, CopyIcon, XIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { TooltipHint } from "@/components/ui/tooltip"
import { writeClipboardText } from "@/lib/clipboard"
import { ResourceIconButton } from "./resource-icon-button"

export function ResourceCopyButton({ content }: { content: string | undefined }) {
  const { t } = useTranslation()
  const [feedback, setFeedback] = React.useState<"copied" | "copyFailed" | null>(null)
  React.useEffect(() => {
    if (!feedback) return
    const timer = window.setTimeout(() => setFeedback(null), 1600)
    return () => window.clearTimeout(timer)
  }, [feedback])
  const copy = async () => {
    if (content === undefined) return
    try { await writeClipboardText(content); setFeedback("copied") }
    catch { setFeedback("copyFailed") }
  }
  return <>
    <TooltipHint content={t(`filePreview.${feedback ?? "copy"}`)}>
      <ResourceIconButton aria-label={t("filePreview.copy")} disabled={content === undefined} onClick={() => void copy()}>
        {feedback === "copied" ? <CheckIcon /> : feedback === "copyFailed" ? <XIcon className="text-destructive" /> : <CopyIcon />}
      </ResourceIconButton>
    </TooltipHint>
    <span role="status" className="sr-only">{feedback ? t(`filePreview.${feedback}`) : ""}</span>
  </>
}
