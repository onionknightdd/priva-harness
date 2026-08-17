import { Maximize2Icon, Minimize2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { FilePreviewMode } from "@/features/files/model/file.types"

export function FilePreviewToolbar({
  expanded,
  fileName,
  mode,
  onExpandedChange,
  onModeChange,
  renderAvailable,
  sourceAvailable,
}: {
  expanded: boolean
  fileName?: string
  mode: FilePreviewMode | null
  onExpandedChange?: (expanded: boolean) => void
  onModeChange: (mode: FilePreviewMode) => void
  renderAvailable: boolean
  sourceAvailable: boolean
}) {
  const { t } = useTranslation()
  const expandLabel = expanded
    ? t("filePreview.restore")
    : t("filePreview.maximize")

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b px-2 sm:px-3">
      <span className="min-w-0 flex-1 truncate text-sm" title={fileName}>
        {fileName ?? t("filePreview.noFile")}
      </span>
      <ToggleGroup
        aria-label={t("filePreview.modeLabel")}
        value={mode ? [mode] : []}
        onValueChange={(values) => {
          const nextMode = values[0] as FilePreviewMode | undefined

          if (nextMode) {
            onModeChange(nextMode)
          }
        }}
        variant="outline"
        size="sm"
        spacing={0}
      >
        <ToggleGroupItem
          value="source"
          disabled={!sourceAvailable}
          aria-label={t("filePreview.source")}
          title={
            sourceAvailable
              ? t("filePreview.source")
              : t("filePreview.sourceUnavailable")
          }
          className="px-2 text-xs font-normal"
        >
          {t("filePreview.source")}
        </ToggleGroupItem>
        <ToggleGroupItem
          value="render"
          disabled={!renderAvailable}
          aria-label={t("filePreview.render")}
          title={
            renderAvailable
              ? t("filePreview.render")
              : t("filePreview.renderUnavailable")
          }
          className="px-2 text-xs font-normal"
        >
          {t("filePreview.render")}
        </ToggleGroupItem>
      </ToggleGroup>
      {onExpandedChange && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={expandLabel}
                aria-pressed={expanded}
                onClick={() => onExpandedChange(!expanded)}
              />
            }
          >
            {expanded ? <Minimize2Icon /> : <Maximize2Icon />}
          </TooltipTrigger>
          <TooltipContent>{expandLabel}</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
