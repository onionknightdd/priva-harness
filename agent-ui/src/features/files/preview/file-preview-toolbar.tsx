import * as React from "react"
import gsap from "gsap"
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  MaximizeIcon,
  MinimizeIcon,
  XIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { OverflowMarquee } from "@/components/motion/overflow-marquee"
import {
  TabsList,
  TabsTrigger,
  Tabs as PreviewModeTabs,
  TabsList as PreviewModeTabsList,
  TabsTrigger as PreviewModeTabsTrigger,
} from "@/components/motion/tabs"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  TooltipHint,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { FileTypeIcon } from "@/features/file-browser/components/file-type-icon"
import type {
  FilePreviewMode,
  PreviewFile,
} from "@/features/files/model/file.types"
import { writeClipboardText } from "@/lib/clipboard"
import { SPRING_LAYOUT } from "@/lib/ease"
import { cn } from "@/lib/utils"
import { FileAssistControls } from "../element-assist/file-assist-controls"

function animateControl(control: HTMLButtonElement) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return
  }

  const target = control.querySelector("svg") ?? control

  gsap.fromTo(
    target,
    { scale: 0.78 },
    {
      scale: 1,
      duration: 0.28,
      ease: "back.out(2.5)",
      clearProps: "transform",
    }
  )
}

