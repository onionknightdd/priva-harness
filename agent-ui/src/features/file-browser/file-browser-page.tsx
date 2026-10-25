import * as React from "react"
import gsap from "gsap"
import { useTranslation } from "react-i18next"

import { RichFilePreview, type FilePreviewMode, type PreviewFile } from "@/features/files"
import { saveEditedHtmlFile } from "@/features/files/preview/save-edited-html-file"
import { useIsMobile } from "@/hooks/use-mobile"
import { startFileDownload } from "@/lib/api/sandbox-files"
import { cn } from "@/lib/utils"

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
import { useOptionalWorkspaceFiles } from "@/features/workspace"
import { createGitDecorations } from "@/features/git/git-data"
import { GitTreePane, GitPreviewPane, type GitSelection } from "@/features/git/git-panels"
import { useGitRepository } from "@/features/git/use-git-repository"
import { GIT_UPDATED_EVENT, type GitUpdatedDetail } from "@/lib/api/git-repository"
import { FileGitStatusProvider } from "./components/file-git-status"
import { FileGitWorkspace } from "./components/file-git-workspace"

export function FileBrowserPage({
  active = true,
  className,
  compact = false,
  initialDirectory,
  onMinimumWidthChange,
}: {
  active?: boolean
  className?: string
  compact?: boolean
  initialDirectory?: string
  onMinimumWidthChange?: (width: number) => void
}) {
  const { t } = useTranslation()
  const browser = useFileBrowser()
  const { openPath } = browser
  const workspaceFiles = useOptionalWorkspaceFiles()
  const [previewMode, setPreviewMode] = React.useState<
    FilePreviewMode | undefined
  >(undefined)
  const isMobile = useIsMobile()
  const pageRef = React.useRef<HTMLDivElement>(null)
  const previewPaneId = React.useId()
  const gitWorkspaceId = React.useId()
  const filesWorkspaceId = React.useId()
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
  const [view, setView] = React.useState("files")
  const [gitViewRoot, setGitViewRoot] = React.useState<string | null>(null)
  const [containerWidth, setContainerWidth] = React.useState(0)
  const [gitPreviewVisible, setGitPreviewVisible] = React.useState(false)
  const [gitSelectionState, setGitSelectionState] = React.useState<{ cwd: string | null; selection: GitSelection | null }>({ cwd: null, selection: null })
  const [initializedDirectory, setInitializedDirectory] = React.useState<string | undefined>()
  const filesNeedRefresh = React.useRef(false)
  const { goToDirectory, refreshLoadedDirectories, refreshOpenedFiles } = browser
  const gitCwd = initialDirectory && initialDirectory !== initializedDirectory ? initialDirectory : browser.currentDirectory
  const handleGitMutation = React.useCallback(() => {
    void refreshLoadedDirectories().catch((error: unknown) => setAnnouncement(error instanceof Error ? error.message : String(error)))
    void refreshOpenedFiles()
  }, [refreshLoadedDirectories, refreshOpenedFiles])
  const git = useGitRepository({ cwd: gitCwd, active })
  const gitDecorations = React.useMemo(() => createGitDecorations(git.repository), [git.repository])
  const gitSelection = gitSelectionState.cwd === gitCwd ? gitSelectionState.selection : null
  const narrowGit = isMobile || (containerWidth > 0 && containerWidth < 600)
  // Keep the return control available during a refresh failure in an open repository.
  const gitRoot = git.repository ? git.repository.root : view === "git" ? gitViewRoot : null
  const changeView = (next: string) => {
    if (next === view) return
    if (next === "files") setView("files")
    else if (next === "git" && git.repository?.root) {
      setGitViewRoot(git.repository.root)
      setView("git")
    }
  }
  const selectGitItem = (selection: GitSelection | null) => {
    setGitSelectionState({ cwd: gitCwd, selection })
    setGitPreviewVisible(Boolean(selection))
  }

  React.useEffect(() => {
    if (view !== "git") return
    if ((git.repository && !git.repository.root) ||
      (gitViewRoot && browser.breadcrumb.length > 0 && !browser.breadcrumb.some((entry) => entry.path === gitViewRoot))) {
      setView("files")
    }
  }, [browser.breadcrumb, git.repository, gitViewRoot, view])

  React.useEffect(() => {
    if (!initialDirectory || !browser.rootPath || initializedDirectory === initialDirectory) return
    let cancelled = false
    void goToDirectory(initialDirectory).then(() => {
      if (!cancelled) setInitializedDirectory(initialDirectory)
    })
    return () => { cancelled = true }
  }, [browser.rootPath, goToDirectory, initialDirectory, initializedDirectory])

  React.useLayoutEffect(() => {
    if (!pageRef.current) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) setContainerWidth(entry.contentRect.width)
    })
    observer.observe(pageRef.current)
    return () => observer.disconnect()
  }, [])

  React.useEffect(() => {
    if (view === "git") onMinimumWidthChange?.(0)
  }, [view, onMinimumWidthChange])

  React.useEffect(() => {
    if (!gitCwd) return
    if (active && filesNeedRefresh.current) {
      filesNeedRefresh.current = false
      handleGitMutation()
    }
    const onGitUpdated = (event: Event) => {
      const detail = (event as CustomEvent<GitUpdatedDetail>).detail
      if (!detail || detail.cwd === gitCwd || (detail.root && (gitCwd === detail.root || gitCwd.startsWith(`${detail.root.replace(/\/$/, "")}/`)))) {
        if (active) handleGitMutation()
        else filesNeedRefresh.current = true
      }
    }
    window.addEventListener(GIT_UPDATED_EVENT, onGitUpdated)
    return () => window.removeEventListener(GIT_UPDATED_EVENT, onGitUpdated)
  }, [active, gitCwd, handleGitMutation])
  const {
    TREE_DEFAULT_SIZE,
    TREE_MAX_SIZE,
    TREE_MIN_SIZE,
    panelTransitioning,
    fitAnimating,
    fitTreeToNameOverflow,
    markUserResizedTree,
    onTreeStructureChange,
    previewPaneContentRef,
    previewVisible,
    rememberTreeSize,
    setDesktopPreviewVisibility,
    setDesktopTreeVisibility,
    setTreeVisible,
    treePaneContentRef,
    treePanelRef,
    treeVisible,
  } = useTreePanelVisibility()

  const revealWorkspaceFile = React.useEffectEvent((mode: FilePreviewMode | undefined) => {
    setView("files")
    setPreviewMode(mode)
    if (isMobile) {
      setTreeVisible(false)
    } else {
      setDesktopPreviewVisibility(true)
    }
  })

  React.useLayoutEffect(() => {
    const page = pageRef.current

    if (
      compact ||
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
  }, [compact])

  React.useEffect(() => {
    if (!compact) {
      return
    }

    const path = workspaceFiles?.pendingFilePath
    if (!path) {
      return
    }

    const mode = workspaceFiles.pendingPreviewMode ?? undefined
    void openPath(path).then(() => {
      revealWorkspaceFile(mode)
    })
  }, [
    compact,
    isMobile,
    openPath,
    workspaceFiles?.fileOpenNonce,
    workspaceFiles?.pendingFilePath,
    workspaceFiles?.pendingPreviewMode,
  ])

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
    setPreviewMode(undefined)
    const item = browser.model.items[path]
    await browser.selectItem(path, shouldLoadDirectory)

    if (isMobile && item?.type === "file") {
      setTreeVisible(false)
    }
  }

  const handlePreviewVisibilityChange = (visible: boolean) => {
    if (isMobile) {
      setTreeVisible(!visible)
    } else {
      setDesktopPreviewVisibility(visible)
    }
  }

  const handleBreadcrumbNavigate = (
    path: string,
    type: FileBrowserItem["type"]
  ) => {
    setPreviewMode(undefined)
    void browser.navigateBreadcrumb(path, type)
    if (isMobile && type === "file") {
      setTreeVisible(false)
    }
  }

  const handleUploadRequest = React.useCallback((directory: string) => {
    uploadDirectoryRef.current = directory
    if (uploadInputRef.current) {
      uploadInputRef.current.value = ""
      uploadInputRef.current.click()
    }
  }, [])

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
      git.refresh()
      if (result.succeeded > 0) {
        announce(
          t("fileBrowser.uploadComplete", { count: result.succeeded })
        )
      }
    } catch (error) {
      announce(error instanceof Error ? error.message : String(error))
    }
  }

  const handleDownload = React.useCallback((item: FileBrowserItem) => {
    if (item.type === "file") {
      startFileDownload(item.path, item.name)
    }
  }, [])

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
    git.refresh()
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
    <FileGitStatusProvider decorations={gitDecorations}>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <FileTreePane
      compact={compact}
      initialError={browser.initialError}
      initialLoading={browser.initialLoading}
      loadingDirectories={browser.loadingDirectories}
      model={browser.model}
      rootPath={browser.rootPath}
      selectedItemPath={browser.selectedItemPath}
      onDeleteRequest={setDeleteTarget}
      onDownload={handleDownload}
      onItemSelect={handleItemSelect}
      onPreviewVisibilityChange={handlePreviewVisibilityChange}
      onRefresh={async () => { await browser.refreshLoadedDirectories(); git.refresh() }}
      onRetry={browser.loadInitialDirectory}
      onTreeStructureChange={onTreeStructureChange}
      onUpload={handleUploadRequest}
      onVisibleContentOverflow={view === "files" ? fitTreeToNameOverflow : undefined}
      previewPaneId={previewPaneId}
      previewVisible={isMobile ? !treeVisible : previewVisible}
    />
    </div>
    </FileGitStatusProvider>
  )

  const filePreview = (
    <RichFilePreview
      active={active && view === "files" && (isMobile ? !treeVisible : previewVisible)}
      activeFileId={browser.activeFileId}
      compact={compact}
      expanded={!treeVisible}
      files={browser.openedFiles}
      mode={previewMode}
      onActiveFileChange={(fileId) => {
        setPreviewMode(undefined)
        browser.setActiveFile(fileId)
      }}
      onModeChange={setPreviewMode}
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
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden p-4 pt-0",
        compact ? "gap-0" : "gap-1",
        className
      )}
    >
      <FileAddressBar
        breadcrumb={browser.breadcrumb}
        compact={compact}
        condensed={narrowGit}
        currentDirectory={browser.currentDirectory}
        git={gitRoot ? { root: gitRoot, active: view === "git", controls: { files: filesWorkspaceId, git: gitWorkspaceId }, onChange: changeView } : undefined}
        model={browser.model}
        treeVisible={treeVisible}
        onCreateFolder={setCreateFolderDirectory}
        onGoTo={browser.goToDirectory}
        onNavigate={handleBreadcrumbNavigate}
        onTreeVisibilityChange={view === "files" ? handleTreeVisibilityChange : undefined}
        onUpload={handleUploadRequest}
      />

      <div id={filesWorkspaceId} className={view === "files" ? "flex min-h-0 flex-1 flex-col" : "hidden"} inert={view !== "files"} aria-hidden={view !== "files"}>
      <FileBrowserWorkspace
        compact={compact}
        filePreview={filePreview}
        fitAnimating={fitAnimating}
        onMinimumWidthChange={view === "files" ? onMinimumWidthChange : undefined}
        onResizeTree={rememberTreeSize}
        onUserResizeTree={markUserResizedTree}
        panelTransitioning={panelTransitioning}
        previewPaneContentRef={previewPaneContentRef}
        previewPaneId={previewPaneId}
        previewVisible={previewVisible}
        treeDefaultSize={TREE_DEFAULT_SIZE}
        treeMaxSize={TREE_MAX_SIZE}
        treeMinSize={TREE_MIN_SIZE}
        treePane={treePane}
        treePaneContentRef={treePaneContentRef}
        treePanelRef={treePanelRef}
        treeVisible={treeVisible}
      />
      </div>
      <div id={gitWorkspaceId} className={view === "git" ? "flex min-h-0 flex-1 flex-col" : "hidden"} inert={view !== "git"} aria-hidden={view !== "git"}>
        <FileGitWorkspace compact={compact} narrow={narrowGit} showPreview={gitPreviewVisible && Boolean(gitSelection)}
          tree={<GitTreePane controller={git} selection={gitSelection} onSelectionChange={selectGitItem} active={active && view === "git"} />}
          preview={<GitPreviewPane controller={git} selection={gitSelection} onSelectionChange={selectGitItem}
            active={active && view === "git" && (!narrowGit || gitPreviewVisible)}
            onBack={narrowGit ? () => setGitPreviewVisible(false) : undefined}
            onOpenFile={(path) => { void openPath(path).then(() => {
              setView("files")
              setPreviewMode(undefined)
              if (isMobile) setTreeVisible(false)
              else setDesktopPreviewVisibility(true)
            }) }} />}
        />
      </div>

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
          git.refresh()
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
          git.refresh()
          announce(t("fileBrowser.deleteDialog.complete", { name: item.name }))
        }}
      />
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  )
}
