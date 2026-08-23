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
  onResizeTree,
  panelTransitioning,
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
  onResizeTree: (sizePercentage: number) => void
  panelTransitioning: boolean
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
          {treeVisible ? treePane : filePreview}
        </div>
      ) : (
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1"
        >
          <ResizablePanel
            id="file-tree-panel"
            className="!flex !min-h-0 !overflow-hidden"
            panelRef={treePanelRef}
            defaultSize={`${treeDefaultSize}%`}
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
              className="flex h-full min-w-0 flex-1"
            >
              {treePane}
            </div>
          </ResizablePanel>
          <ResizableHandle
            aria-label={t("fileBrowser.resizePanels")}
            className={
              treeVisible || panelTransitioning
                ? "opacity-100"
                : "pointer-events-none opacity-0"
            }
          />
          <ResizablePanel
            id="file-preview-panel"
            minSize="35%"
            className="!flex !min-h-0 !overflow-hidden"
          >
            {filePreview}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </section>
  )
}
