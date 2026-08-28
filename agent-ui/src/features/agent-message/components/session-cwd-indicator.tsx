"use client"

import { FolderIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { fileNameFromPath } from "@/lib/file-path"
import { cn } from "@/lib/utils"

export function SessionCwdIndicator({
  cwd,
  className,
}: {
  cwd: string
  className?: string
}) {
  const { t } = useTranslation()
  const name = fileNameFromPath(cwd)

  if (!name) {
    return null
  }

  return (
    <div
      className={cn(
        "ml-[calc(0.5rem+1px)] flex w-fit min-w-0 items-center gap-1 text-xs text-muted-foreground",
        className
      )}
      title={cwd}
      aria-label={`${t("agentMessage.sessionCwd")}: ${cwd}`}
    >
      <span className="flex size-6 shrink-0 items-center justify-center">
        <FolderIcon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 truncate">{name}</span>
    </div>
  )
}
