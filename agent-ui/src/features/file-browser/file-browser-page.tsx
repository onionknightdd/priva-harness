import * as React from "react"
import gsap from "gsap"
import { useTranslation } from "react-i18next"

import { RichFilePreview, type PreviewFile } from "@/features/files"
import { saveEditedHtmlFile } from "@/features/files/preview/save-edited-html-file"
import { useIsMobile } from "@/hooks/use-mobile"
import { startFileDownload } from "@/lib/api/sandbox-files"

import { FileAddressBar } from "./components/file-address-bar"
import { FileBrowserWorkspace } from "./components/file-browser-workspace"
import {
  CreateFolderDialog,
  DeletePathDialog,
} from "./components/file-operation-dialogs"
import { FileTreePane } from "./components/file-tree-pane"
import {
  getFileBrowserParentPath,
  type FileBrowserItem,
} from "./file-browser-data"
import { useFileBrowser } from "./use-file-browser"
import { useTreePanelVisibility } from "./use-tree-panel-visibility"

export function FileBrowserPage() {
  const { t } = useTranslation()
  const browser = useFileBrowser()
  const isMobile = useIsMobile()
  const pageRef = React.useRef<HTMLDivElement>(null)
  const uploadInputRef = React.useRef<HTMLInputElement>(null)
  const uploadDirectoryRef = React.useRef<string | null>(null)
  const announcementTimerRef = React.useRef<number | null>(null)
  const [createFolderDirectory, setCreateFolderDirectory] = React.useState<
    string | null
  >(null)
  const [deleteTarget, setDeleteTarget] = React.useState<FileBrowserItem | null>(
    null
  )
  const [announcement, setAnnouncement] = React.useState("")
  const {
    TREE_DEFAULT_SIZE,
    TREE_MAX_SIZE,
    TREE_MIN_SIZE,
    panelTransitioning,
    rememberTreeSize,
    setDesktopTreeVisibility,
    setTreeVisible,
    treePaneContentRef,
    treePanelRef,
    treeVisible,
  } = useTreePanelVisibility()

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
      2400
    )
  }, [])

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
      const result = await browser.uploadFiles(directory, files)
      if (result.succeeded > 0) {
        announce(
          t("fileBrowser.uploadComplete", { count: result.succeeded })
        )
      }
    } catch (error) {
      announce(error instanceof Error ? error.message : String(error))
    }
  }

  const handleDownload = (item: FileBrowserItem) => {
    if (item.type === "file") {
      startFileDownload(item.path, item.name)
    }
  }

  const handleSaveHtml = async (file: PreviewFile) => {
    if (file.content === undefined) {
      throw new Error("Edited HTML content is not available")
    }

    const directory =
      getFileBrowserParentPath(file.path) ?? browser.rootPath

    if (!directory) {
      throw new Error("Edited HTML files need a workspace directory")
    }

    const uploaded = await saveEditedHtmlFile({
      content: file.content,
      directory,
      mediaType: file.mediaType,
      originalName: file.name,
    })

    await browser.refreshDirectory(directory).catch(() => undefined)
    await browser.openFile({
      path: uploaded.path,
      name: uploaded.name,
      type: "file",
      size: uploaded.size,
      modifiedAt: Date.now(),
      permissions: null,
      parentPath: directory,
    })

    return { fileName: uploaded.name }
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
      onSaveHtml={handleSaveHtml}
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

      <FileBrowserWorkspace
        filePreview={filePreview}
        onResizeTree={rememberTreeSize}
        panelTransitioning={panelTransitioning}
        treeDefaultSize={TREE_DEFAULT_SIZE}
        treeMaxSize={TREE_MAX_SIZE}
        treeMinSize={TREE_MIN_SIZE}
        treePane={treePane}
        treePaneContentRef={treePaneContentRef}
        treePanelRef={treePanelRef}
        treeVisible={treeVisible}
      />

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
