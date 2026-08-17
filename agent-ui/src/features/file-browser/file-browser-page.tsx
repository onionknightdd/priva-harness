import * as React from "react"
import gsap from "gsap"
import { usePanelRef } from "react-resizable-panels"
import { useTranslation } from "react-i18next"

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { RichFilePreview } from "@/features/files"
import { useIsMobile } from "@/hooks/use-mobile"

import { FileAddressBar } from "./components/file-address-bar"
import {
  CreateFolderDialog,
  DeletePathDialog,
} from "./components/file-operation-dialogs"
import { FileTreePane } from "./components/file-tree-pane"
import { startFileDownload } from "./file-browser-api"
import type { FileBrowserItem } from "./file-browser-data"
import { useFileBrowser } from "./use-file-browser"

const TREE_DEFAULT_SIZE = 30
const TREE_MIN_SIZE = 18
const TREE_MAX_SIZE = 65

function clampTreeSize(size: number) {
  return Math.min(TREE_MAX_SIZE, Math.max(TREE_MIN_SIZE, size))
}

export function FileBrowserPage() {
  const { t } = useTranslation()
  const browser = useFileBrowser()
  const isMobile = useIsMobile()
  const pageRef = React.useRef<HTMLDivElement>(null)
  const treePaneContentRef = React.useRef<HTMLDivElement>(null)
  const panelAnimationRef = React.useRef<gsap.core.Timeline | null>(null)
  const previousTreeSizeRef = React.useRef(TREE_DEFAULT_SIZE)
  const uploadInputRef = React.useRef<HTMLInputElement>(null)
  const uploadDirectoryRef = React.useRef<string | null>(null)
  const announcementTimerRef = React.useRef<number | null>(null)
  const treePanelRef = usePanelRef()
  const [treeVisible, setTreeVisible] = React.useState(true)
  const [panelTransitioning, setPanelTransitioning] = React.useState(false)
  const [createFolderDirectory, setCreateFolderDirectory] = React.useState<
    string | null
  >(null)
  const [deleteTarget, setDeleteTarget] = React.useState<FileBrowserItem | null>(
    null
  )
  const [announcement, setAnnouncement] = React.useState("")

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
      2400
    )
  }, [])

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

        const sizeState = { value: visible ? 0 : currentSize }
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

  const handleItemSelect = async (
    path: string,
    shouldLoadDirectory: boolean
  ) => {
    const item = browser.model.items[path]
    await browser.selectItem(path, shouldLoadDirectory)

    if (isMobile && item?.type === "file") {
      setTreeVisible(false)
    }
  }

  const handleBreadcrumbNavigate = (
    path: string,
    type: FileBrowserItem["type"]
  ) => {
    void browser.navigateBreadcrumb(path, type)
    if (isMobile && type === "file") {
      setTreeVisible(false)
    }
  }

  const handleUploadRequest = (directory: string) => {
    uploadDirectoryRef.current = directory
    if (uploadInputRef.current) {
      uploadInputRef.current.value = ""
      uploadInputRef.current.click()
    }
  }

  const handleUploadSelection = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const directory = uploadDirectoryRef.current
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ""

    if (!directory || files.length === 0) {
      return
    }

    try {
      await browser.uploadFiles(directory, files)
      announce(t("fileBrowser.uploadComplete", { count: files.length }))
    } catch (error) {
      announce(error instanceof Error ? error.message : String(error))
    }
  }

  const handleDownload = (item: FileBrowserItem) => {
    if (item.type === "file") {
      startFileDownload(item.path, item.name)
    }
  }

  const treePane = (
    <FileTreePane
      initialError={browser.initialError}
      initialLoading={browser.initialLoading}
      loadingDirectories={browser.loadingDirectories}
      model={browser.model}
      rootPath={browser.rootPath}
      selectedItemPath={browser.selectedItemPath}
      onDeleteRequest={setDeleteTarget}
      onDownload={handleDownload}
      onItemSelect={handleItemSelect}
      onRefresh={browser.refreshLoadedDirectories}
      onRetry={browser.loadInitialDirectory}
      onUpload={handleUploadRequest}
    />
  )

  const filePreview = (
    <RichFilePreview
      activeFileId={browser.activeFileId}
      expanded={!treeVisible}
      files={browser.openedFiles}
      onActiveFileChange={browser.setActiveFile}
      onCloseAll={browser.closeAllFiles}
      onDownload={(file) => startFileDownload(file.path, file.name)}
      onFileClose={browser.closeFile}
      onExpandedChange={(expanded) =>
        handleTreeVisibilityChange(!expanded)
      }
    />
  )

  return (
    <div
      ref={pageRef}
      className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden p-4 pt-0"
    >
      <FileAddressBar
        breadcrumb={browser.breadcrumb}
        currentDirectory={browser.currentDirectory}
        model={browser.model}
        treeVisible={treeVisible}
        onCreateFolder={setCreateFolderDirectory}
        onGoTo={browser.goToDirectory}
        onNavigate={handleBreadcrumbNavigate}
        onTreeVisibilityChange={handleTreeVisibilityChange}
        onUpload={handleUploadRequest}
      />

      <section
        data-file-browser-enter
        aria-label={t("fileBrowser.contentLabel")}
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card text-card-foreground"
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

      <input
        ref={uploadInputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => void handleUploadSelection(event)}
      />
      <CreateFolderDialog
        directory={createFolderDirectory}
        onOpenChange={(open) => {
          if (!open) {
            setCreateFolderDirectory(null)
          }
        }}
        onCreate={async (directory, name) => {
          await browser.makeDirectory(directory, name)
          announce(t("fileBrowser.createDialog.complete", { name }))
        }}
      />
      <DeletePathDialog
        item={deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
          }
        }}
        onDelete={async (item) => {
          await browser.deleteItem(item)
          announce(t("fileBrowser.deleteDialog.complete", { name: item.name }))
        }}
      />
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  )
}
