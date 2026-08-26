import * as React from "react"

import { useSidebar } from "@/components/ui/sidebar"

import { type WorkspaceModuleId } from "./workspace-modules"

type WorkspaceFilesContextValue = {
  activeTabId: WorkspaceModuleId | null
  pendingFilePath: string | null
  fileOpenNonce: number
  openFileInWorkspace: (path: string) => void
  setActiveTabId: (id: WorkspaceModuleId | null) => void
}

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
  const [fileOpenNonce, setFileOpenNonce] = React.useState(0)

  const openFileInWorkspace = React.useCallback(
    (path: string) => {
      setPendingFilePath(path)
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

  const value = React.useMemo(
    () => ({
      activeTabId,
      pendingFilePath,
      fileOpenNonce,
      openFileInWorkspace,
      setActiveTabId,
    }),
    [activeTabId, fileOpenNonce, openFileInWorkspace, pendingFilePath]
  )

  return (
    <WorkspaceFilesContext.Provider value={value}>
      {children}
    </WorkspaceFilesContext.Provider>
  )
}

export function useWorkspaceFiles() {
  const context = React.useContext(WorkspaceFilesContext)
  if (!context) {
    throw new Error("useWorkspaceFiles must be used within WorkspaceFilesProvider")
  }
  return context
}

export function useOptionalWorkspaceFiles() {
  return React.useContext(WorkspaceFilesContext)
}
