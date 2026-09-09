"use client"

import * as React from "react"
import { FolderIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { fileNameFromPath } from "@/lib/file-path"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { TooltipHint, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { DirectoryPickerDialog } from "@/features/project-directory/directory-picker-dialog"

export function SessionCwdIndicator({
  cwd,
  className,
  onChange,
}: {
  cwd: string
  className?: string
  onChange?: (cwd: string) => void
}) {
  const { t } = useTranslation()
  const name = fileNameFromPath(cwd)
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => { if (!onChange) setOpen(false) }, [onChange])

  if (!name) {
    return null
  }

  const content = <>
    <span className="flex size-6 shrink-0 items-center justify-center">
      <FolderIcon className="size-4" aria-hidden="true" />
    </span>
    <span className="min-w-0 truncate">{name}</span>
  </>

  if (onChange) {
    return <>
      <Tooltip>
        <TooltipTrigger render={
          <Button
            variant="ghost" size="sm"
            className={cn("h-6 max-w-full justify-start gap-1 border-l border-transparent py-0 pr-2 pl-2.5 text-[13px] font-normal text-muted-foreground", className)}
            aria-label={`${t("directoryPicker.change")}: ${cwd}`}
            onClick={() => setOpen(true)}
          />
        }>{content}</TooltipTrigger>
        <TooltipContent side="top">{cwd}</TooltipContent>
      </Tooltip>
      <DirectoryPickerDialog open={open} initialPath={cwd} onOpenChange={setOpen} onConfirm={onChange} />
    </>
  }

  return (
    <TooltipHint content={cwd}>
      <div
        className={cn(
          // 1px transparent border + pl-2.5 matches the composer plus control inset.
          "flex w-fit min-w-0 items-center gap-1 border-l border-transparent pl-2.5 text-[13px] text-muted-foreground",
          className
        )}
        aria-label={`${t("agentMessage.sessionCwd")}: ${cwd}`}
      >
        {content}
      </div>
    </TooltipHint>
  )
}
