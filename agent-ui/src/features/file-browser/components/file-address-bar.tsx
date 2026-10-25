import * as React from "react"
import gsap from "gsap"
import { FolderPlusIcon, FoldersIcon, UploadIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { GitModeTabs } from "@/features/git/git-ui-primitives"

import type {
  FileBrowserBreadcrumbEntry,
  FileBrowserItem,
  FileBrowserModel,
} from "../file-browser-data"

import { FileGoToControl } from "./file-go-to-control"
import { FilePathBreadcrumb } from "./file-path-breadcrumb"

export type FileBrowserGitView = {
  root: string
  active: boolean
  controls: { files: string; git: string }
  onChange: (value: string) => void
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
  condensed = false,
  currentDirectory,
  git,
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
  condensed?: boolean
  currentDirectory: string | null
  git?: FileBrowserGitView
  model: FileBrowserModel
  onCreateFolder: (directory: string) => void
  onGoTo: (path: string) => Promise<boolean>
  onNavigate: (path: string, type: FileBrowserItem["type"]) => void
  onTreeVisibilityChange?: (visible: boolean) => void
  onUpload: (directory: string) => void
  treeVisible: boolean
}) {
  const { t } = useTranslation()
  const announcementTimerRef = React.useRef<number | null>(null)
  const [announcement, setAnnouncement] = React.useState("")
  const showGitViews = git && breadcrumb.some((entry) => entry.type === "folder" && entry.path === git.root)
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
      {onTreeVisibilityChange ? <Tooltip>
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
      </Tooltip> : <span aria-hidden="true" className="size-8 shrink-0" />}
      <div className={cn("relative min-w-0 flex-1", compact ? "h-7" : "h-8")}>
        {/* Fills its parent, so it has no layout of its own to animate; the
            go-to control below owns the layout / layoutId animations. */}
        <div className="absolute inset-0 flex min-w-0 items-center gap-0.5">
          <FilePathBreadcrumb
            breadcrumb={breadcrumb}
            compact={compact}
            condensed={condensed}
            model={model}
            onNavigate={onNavigate}
          />

          {compact ? (
            <div aria-hidden="true" className="min-w-0 flex-1" />
          ) : null}

          <div className="flex shrink-0 items-center gap-0.5">
            {showGitViews && <div data-file-browser-view-tabs className="mr-1 shrink-0">
              <GitModeTabs
                size="sm"
                className={cn(
                  "[--primary:#0285f7] [--primary-foreground:#ffffff]",
                  "[--card:var(--tabs-background)] [--foreground:oklch(15%_0_0)] [--muted-foreground:oklch(50%_0_0)]",
                  "dark:[--card:#1c1c1c] dark:[--foreground:oklch(96%_0_0)] dark:[--muted-foreground:oklch(62%_0_0)]"
                )}
                value={git.active ? "git" : "files"}
                onChange={git.onChange}
                label={t("fileBrowser.workspaceView")}
                items={[
                  { value: "files", label: t("fileBrowser.filesView"), controls: git.controls.files },
                  { value: "git", label: "Git", controls: git.controls.git },
                ]}
              />
            </div>}
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

          {compact ? null : (
            <div aria-hidden="true" className="min-w-0 flex-1" />
          )}

          <FileGoToControl onAnnounce={announce} onGoTo={onGoTo} />
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  )
}
