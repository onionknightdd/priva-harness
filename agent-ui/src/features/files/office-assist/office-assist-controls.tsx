import { SendIcon, Trash2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TooltipHint } from "@/components/ui/tooltip"

import { useOfficeAssist } from "./office-assist-provider"

export function OfficeAssistControls() {
  const { t } = useTranslation()
  const assist = useOfficeAssist()
  if (!assist?.enabled) return null
  return (
    <div className="flex shrink-0 items-center gap-1" data-office-assist-controls>
      <Badge variant="secondary" aria-label={t("filePreview.officeAssist.count", { count: assist.items.length })} data-office-assist-count>
        {assist.items.length}
      </Badge>
      <TooltipHint content={t("filePreview.officeAssist.clear")}>
        <Button variant="ghost" size="icon-sm" aria-label={t("filePreview.officeAssist.clear")}
          disabled={!assist.items.length && !assist.draft} onClick={assist.clear} data-office-assist-clear>
          <Trash2Icon aria-hidden="true" />
        </Button>
      </TooltipHint>
      <TooltipHint content={assist.error ?? t("filePreview.officeAssist.send")}>
        <Button variant="ghost" size="icon-sm" aria-label={t("filePreview.officeAssist.send")}
          disabled={!assist.items.length} onClick={assist.send} data-office-assist-send>
          <SendIcon aria-hidden="true" />
        </Button>
      </TooltipHint>
      <span role="status" aria-live="polite" className="sr-only">{assist.error}</span>
    </div>
  )
}
