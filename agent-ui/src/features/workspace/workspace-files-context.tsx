import * as React from "react"

import { useSidebar } from "@/components/ui/sidebar"
import type { FilePreviewMode } from "@/features/files/model/file.types"
import type { FileAnnotation } from "@/features/agent-message/file-annotation"

import { type WorkspaceModuleId } from "./workspace-modules"

export type OpenFileInWorkspaceOptions = {
  previewMode?: FilePreviewMode
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
  fileOpenNonce: number
  openFileInWorkspace: (
    path: string,
    options?: OpenFileInWorkspaceOptions
  ) => void
  insertFileAnnotation: (annotation: FileAnnotation, question: string) => void
  registerFileAnnotationComposer: (handler: (annotation: FileAnnotation, question: string) => void) => () => void
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
  const composer = React.useRef<((annotation: FileAnnotation, question: string) => void) | null>(null)
  const pendingAnnotations = React.useRef<{ annotation: FileAnnotation; question: string }[]>([])
  const registerFileAnnotationComposer = React.useCallback((handler: (annotation: FileAnnotation, question: string) => void) => {
    composer.current = handler
    for (const { annotation, question } of pendingAnnotations.current.splice(0)) handler(annotation, question)
    return () => { if (composer.current === handler) composer.current = null }
  }, [])
  const insertFileAnnotation = React.useCallback((annotation: FileAnnotation, question: string) => {
    onShowChat?.()
    if (isMobile) setOpenMobile(false)
    if (composer.current) composer.current(annotation, question)
    else pendingAnnotations.current.push({ annotation, question })
  }, [isMobile, onShowChat, setOpenMobile])

  const openWorkspaceTab = React.useCallback((id: WorkspaceModuleId) => {
    setActiveTabId(id)
    if (isMobile) setOpenMobile(true)
    else setOpen(true)
  }, [isMobile, setOpen, setOpenMobile])

  const openFileInWorkspace = React.useCallback(
    (path: string, options?: OpenFileInWorkspaceOptions) => {
      setPendingFilePath(path)
      setPendingPreviewMode(options?.previewMode ?? null)
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
      fileOpenNonce,
      openFileInWorkspace,
      insertFileAnnotation,
      registerFileAnnotationComposer,
    }),
    [fileOpenNonce, openFileInWorkspace, pendingFilePath, pendingPreviewMode, insertFileAnnotation, registerFileAnnotationComposer]
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
