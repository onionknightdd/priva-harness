import * as React from "react"

import { useSidebar } from "@/components/ui/sidebar"
import type { FilePreviewMode } from "@/features/files/model/file.types"
import type { FileAnnotation, FileAnnotationInput, OfficeFileAnnotation } from "@/features/agent-message/file-annotation"

import { type WorkspaceModuleId } from "./workspace-modules"

export type OpenFileInWorkspaceOptions = {
  previewMode?: FilePreviewMode
  annotation?: OfficeFileAnnotation
}

// Tab selection lives in its own context so that switching tabs does not
// re-render the chat transcript and the kept-mounted file browser, which only
// subscribe to the file-open request below.
type WorkspaceTabContextValue = {
  activeTabId: WorkspaceModuleId | null
  setActiveTabId: (id: WorkspaceModuleId | null) => void
}

type WorkspaceFilesContextValue = {
  pendingFilePath: string | null
  pendingPreviewMode: FilePreviewMode | null
  pendingAnnotation: OfficeFileAnnotation | null
  fileOpenNonce: number
  openFileInWorkspace: (
    path: string,
    options?: OpenFileInWorkspaceOptions
  ) => void
  clearPendingAnnotation: (selectionId: string) => void
  insertFileAnnotation: (annotation: FileAnnotation, question: string) => boolean
  insertFileAnnotations: (items: readonly FileAnnotationInput[]) => boolean
  registerFileAnnotationComposer: (handler: (items: readonly FileAnnotationInput[]) => boolean) => () => void
}

const WorkspaceTabContext =
  React.createContext<WorkspaceTabContextValue | null>(null)
const WorkspaceFilesContext =
  React.createContext<WorkspaceFilesContextValue | null>(null)
const OpenWorkspaceTabContext =
  React.createContext<((id: WorkspaceModuleId) => void) | null>(null)

export function WorkspaceFilesProvider({
  children,
  onShowChat,
}: {
  children: React.ReactNode
  onShowChat?: () => void
}) {
  const { isMobile, setOpen, setOpenMobile } = useSidebar()
  const [activeTabId, setActiveTabId] =
    React.useState<WorkspaceModuleId | null>(null)
  const [pendingFilePath, setPendingFilePath] = React.useState<string | null>(
    null
  )
  const [pendingPreviewMode, setPendingPreviewMode] =
    React.useState<FilePreviewMode | null>(null)
  const [fileOpenNonce, setFileOpenNonce] = React.useState(0)
  const [pendingAnnotation, setPendingAnnotation] = React.useState<OfficeFileAnnotation | null>(null)
  const composer = React.useRef<((items: readonly FileAnnotationInput[]) => boolean) | null>(null)
  const pendingAnnotations = React.useRef<FileAnnotationInput[]>([])
  const registerFileAnnotationComposer = React.useCallback((handler: (items: readonly FileAnnotationInput[]) => boolean) => {
    composer.current = handler
    if (pendingAnnotations.current.length && handler(pendingAnnotations.current)) pendingAnnotations.current = []
    return () => { if (composer.current === handler) composer.current = null }
  }, [])
  const insertAnnotations = React.useCallback((items: readonly FileAnnotationInput[], queueIfUnavailable = false) => {
    if (!items.length) return false
    onShowChat?.()
    const inserted = composer.current?.(items) ?? false
    if (!inserted && !queueIfUnavailable) return false
    if (!inserted) pendingAnnotations.current.push(...items)
    if (isMobile) setOpenMobile(false)
    return true
  }, [isMobile, onShowChat, setOpenMobile])
  const insertFileAnnotations = React.useCallback((items: readonly FileAnnotationInput[]) => (
    insertAnnotations(items)
  ), [insertAnnotations])
  const insertFileAnnotation = React.useCallback((annotation: FileAnnotation, question: string) => (
    insertAnnotations([{ annotation, question }], true)
  ), [insertAnnotations])
  const clearPendingAnnotation = React.useCallback((selectionId: string) => {
    setPendingAnnotation((current) => current?.selectionId === selectionId ? null : current)
  }, [])

  const openWorkspaceTab = React.useCallback((id: WorkspaceModuleId) => {
    setActiveTabId(id)
    if (isMobile) setOpenMobile(true)
    else setOpen(true)
  }, [isMobile, setOpen, setOpenMobile])

  const openFileInWorkspace = React.useCallback(
    (path: string, options?: OpenFileInWorkspaceOptions) => {
      setPendingFilePath(path)
      setPendingPreviewMode(options?.previewMode ?? null)
      setPendingAnnotation(options?.annotation ?? null)
      setFileOpenNonce((current) => current + 1)
      openWorkspaceTab("files")
    },
    [openWorkspaceTab]
  )

  const tabValue = React.useMemo(
    () => ({ activeTabId, setActiveTabId }),
    [activeTabId]
  )

  const filesValue = React.useMemo(
    () => ({
      pendingFilePath,
      pendingPreviewMode,
      pendingAnnotation,
      fileOpenNonce,
      openFileInWorkspace,
      insertFileAnnotation,
      insertFileAnnotations,
      registerFileAnnotationComposer,
      clearPendingAnnotation,
    }),
    [fileOpenNonce, openFileInWorkspace, pendingFilePath, pendingPreviewMode, pendingAnnotation, insertFileAnnotation, insertFileAnnotations, registerFileAnnotationComposer, clearPendingAnnotation]
  )

  return (
    <OpenWorkspaceTabContext.Provider value={openWorkspaceTab}>
      <WorkspaceTabContext.Provider value={tabValue}>
        <WorkspaceFilesContext.Provider value={filesValue}>
          {children}
        </WorkspaceFilesContext.Provider>
      </WorkspaceTabContext.Provider>
    </OpenWorkspaceTabContext.Provider>
  )
}

export function useOpenWorkspaceTab() {
  const context = React.useContext(OpenWorkspaceTabContext)
  if (!context) throw new Error("useOpenWorkspaceTab must be used within WorkspaceFilesProvider")
  return context
}

export function useWorkspaceTab() {
  const context = React.useContext(WorkspaceTabContext)
  if (!context) {
    throw new Error("useWorkspaceTab must be used within WorkspaceFilesProvider")
  }
  return context
}

export function useOptionalWorkspaceFiles() {
  return React.useContext(WorkspaceFilesContext)
}
