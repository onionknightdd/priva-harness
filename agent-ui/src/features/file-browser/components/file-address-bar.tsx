import * as React from "react"
import gsap from "gsap"
import { FolderPlusIcon, FoldersIcon, UploadIcon } from "lucide-react"
import { motion, useReducedMotion, type Transition } from "motion/react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import type {
  FileBrowserBreadcrumbEntry,
  FileBrowserItem,
  FileBrowserModel,
} from "../file-browser-data"

import { FileGoToControl } from "./file-go-to-control"
import { FilePathBreadcrumb } from "./file-path-breadcrumb"

const goToTransition: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 34,
  mass: 0.75,
}

function animateActionIcon(control: HTMLButtonElement) {
  const icon = control.querySelector("svg")

  if (
    !icon ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return
  }

  gsap.fromTo(
    icon,
    { scale: 0.78 },
    {
      scale: 1,
      duration: 0.28,
      ease: "back.out(2.5)",
      clearProps: "transform",
    }
  )
}

export function FileAddressBar({
  breadcrumb,
  compact = false,
  currentDirectory,
  model,
  onCreateFolder,
  onGoTo,
  onNavigate,
  onTreeVisibilityChange,
  onUpload,
  treeVisible,
}: {
  breadcrumb: FileBrowserBreadcrumbEntry[]
  compact?: boolean
  currentDirectory: string | null
  model: FileBrowserModel
  onCreateFolder: (directory: string) => void
  onGoTo: (path: string) => Promise<boolean>
  onNavigate: (path: string, type: FileBrowserItem["type"]) => void
  onTreeVisibilityChange: (visible: boolean) => void
  onUpload: (directory: string) => void
  treeVisible: boolean
}) {
  const { t } = useTranslation()
  const announcementTimerRef = React.useRef<number | null>(null)
  const [announcement, setAnnouncement] = React.useState("")
  const shouldReduceMotion = Boolean(useReducedMotion())
  const transition: Transition = shouldReduceMotion
    ? { duration: 0 }
    : goToTransition
  const treeToggleLabel = treeVisible
    ? t("fileBrowser.hideTree")
    : t("fileBrowser.showTree")

  React.useEffect(
    () => () => {
      if (announcementTimerRef.current !== null) {
        window.clearTimeout(announcementTimerRef.current)
      }
    },
    []
  )

  const announce = React.useCallback((message: string) => {
    setAnnouncement(message)

    if (announcementTimerRef.current !== null) {
      window.clearTimeout(announcementTimerRef.current)
    }

    announcementTimerRef.current = window.setTimeout(
      () => setAnnouncement(""),
      1600
    )
  }, [])

  return (
    <div
      data-file-browser-enter
      className={cn(
        "flex shrink-0 items-center gap-0.5",
        compact ? "h-8 px-0" : "h-10 gap-1 px-1"
      )}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={treeToggleLabel}
              aria-controls="file-browser-tree-pane"
              aria-expanded={treeVisible}
              aria-pressed={treeVisible}
              onClick={() => onTreeVisibilityChange(!treeVisible)}
            />
          }
        >
          <FoldersIcon aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent>{treeToggleLabel}</TooltipContent>
      </Tooltip>
      <div className={cn("relative min-w-0 flex-1", compact ? "h-7" : "h-8")}>
        <motion.div
          layout
          className="absolute inset-0 flex min-w-0 items-center gap-0.5"
          transition={transition}
        >
          <FilePathBreadcrumb
            breadcrumb={breadcrumb}
            compact={compact}
            model={model}
            onNavigate={onNavigate}
          />

          <div aria-hidden="true" className="min-w-0 flex-1" />

          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={!currentDirectory}
                    aria-label={t("fileBrowser.createFolder")}
                    onClick={(event) => {
                      animateActionIcon(event.currentTarget)
                      if (currentDirectory) {
                        onCreateFolder(currentDirectory)
                      }
                    }}
                  />
                }
              >
                <FolderPlusIcon aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>{t("fileBrowser.createFolder")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={!currentDirectory}
                    aria-label={t("fileBrowser.upload")}
                    onClick={(event) => {
                      animateActionIcon(event.currentTarget)
                      if (currentDirectory) {
                        onUpload(currentDirectory)
                      }
                    }}
                  />
                }
              >
                <UploadIcon aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>{t("fileBrowser.upload")}</TooltipContent>
            </Tooltip>
          </div>

          <FileGoToControl onAnnounce={announce} onGoTo={onGoTo} />
        </motion.div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  )
}
