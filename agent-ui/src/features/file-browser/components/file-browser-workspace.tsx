import * as React from "react"
import gsap from "gsap"
import { useTranslation } from "react-i18next"

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

export function FileBrowserWorkspace({
  compact = false,
  filePreview,
  fitAnimating = false,
  onMinimumWidthChange,
  onResizeTree,
  onUserResizeTree,
  panelTransitioning,
  previewPaneContentRef,
  previewPaneId,
  previewVisible,
  treeDefaultSize,
  treeMaxSize,
  treeMinSize,
  treePane,
  treePaneContentRef,
  treePanelRef,
  treeVisible,
}: {
  compact?: boolean
  filePreview: React.ReactNode
  /** While the tree fits itself to long names, per-frame toolbar resizes are ignored. */
  fitAnimating?: boolean
  onMinimumWidthChange?: (width: number) => void
  onResizeTree: (sizePercentage: number) => void
  onUserResizeTree: () => void
  panelTransitioning: boolean
  previewPaneContentRef: React.RefObject<HTMLDivElement | null>
  previewPaneId: string
  previewVisible: boolean
  treeDefaultSize: number
  treeMaxSize: number
  treeMinSize: number
  treePane: React.ReactNode
  treePaneContentRef: React.RefObject<HTMLDivElement | null>
  treePanelRef: React.ComponentProps<typeof ResizablePanel>["panelRef"]
  treeVisible: boolean
}) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const pageRef = React.useRef<HTMLDivElement>(null)
  const [previewMinimumWidth, setPreviewMinimumWidth] = React.useState(0)

  React.useLayoutEffect(() => {
    if (isMobile) {
      return
    }
    if (!previewVisible) {
      if (!panelTransitioning) onMinimumWidthChange?.(0)
      return
    }

    const controls = pageRef.current?.querySelector<HTMLElement>(
      "[data-file-preview-controls]"
    )
    const toolbar = controls?.closest<HTMLElement>(
      ".file-preview-toolbar"
    )

    if (!controls || !toolbar) {
      return
    }

    // The fit animation shrinks the preview toolbar every frame; measuring
    // then forces layout per frame and feeds two state updates. Skip until the
    // animation ends, when this effect re-runs and measures the final size.
    if (fitAnimating) {
      return
    }

    const measure = () => {
      const toolbarStyles = getComputedStyle(toolbar)
      const horizontalPadding =
        (Number.parseFloat(toolbarStyles.paddingInlineStart) || 0) +
        (Number.parseFloat(toolbarStyles.paddingInlineEnd) || 0)
      const nextWidth = Math.ceil(
        controls.getBoundingClientRect().width + horizontalPadding
      )
      const handle = pageRef.current?.querySelector<HTMLElement>(
        '[data-slot="resizable-handle"]'
      )
      const pageStyles = pageRef.current
        ? getComputedStyle(pageRef.current)
        : null
      const pageChrome =
        (Number.parseFloat(pageStyles?.borderInlineStartWidth ?? "") || 0) +
        (Number.parseFloat(pageStyles?.borderInlineEndWidth ?? "") || 0) +
        (handle?.getBoundingClientRect().width ?? 0)
      const previewRatio = treeVisible ? 1 - treeMinSize / 100 : 1

      setPreviewMinimumWidth((currentWidth) =>
        currentWidth === nextWidth ? currentWidth : nextWidth
      )
      onMinimumWidthChange?.(
        Math.ceil(nextWidth / previewRatio + pageChrome)
      )
    }

    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(controls)
    observer.observe(toolbar)

    return () => {
      observer.disconnect()
    }
  }, [
    compact,
    fitAnimating,
    isMobile,
    onMinimumWidthChange,
    panelTransitioning,
    previewVisible,
    treeMinSize,
    treeVisible,
  ])

  React.useLayoutEffect(() => {
    if (!isMobile) {
      return
    }

    const pane = pageRef.current?.querySelector("[data-mobile-file-pane]")

    if (
      !pane ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return
    }

    const context = gsap.context(() => {
      gsap.fromTo(
        pane,
        { opacity: 0, y: 5 },
        {
          opacity: 1,
          y: 0,
          duration: 0.22,
          ease: "power2.out",
          clearProps: "transform,opacity",
        }
      )
    }, pageRef)

    return () => context.revert()
  }, [isMobile, treeVisible])

  return (
    <section
      ref={pageRef}
      data-file-browser-enter
      aria-label={t("fileBrowser.contentLabel")}
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden border bg-card text-card-foreground",
        compact ? "rounded-lg" : "rounded-xl"
      )}
    >
      {isMobile ? (
        <div data-mobile-file-pane className="flex min-h-0 flex-1">
          <div
            className={treeVisible ? "flex min-h-0 min-w-0 flex-1" : "hidden"}
            inert={!treeVisible}
            aria-hidden={!treeVisible}
          >
            {treePane}
          </div>
          <div
            id={previewPaneId}
            className={treeVisible ? "hidden" : "flex min-h-0 min-w-0 flex-1"}
            inert={treeVisible}
            aria-hidden={treeVisible}
          >
            {filePreview}
          </div>
        </div>
      ) : (
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1"
          onLayoutChanged={(_layout, meta) => {
            if (meta.isUserInteraction) {
              onUserResizeTree()
            }
          }}
        >
          <ResizablePanel
            id="file-tree-panel"
            className="!flex !min-h-0 !justify-end !overflow-hidden"
            panelRef={treePanelRef}
            defaultSize={`${treeVisible ? (previewVisible ? treeDefaultSize : 100) : 0}%`}
            minSize={
              treeVisible && !panelTransitioning
                ? `${treeMinSize}%`
                : "0%"
            }
            maxSize={`${treeMaxSize}%`}
            onResize={(size) => onResizeTree(size.asPercentage)}
          >
            <div
              id="file-browser-tree-pane"
              ref={treePaneContentRef}
              aria-hidden={!treeVisible}
              inert={!treeVisible}
              className={cn("flex h-full min-w-0 flex-1", !treeVisible && !panelTransitioning && "invisible")}
            >
              {treePane}
            </div>
          </ResizablePanel>
          <ResizableHandle
            aria-label={t("fileBrowser.resizePanels")}
            disabled={!treeVisible || !previewVisible || panelTransitioning}
            className={
              (treeVisible && previewVisible) || panelTransitioning
                ? "opacity-100"
                : "pointer-events-none opacity-0"
            }
          />
          <ResizablePanel
            id="file-preview-panel"
            minSize={previewVisible && !panelTransitioning ? previewMinimumWidth : 0}
            maxSize={previewVisible || panelTransitioning ? "100%" : "0%"}
            className="!flex !min-h-0 !overflow-hidden"
          >
            <div
              id={previewPaneId}
              ref={previewPaneContentRef}
              style={{ minWidth: previewMinimumWidth }}
              className={cn("flex min-h-0 min-w-0 flex-1", !previewVisible && !panelTransitioning && "invisible")}
              inert={!previewVisible}
              aria-hidden={!previewVisible}
            >
              {filePreview}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </section>
  )
}
