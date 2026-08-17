import * as React from "react"
import gsap from "gsap"
import { usePanelRef } from "react-resizable-panels"
import { useTranslation } from "react-i18next"

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import {
  RichFilePreview,
  type PreviewFile,
} from "@/features/files"
import { useIsMobile } from "@/hooks/use-mobile"

import { FileAddressBar } from "./components/file-address-bar"
import { FileTreePane } from "./components/file-tree-pane"
import {
  FILE_BROWSER_DEFAULT_ITEM_ID,
  fileBrowserItems,
} from "./file-browser-data"
import { getFileBrowserPreviewFile } from "./file-browser-preview-data"

const TREE_DEFAULT_SIZE = 30
const TREE_MIN_SIZE = 18
const TREE_MAX_SIZE = 65

function clampTreeSize(size: number) {
  return Math.min(TREE_MAX_SIZE, Math.max(TREE_MIN_SIZE, size))
}

export function FileBrowserPage() {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const pageRef = React.useRef<HTMLDivElement>(null)
  const treePaneContentRef = React.useRef<HTMLDivElement>(null)
  const panelAnimationRef = React.useRef<gsap.core.Timeline | null>(null)
  const previousTreeSizeRef = React.useRef(TREE_DEFAULT_SIZE)
  const treePanelRef = usePanelRef()
  const [selectedItemId, setSelectedItemId] = React.useState(
    FILE_BROWSER_DEFAULT_ITEM_ID
  )
  const [openedFileIds, setOpenedFileIds] = React.useState<string[]>([
    FILE_BROWSER_DEFAULT_ITEM_ID,
  ])
  const [activeFileId, setActiveFileId] = React.useState<string | null>(
    FILE_BROWSER_DEFAULT_ITEM_ID
  )
  const [treeVisible, setTreeVisible] = React.useState(true)
  const [panelTransitioning, setPanelTransitioning] = React.useState(false)
  const openedFiles = React.useMemo(
    () =>
      openedFileIds
        .map(getFileBrowserPreviewFile)
        .filter((file): file is PreviewFile => file !== null),
    [openedFileIds]
  )

  React.useLayoutEffect(() => {
    const page = pageRef.current

    if (
      !page ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return
    }

    const context = gsap.context(() => {
      gsap.fromTo(
        "[data-file-browser-enter]",
        { y: 8, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.32,
          stagger: 0.05,
          ease: "power2.out",
          clearProps: "transform,opacity",
        }
      )
    }, page)

    return () => context.revert()
  }, [])

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

  React.useEffect(
    () => () => {
      panelAnimationRef.current?.kill()
    },
    []
  )

  const setDesktopTreeVisibility = React.useCallback(
    (visible: boolean) => {
      const panel = treePanelRef.current
      const treeContent = treePaneContentRef.current

      if (!panel || !treeContent) {
        setTreeVisible(visible)
        return
      }

      panelAnimationRef.current?.kill()

      const currentSize = panel.getSize().asPercentage
      if (!visible && currentSize > 0) {
        previousTreeSizeRef.current = clampTreeSize(currentSize)
      }

      const targetSize = visible ? previousTreeSizeRef.current : 0
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches

      setPanelTransitioning(true)
      setTreeVisible(visible)

      window.requestAnimationFrame(() => {
        if (reducedMotion) {
          panel.resize(`${targetSize}%`)
          gsap.set(treeContent, {
            clearProps: "transform",
            opacity: visible ? 1 : 0,
          })
          setPanelTransitioning(false)
          return
        }

        if (visible) {
          panel.resize("0%")
          gsap.set(treeContent, { opacity: 0, x: -8 })
        }

        const sizeState = {
          value: visible ? 0 : currentSize,
        }
        const timeline = gsap.timeline({
          defaults: { duration: 0.3, ease: "power2.inOut" },
          onComplete: () => {
            setPanelTransitioning(false)
            gsap.set(treeContent, { clearProps: "transform,opacity" })
            panelAnimationRef.current = null
          },
        })

        timeline.to(
          sizeState,
          {
            value: targetSize,
            onUpdate: () => panel.resize(`${sizeState.value}%`),
          },
          0
        )
        timeline.to(
          treeContent,
          {
            opacity: visible ? 1 : 0,
            x: visible ? 0 : -8,
            duration: 0.2,
          },
          0
        )

        panelAnimationRef.current = timeline
      })
    },
    [treePanelRef]
  )

  const handleTreeVisibilityChange = (visible: boolean) => {
    if (visible === treeVisible && !panelTransitioning) {
      return
    }

    if (isMobile) {
      setTreeVisible(visible)
      return
    }

    setDesktopTreeVisibility(visible)
  }

  const handleNavigate = (itemId: string) => {
    setSelectedItemId(itemId)

    if (fileBrowserItems[itemId].type === "file") {
      const previewFile = getFileBrowserPreviewFile(itemId)

      if (previewFile) {
        setOpenedFileIds((currentFileIds) =>
          currentFileIds.includes(itemId)
            ? currentFileIds
            : [...currentFileIds, itemId]
        )
        setActiveFileId(itemId)
      }

      if (isMobile) {
        setTreeVisible(false)
      }
    }
  }

  const handleActiveFileChange = (fileId: string) => {
    setActiveFileId(fileId)
    setSelectedItemId(fileId)
  }

  const handleFileClose = (fileId: string) => {
    const fileIndex = openedFileIds.indexOf(fileId)

    if (fileIndex === -1) {
      return
    }

    setOpenedFileIds((currentFileIds) =>
      currentFileIds.filter((currentFileId) => currentFileId !== fileId)
    )

    if (fileId === activeFileId) {
      const adjacentFileId =
        openedFileIds[fileIndex + 1] ??
        openedFileIds[fileIndex - 1] ??
        null

      setActiveFileId(adjacentFileId)

      if (adjacentFileId) {
        setSelectedItemId(adjacentFileId)
      }
    }
  }

  const handleCloseAll = () => {
    setOpenedFileIds([])
    setActiveFileId(null)
  }

  return (
    <div
      ref={pageRef}
      className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden p-4 pt-0"
    >
      <FileAddressBar
        selectedItemId={selectedItemId}
        treeVisible={treeVisible}
        onNavigate={handleNavigate}
        onTreeVisibilityChange={handleTreeVisibilityChange}
      />

      <section
        data-file-browser-enter
        aria-label={t("fileBrowser.contentLabel")}
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card text-card-foreground"
      >
        {isMobile ? (
          <div data-mobile-file-pane className="flex min-h-0 flex-1">
            {treeVisible ? (
              <FileTreePane
                selectedItemId={selectedItemId}
                onItemSelect={handleNavigate}
              />
            ) : (
              <RichFilePreview
                activeFileId={activeFileId}
                expanded
                files={openedFiles}
                onActiveFileChange={handleActiveFileChange}
                onCloseAll={handleCloseAll}
                onFileClose={handleFileClose}
                onExpandedChange={(expanded) =>
                  handleTreeVisibilityChange(!expanded)
                }
              />
            )}
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
              defaultSize={`${TREE_DEFAULT_SIZE}%`}
              minSize={
                treeVisible && !panelTransitioning
                  ? `${TREE_MIN_SIZE}%`
                  : "0%"
              }
              maxSize={`${TREE_MAX_SIZE}%`}
              onResize={(size) => {
                if (
                  treeVisible &&
                  !panelTransitioning &&
                  size.asPercentage >= TREE_MIN_SIZE
                ) {
                  previousTreeSizeRef.current = clampTreeSize(
                    size.asPercentage
                  )
                }
              }}
            >
              <div
                id="file-browser-tree-pane"
                ref={treePaneContentRef}
                aria-hidden={!treeVisible}
                className="flex h-full min-w-0"
              >
                <FileTreePane
                  selectedItemId={selectedItemId}
                  onItemSelect={handleNavigate}
                />
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
              <RichFilePreview
                activeFileId={activeFileId}
                expanded={!treeVisible}
                files={openedFiles}
                onActiveFileChange={handleActiveFileChange}
                onCloseAll={handleCloseAll}
                onFileClose={handleFileClose}
                onExpandedChange={(expanded) =>
                  handleTreeVisibilityChange(!expanded)
                }
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </section>
    </div>
  )
}
