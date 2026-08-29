import * as React from "react"
import gsap from "gsap"
import { RefreshCwIcon, SearchIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import {
  countFileBrowserTreeItems,
  type FileBrowserItem,
  type FileBrowserModel,
} from "../file-browser-data"
import { measureFileTreeNameOverflow } from "../file-tree-content-width"
import { FileBrowserTree } from "./file-browser-tree"

export function FileTreePane({
  compact = false,
  initialError,
  initialLoading,
  loadingDirectories,
  model,
  onDeleteRequest,
  onDownload,
  onItemSelect,
  onRefresh,
  onRetry,
  onTreeStructureChange,
  onUpload,
  onVisibleContentOverflow,
  rootPath,
  selectedItemPath,
}: {
  compact?: boolean
  initialError: string | null
  initialLoading: boolean
  loadingDirectories: Set<string>
  model: FileBrowserModel
  onDeleteRequest: (item: FileBrowserItem) => void
  onDownload: (item: FileBrowserItem) => void
  onItemSelect: (
    path: string,
    shouldLoadDirectory: boolean
  ) => Promise<void>
  onRefresh: () => Promise<void>
  onRetry: () => Promise<void>
  onTreeStructureChange?: () => void
  onUpload: (directory: string) => void
  onVisibleContentOverflow?: (overflowPx: number) => void
  rootPath: string | null
  selectedItemPath: string | null
}) {
  const { t } = useTranslation()
  const refreshIconRef = React.useRef<SVGSVGElement>(null)
  const treeScrollRef = React.useRef<HTMLDivElement>(null)
  const announcementTimerRef = React.useRef<number | null>(null)
  const reportVisibleOverflowRef = React.useRef<() => void>(
    () => undefined
  )
  const [query, setQuery] = React.useState("")
  const [refreshing, setRefreshing] = React.useState(false)
  const [announcement, setAnnouncement] = React.useState("")
  const itemCount = countFileBrowserTreeItems(model, rootPath)

  React.useEffect(
    () => () => {
      if (announcementTimerRef.current !== null) {
        window.clearTimeout(announcementTimerRef.current)
      }
    },
    []
  )

  const handleVisibleRowsChange = React.useCallback(() => {
    onTreeStructureChange?.()
    reportVisibleOverflowRef.current()
  }, [onTreeStructureChange])

  React.useEffect(() => {
    const root = treeScrollRef.current

    if (!root || !onVisibleContentOverflow) {
      reportVisibleOverflowRef.current = () => undefined
      return
    }

    let reportFrame = 0
    const visibleSlots = new Set<HTMLElement>()
    const observedSlots = new Set<HTMLElement>()

    const reportVisibleOverflow = () => {
      window.cancelAnimationFrame(reportFrame)
      reportFrame = window.requestAnimationFrame(() => {
        const connectedSlots = [...visibleSlots].filter(
          (slot) => slot.isConnected
        )

        if (connectedSlots.length > 0) {
          onVisibleContentOverflow(
            measureFileTreeNameOverflow(connectedSlots)
          )
        }
      })
    }

    reportVisibleOverflowRef.current = reportVisibleOverflow

    if (typeof IntersectionObserver === "undefined") {
      const reportAllRows = () => {
        const slots = root.querySelectorAll<HTMLElement>(
          "[data-file-tree-name]"
        )

        if (slots.length > 0) {
          onVisibleContentOverflow(measureFileTreeNameOverflow(slots))
        }
      }

      reportVisibleOverflowRef.current = reportAllRows
      reportAllRows()

      return () => {
        reportVisibleOverflowRef.current = () => undefined
      }
    }

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const slot = entry.target

          if (!(slot instanceof HTMLElement)) {
            continue
          }

          if (entry.isIntersecting) {
            visibleSlots.add(slot)
          } else {
            visibleSlots.delete(slot)
          }
        }

        reportVisibleOverflow()
      },
      {
        root,
        rootMargin: "64px 0px",
      }
    )

    const observeRows = () => {
      for (const slot of observedSlots) {
        if (!slot.isConnected) {
          intersectionObserver.unobserve(slot)
          observedSlots.delete(slot)
          visibleSlots.delete(slot)
        }
      }

      for (const slot of root.querySelectorAll<HTMLElement>(
        "[data-file-tree-name]"
      )) {
        if (!observedSlots.has(slot)) {
          observedSlots.add(slot)
          intersectionObserver.observe(slot)
        }
      }
    }

    const mutationObserver = new MutationObserver(observeRows)
    mutationObserver.observe(root, { childList: true, subtree: true })
    observeRows()

    return () => {
      window.cancelAnimationFrame(reportFrame)
      mutationObserver.disconnect()
      intersectionObserver.disconnect()
      reportVisibleOverflowRef.current = () => undefined
    }
  }, [onVisibleContentOverflow])

  const announceAction = React.useCallback((message: string) => {
    setAnnouncement(message)

    if (announcementTimerRef.current !== null) {
      window.clearTimeout(announcementTimerRef.current)
    }

    announcementTimerRef.current = window.setTimeout(
      () => setAnnouncement(""),
      2200
    )
  }, [])

  const handleRefresh = async () => {
    if (refreshing) {
      return
    }

    setRefreshing(true)

    if (
      refreshIconRef.current &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      gsap.fromTo(
        refreshIconRef.current,
        { rotate: 0 },
        {
          rotate: 360,
          duration: 0.45,
          ease: "power2.out",
          clearProps: "transform",
        }
      )
    }

    try {
      await onRefresh()
      announceAction(t("fileBrowser.refreshed"))
    } catch (error) {
      announceAction(
        error instanceof Error ? error.message : String(error)
      )
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b p-1.5">
        <div className="relative min-w-0 flex-1">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t("fileBrowser.searchLabel")}
            placeholder={t("fileBrowser.searchPlaceholder")}
            className="h-8 border-0 bg-muted/40 pl-8 text-xs shadow-none focus-visible:ring-2"
          />
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={refreshing || !rootPath}
                aria-label={t("fileBrowser.refresh")}
                onClick={() => void handleRefresh()}
              />
            }
          >
            <RefreshCwIcon ref={refreshIconRef} />
          </TooltipTrigger>
          <TooltipContent>{t("fileBrowser.refresh")}</TooltipContent>
        </Tooltip>
      </div>
      <div
        ref={treeScrollRef}
        data-file-tree-scroll
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pb-2 [scrollbar-gutter:stable] [container-type:inline-size]"
      >
        {initialLoading ? (
          <div
            role="status"
            aria-label={t("fileBrowser.loadingDirectory")}
            className="space-y-2 p-1"
          >
            {Array.from({ length: 7 }, (_, index) => (
              <Skeleton
                key={index}
                className="h-8"
                style={{ width: `${82 - (index % 3) * 9}%` }}
              />
            ))}
          </div>
        ) : initialError || !rootPath ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-destructive">
              {t("fileBrowser.loadFailed")}
            </p>
            {initialError && (
              <p className="max-w-sm text-xs text-muted-foreground">
                {initialError}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onRetry()}
            >
              <RefreshCwIcon aria-hidden="true" />
              {t("fileBrowser.retry")}
            </Button>
          </div>
        ) : (
          <FileBrowserTree
            key={rootPath}
            compact={compact}
            loadingDirectories={loadingDirectories}
            model={model}
            query={query}
            rootPath={rootPath}
            selectedItemPath={selectedItemPath}
            onActionFeedback={announceAction}
            onDeleteRequest={onDeleteRequest}
            onDownload={onDownload}
            onItemSelect={onItemSelect}
            onUpload={onUpload}
            onVisibleRowsChange={handleVisibleRowsChange}
          />
        )}
      </div>
      <div
        className={cn(
          "flex shrink-0 items-center border-t text-xs text-muted-foreground",
          compact ? "h-7 px-2" : "h-9 px-3"
        )}
      >
        {t("fileBrowser.itemCount", { count: itemCount })}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  )
}
