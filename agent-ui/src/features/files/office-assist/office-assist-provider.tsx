import * as React from "react"
import { useTranslation } from "react-i18next"

import type { FileAnnotationInput, OfficeFileAnnotation } from "@/features/agent-message/file-annotation"
import type { FilePreviewMode, PreviewFile } from "@/features/files/model/file.types"
import { useOptionalWorkspaceFiles } from "@/features/workspace/workspace-files-context"

import type { OfficeElementTarget } from "./office-assist.types"

export type SavedOfficeSelection = { annotation: OfficeFileAnnotation; question: string }
type FileSession = { revision: string; nextIndex: number; items: SavedOfficeSelection[] }

type OfficeAssistContextValue = {
  activeFile: PreviewFile | null
  enabled: boolean
  items: SavedOfficeSelection[]
  draft: OfficeElementTarget | null
  clearEpoch: number
  error: string | null
  registerRevision: (fileId: string, revision: string) => void
  lock: (target: OfficeElementTarget) => void
  cancelDraft: () => void
  confirm: (question: string) => void
  remove: (selectionId: string) => void
  clear: () => void
  send: () => void
  reportError: (message: string | null) => void
}

const OfficeAssistContext = React.createContext<OfficeAssistContextValue | null>(null)

export function isOfficeAssistFile(file: PreviewFile | null) {
  return file?.renderKind === "document" || file?.renderKind === "presentation"
}

export function OfficeAssistProvider({ active = true, activeFile, files, mode, children }: {
  active?: boolean
  activeFile: PreviewFile | null
  files: PreviewFile[]
  mode: FilePreviewMode | null
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const workspace = useOptionalWorkspaceFiles()
  const [sessions, setSessions] = React.useState<Record<string, FileSession>>({})
  const [draft, setDraft] = React.useState<OfficeElementTarget | null>(null)
  const [clearEpoch, setClearEpoch] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const enabled = active && mode === "edit" && isOfficeAssistFile(activeFile)
  const activeRef = React.useRef(activeFile)
  const sessionsRef = React.useRef(sessions)
  activeRef.current = activeFile
  sessionsRef.current = sessions
  const session = activeFile ? sessions[activeFile.id] : undefined
  const items = session?.items ?? []

  React.useEffect(() => {
    setDraft(null)
    setError(null)
    setClearEpoch((epoch) => epoch + 1)
    // Mounted viewers keep their registered revision when a tab or panel closes.
    setSessions((current) => Object.fromEntries(Object.entries(current).map(([id, session]) => [
      id, { ...session, nextIndex: 1, items: [] },
    ])))
  }, [active, activeFile?.id, mode])

  React.useEffect(() => {
    const openIds = new Set(files.map((file) => file.id))
    setSessions((current) => {
      const closed = Object.keys(current).filter((id) => !openIds.has(id))
      if (!closed.length) return current
      const next = { ...current }
      for (const id of closed) delete next[id]
      return next
    })
  }, [files])

  const registerRevision = React.useCallback((fileId: string, revision: string) => {
    const previous = sessionsRef.current[fileId]
    if (previous && previous.revision !== revision && activeRef.current?.id === fileId) {
      setDraft(null)
      setClearEpoch((epoch) => epoch + 1)
    }
    setSessions((current) => current[fileId]?.revision === revision ? current : {
      ...current,
      [fileId]: { revision, nextIndex: 1, items: [] },
    })
  }, [])
  const cancelDraft = React.useCallback(() => setDraft(null), [])
  const clear = React.useCallback(() => {
    const fileId = activeRef.current?.id
    setDraft(null)
    setError(null)
    setClearEpoch((epoch) => epoch + 1)
    if (!fileId) return
    setSessions((current) => !current[fileId] ? current : {
      ...current,
      [fileId]: { ...current[fileId], nextIndex: 1, items: [] },
    })
  }, [])
  const confirm = React.useCallback((question: string) => {
    const file = activeRef.current
    if (!enabled || !file || !draft) return
    setSessions((current) => {
      const session = current[file.id]
      if (!session) return current
      const annotation: OfficeFileAnnotation = {
        kind: draft.kind,
        filePath: file.path,
        fileRevision: session.revision,
        selectionId: crypto.randomUUID(),
        index: session.nextIndex,
        elementType: draft.elementType,
        selectedText: draft.text,
        coordinateSpace: draft.coordinateSpace,
        boxes: structuredClone(draft.boxes),
        locator: structuredClone(draft.locator),
      }
      return { ...current, [file.id]: {
        ...session,
        nextIndex: session.nextIndex + 1,
        items: [...session.items, { annotation, question }],
      } }
    })
    setDraft(null)
    setClearEpoch((epoch) => epoch + 1)
  }, [draft, enabled])
  const remove = React.useCallback((selectionId: string) => {
    const fileId = activeRef.current?.id
    if (!fileId) return
    setSessions((current) => !current[fileId] ? current : {
      ...current,
      [fileId]: { ...current[fileId], items: current[fileId].items.filter((item) => item.annotation.selectionId !== selectionId) },
    })
  }, [])
  const send = React.useCallback(() => {
    const file = activeRef.current
    const items = file && sessionsRef.current[file.id]?.items
    if (!items?.length) return
    // Confirmation and delivery are separate: never include the unfinished draft.
    setDraft(null)
    setClearEpoch((epoch) => epoch + 1)
    const batch: FileAnnotationInput[] = items.map(({ annotation, question }) => ({ annotation, question }))
    try {
      if (!workspace?.insertFileAnnotations(batch)) {
        setError(t("filePreview.officeAssist.sendFailed"))
        return
      }
      clear()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("filePreview.officeAssist.sendFailed"))
    }
  }, [clear, t, workspace])

  return (
    <OfficeAssistContext value={{
      activeFile, enabled, items, draft, clearEpoch, error,
      registerRevision, lock: setDraft, cancelDraft, confirm, remove, clear, send, reportError: setError,
    }}>
      {children}
    </OfficeAssistContext>
  )
}

export function useOfficeAssist() {
  return React.useContext(OfficeAssistContext)
}
