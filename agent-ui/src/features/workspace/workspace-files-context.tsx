import * as React from "react"

import { useSidebar } from "@/components/ui/sidebar"
import type { FilePreviewMode } from "@/features/files/model/file.types"

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
}

const WorkspaceTabContext =
  React.createContext<WorkspaceTabContextValue | null>(null)
const WorkspaceFilesContext =
  React.createContext<WorkspaceFilesContextValue | null>(null)

export function WorkspaceFilesProvider({
  children,
}: {
  children: React.ReactNode
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

  const openFileInWorkspace = React.useCallback(
    (path: string, options?: OpenFileInWorkspaceOptions) => {
      setPendingFilePath(path)
      setPendingPreviewMode(options?.previewMode ?? null)
      setFileOpenNonce((current) => current + 1)
      setActiveTabId("files")
      if (isMobile) {
        setOpenMobile(true)
      } else {
        setOpen(true)
      }
    },
    [isMobile, setOpen, setOpenMobile]
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
    }),
    [fileOpenNonce, openFileInWorkspace, pendingFilePath, pendingPreviewMode]
  )

  return (
    <WorkspaceTabContext.Provider value={tabValue}>
      <WorkspaceFilesContext.Provider value={filesValue}>
        {children}
      </WorkspaceFilesContext.Provider>
    </WorkspaceTabContext.Provider>
  )
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
