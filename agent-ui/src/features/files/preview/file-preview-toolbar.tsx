import * as React from "react"
import gsap from "gsap"
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  Maximize2Icon,
  Minimize2Icon,
  XIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  TabsList,
  TabsTrigger,
} from "@/components/assistant-ui/tabs"
import { OverflowMarquee } from "@/components/motion/overflow-marquee"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type {
  FilePreviewMode,
  PreviewFile,
} from "@/features/files/model/file.types"
import { writeClipboardText } from "@/lib/clipboard"

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
  expanded,
  files,
  mode,
  onCloseAll,
  onFileClose,
  onDownload,
  onExpandedChange,
  onModeChange,
  renderAvailable,
  sourceAvailable,
}: {
  activeFile: PreviewFile | null
  expanded: boolean
  files: PreviewFile[]
  mode: FilePreviewMode | null
  onCloseAll: () => void
  onFileClose: (fileId: string) => void
  onDownload?: (file: PreviewFile) => void
  onExpandedChange?: (expanded: boolean) => void
  onModeChange: (mode: FilePreviewMode) => void
  renderAvailable: boolean
  sourceAvailable: boolean
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
    <div className="file-preview-toolbar flex h-11 shrink-0 items-center gap-2 border-b px-2 sm:px-3">
      <div className="file-preview-toolbar__tabs min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {files.length > 0 ? (
          <TabsList
            aria-label={t("filePreview.openFiles")}
            variant="line"
            size="sm"
            className="h-10 min-w-max border-0 pb-0"
          >
            {files.map((file) => (
              <div
                key={file.id}
                data-file-preview-tab
                className="relative inline-flex w-[100px] min-w-[100px] max-w-[100px] shrink-0 items-center"
                onPointerEnter={() => setMarqueeFileId(file.id)}
                onPointerLeave={() => setMarqueeFileId(null)}
                onFocusCapture={() => setMarqueeFileId(file.id)}
                onBlurCapture={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setMarqueeFileId(null)
                  }
                }}
              >
                <TabsTrigger
                  value={file.id}
                  title={file.path}
                  className="w-full min-w-0 flex-none justify-start overflow-hidden pr-7! font-normal dark:data-active:text-foreground"
                >
                  <OverflowMarquee
                    active={marqueeFileId === file.id}
                    className="flex-1"
                  >
                    {file.name}
                  </OverflowMarquee>
                </TabsTrigger>
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
          <span className="px-2 text-xs text-muted-foreground">
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

        <div className="file-preview-toolbar__controls flex shrink-0 items-center gap-1">
          <ToggleGroup
            aria-label={t("filePreview.modeLabel")}
            value={mode ? [mode] : []}
            onValueChange={(values) => {
              const nextMode = values[0] as
                | FilePreviewMode
                | undefined

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
              aria-label={t("filePreview.preview")}
              title={
                renderAvailable
                  ? t("filePreview.preview")
                  : t("filePreview.previewUnavailable")
              }
              className="px-2 text-xs font-normal"
            >
              {t("filePreview.preview")}
            </ToggleGroupItem>
          </ToggleGroup>

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
                {expanded ? <Minimize2Icon /> : <Maximize2Icon />}
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