export function FilePreviewToolbar({
  activeFile,
  agentAssistVisible,
  compact = false,
  expanded,
  fileTabsId,
  files,
  mode,
  onCloseAll,
  onFileClose,
  onDownload,
  onExpandedChange,
  onModeChange,
  renderAvailable,
  sourceAvailable,
  editAvailable,
}: {
  activeFile: PreviewFile | null
  agentAssistVisible: boolean
  compact?: boolean
  expanded: boolean
  fileTabsId: string
  files: PreviewFile[]
  mode: FilePreviewMode | null
  onCloseAll: () => void
  onFileClose: (fileId: string) => void
  onDownload?: (file: PreviewFile) => void
  onExpandedChange?: (expanded: boolean) => void
  onModeChange: (mode: FilePreviewMode) => void
  renderAvailable: boolean
  sourceAvailable: boolean
  editAvailable: boolean
}) {
  const { t } = useTranslation()
  const feedbackTimerRef = React.useRef<number | null>(null)
  const closeTweensRef = React.useRef(
    new Map<string, gsap.core.Tween>()
  )
  const [announcement, setAnnouncement] = React.useState("")
  const [marqueeFileId, setMarqueeFileId] = React.useState<
    string | null
  >(null)
  const [copied, setCopied] = React.useState(false)
  const expandLabel = expanded
    ? t("filePreview.restore")
    : t("filePreview.maximize")

  React.useEffect(
    () => () => {
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current)
      }

      closeTweensRef.current.forEach((tween) => tween.kill())
      closeTweensRef.current.clear()
    },
    []
  )

  const announce = React.useCallback((message: string) => {
    setAnnouncement(message)

    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current)
    }

    feedbackTimerRef.current = window.setTimeout(() => {
      setAnnouncement("")
      setCopied(false)
    }, 1600)
  }, [])

  const handleCopy = async (event: React.MouseEvent<HTMLButtonElement>) => {
    if (activeFile?.content === undefined) {
      return
    }

    animateControl(event.currentTarget)

    try {
      await writeClipboardText(activeFile.content)
      setCopied(true)
      announce(t("filePreview.copied"))
    } catch {
      announce(t("filePreview.copyFailed"))
    }
  }

  const handleDownload = (event: React.MouseEvent<HTMLButtonElement>) => {
    animateControl(event.currentTarget)
    if (!activeFile || !onDownload) {
      announce(t("filePreview.downloadUnavailable"))
      return
    }

    onDownload(activeFile)
    announce(t("filePreview.downloadStarted"))
  }

  const handleFileClose = (
    event: React.MouseEvent<HTMLButtonElement>,
    fileId: string
  ) => {
    event.stopPropagation()

    if (closeTweensRef.current.has(fileId)) {
      return
    }

    const tab = event.currentTarget.closest<HTMLElement>(
      "[data-file-preview-tab]"
    )
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches

    if (!tab || reducedMotion) {
      onFileClose(fileId)
      return
    }

    const tween = gsap.to(tab, {
      opacity: 0,
      scale: 0.96,
      duration: 0.16,
      ease: "power2.in",
      onComplete: () => {
        closeTweensRef.current.delete(fileId)
        onFileClose(fileId)
      },
    })

    closeTweensRef.current.set(fileId, tween)
  }

  const handleCloseAll = () => {
    closeTweensRef.current.forEach((tween) => tween.kill())
    closeTweensRef.current.clear()
    onCloseAll()
  }

  return (
    <div
      className={cn(
        "file-preview-toolbar flex shrink-0 items-center border-b",
        compact ? "h-11 gap-1 px-1.5" : "h-11 gap-2 px-2 sm:px-3"
      )}
    >
      <div
        className="file-preview-toolbar__tabs min-w-0 flex-1"
      >
        {files.length > 0 ? (
          <TabsList
            aria-label={t("filePreview.openFiles")}
            className={cn(
              "gap-1 border-b-2",
              compact ? "h-8" : "h-10"
            )}
          >
            {files.map((file) => (
              <div
                key={file.id}
                data-file-preview-tab
                className="relative inline-flex h-full w-[100px] min-w-[100px] max-w-[100px] shrink-0 items-center"
                onPointerEnter={() => setMarqueeFileId(file.id)}
                onPointerLeave={() => setMarqueeFileId(null)}
                onFocusCapture={() => setMarqueeFileId(file.id)}
                onBlurCapture={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setMarqueeFileId(null)
                  }
                }}
              >
                <TooltipHint content={file.path}>
                  <TabsTrigger
                    id={`${fileTabsId}-tab-${encodeURIComponent(file.id)}`}
                    aria-controls={`${fileTabsId}-panel-${encodeURIComponent(file.id)}`}
                    value={file.id}
                    className="mb-0 h-full min-h-0 w-full min-w-0 flex-none justify-start gap-1.5 px-2 py-0 pr-7 text-xs font-normal"
                    indicatorClassName="-bottom-0.5 h-0.5"
                  >
                    <FileTypeIcon name={file.name} path={file.path} />
                    <OverflowMarquee
                      active={marqueeFileId === file.id}
                      className="flex-1"
                    >
                      {file.name}
                    </OverflowMarquee>
                  </TabsTrigger>
                </TooltipHint>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="absolute top-1/2 right-0.5 z-20 size-5 -translate-y-1/2 rounded-sm border-0 shadow-none"
                        aria-label={t("filePreview.closeFile", {
                          fileName: file.name,
                        })}
                        onClick={(event) =>
                          handleFileClose(event, file.id)
                        }
                      />
                    }
                  >
                    <XIcon aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("filePreview.closeFile", {
                      fileName: file.name,
                    })}
                  </TooltipContent>
                </Tooltip>
              </div>
            ))}
          </TabsList>
        ) : (
          <span
            className={cn(
              "text-xs text-muted-foreground",
              compact ? "px-1" : "px-2"
            )}
          >
            {t("filePreview.noOpenFiles")}
          </span>
        )}
      </div>

      <div className="file-preview-toolbar__actions flex shrink-0 items-center">
        {files.length > 2 && (
          <>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              className="file-preview-toolbar__close rounded-full font-normal"
              onClick={handleCloseAll}
            >
              <XIcon aria-hidden="true" />
              {t("filePreview.closeAll")}
            </Button>

            <Separator
              orientation="vertical"
              className="file-preview-toolbar__separator mx-2 h-5 data-vertical:self-center"
            />
          </>
        )}

        <div
          data-file-preview-controls
          className="file-preview-toolbar__controls flex shrink-0 items-center gap-1"
        >
          <PreviewModeTabs
            variant="segment"
            transition={SPRING_LAYOUT}
            value={mode ?? ""}
            onValueChange={(nextMode) => {
              if (
                nextMode === "source" ||
                nextMode === "render" ||
                nextMode === "edit"
              ) {
                onModeChange(nextMode)
              }
            }}
            className="shrink-0"
          >
            <PreviewModeTabsList
              aria-label={t("filePreview.modeLabel")}
              className="h-8 bg-tabs-background"
            >
              <TooltipHint
                content={
                  sourceAvailable
                    ? t("filePreview.source")
                    : t("filePreview.sourceUnavailable")
                }
              >
                <PreviewModeTabsTrigger
                  value="source"
                  disabled={!sourceAvailable}
                  aria-label={t("filePreview.source")}
                  className="h-7 px-2 py-0 text-xs font-normal"
                  indicatorClassName="inset-0.5"
                >
                  {t("filePreview.source")}
                </PreviewModeTabsTrigger>
              </TooltipHint>
              <TooltipHint
                content={
                  renderAvailable
                    ? t("filePreview.preview")
                    : t("filePreview.previewUnavailable")
                }
              >
                <PreviewModeTabsTrigger
                  value="render"
                  disabled={!renderAvailable}
                  aria-label={t("filePreview.preview")}
                  className="h-7 px-2 py-0 text-xs font-normal"
                  indicatorClassName="inset-0.5"
                >
                  {t("filePreview.preview")}
                </PreviewModeTabsTrigger>
              </TooltipHint>
              {agentAssistVisible && (
                <TooltipHint
                  content={
                    editAvailable
                      ? activeFile?.renderKind === "html"
                        ? t("filePreview.htmlAssist.modeHint")
                        : t("filePreview.officeAssist.modeHint")
                      : t("filePreview.editUnavailable")
                  }
                >
                  <PreviewModeTabsTrigger
                    value="edit"
                    disabled={!editAvailable}
                    aria-label={t("filePreview.edit")}
                    className="h-7 px-2 py-0 text-xs font-normal"
                    indicatorClassName="inset-0.5"
                  >
                    {t("filePreview.edit")}
                  </PreviewModeTabsTrigger>
                </TooltipHint>
              )}
            </PreviewModeTabsList>
          </PreviewModeTabs>

          <FileAssistControls />

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={activeFile?.content === undefined}
                  aria-label={
                    copied
                      ? t("filePreview.copied")
                      : t("filePreview.copy")
                  }
                  onClick={handleCopy}
                />
              }
            >
              {copied ? (
                <CheckIcon aria-hidden="true" />
              ) : (
                <CopyIcon aria-hidden="true" />
              )}
            </TooltipTrigger>
            <TooltipContent>
              {copied
                ? t("filePreview.copied")
                : t("filePreview.copy")}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={!activeFile || activeFile.status === "loading"}
                  aria-label={t("filePreview.download")}
                  onClick={handleDownload}
                />
              }
            >
              <DownloadIcon aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>
              {t("filePreview.download")}
            </TooltipContent>
          </Tooltip>

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
                {expanded ? <MinimizeIcon /> : <MaximizeIcon />}
              </TooltipTrigger>
              <TooltipContent>{expandLabel}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  )
}
