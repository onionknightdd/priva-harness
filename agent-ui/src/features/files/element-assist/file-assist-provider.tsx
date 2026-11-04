import * as React from "react"
import { useTranslation } from "react-i18next"

import type { FileAnnotationInput, ElementFileAnnotation } from "@/features/agent-message/file-annotation"
import type { FilePreviewMode, PreviewFile } from "@/features/files/model/file.types"
import { useOptionalWorkspaceFiles } from "@/features/workspace/workspace-files-context"

import type { OfficeElementTarget } from "../office-assist/office-assist.types"
import { HTML_TARGET_LIMITS, type HtmlElementTarget } from "../html-assist/html-assist.types"

export type FileElementTarget = OfficeElementTarget | HtmlElementTarget

export type SavedFileSelection = { annotation: ElementFileAnnotation; question: string }
type FileSession = { revision: string; nextIndex: number; items: SavedFileSelection[] }
type SelectionValidator = (annotations: ElementFileAnnotation[]) => Promise<boolean>

type FileAssistContextValue = {
  activeFile: PreviewFile | null
  enabled: boolean
  sending: boolean
  items: SavedFileSelection[]
  draft: FileElementTarget | null
  clearEpoch: number
  error: string | null
  registerRevision: (fileId: string, revision: string) => void
  registerValidator: (fileId: string, validate: SelectionValidator) => () => void
  lock: (target: FileElementTarget) => void
  cancelDraft: () => void
  confirm: (question: string) => void
  remove: (selectionId: string) => void
  clear: () => void
  send: () => Promise<void>
  reportError: (message: string | null) => void
}

const FileAssistContext = React.createContext<FileAssistContextValue | null>(null)

export function isFileAssistFile(file: PreviewFile | null) {
  return file?.renderKind === "document" || file?.renderKind === "presentation" || file?.renderKind === "html"
}

export function FileAssistProvider({ active = true, activeFile, files, mode, children }: {
  active?: boolean
  activeFile: PreviewFile | null
  files: PreviewFile[]
  mode: FilePreviewMode | null
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const workspace = useOptionalWorkspaceFiles()
  const [sessions, setSessions] = React.useState<Record<string, FileSession>>({})
  const [draft, setDraftState] = React.useState<FileElementTarget | null>(null)
  const [clearEpoch, setClearEpoch] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const [sending, setSending] = React.useState(false)
  const validators = React.useRef(new Map<string, SelectionValidator>())
  const delivery = React.useRef<symbol | null>(null)
  const draftRef = React.useRef(draft)
  draftRef.current = draft
  const setDraft = React.useCallback((target: FileElementTarget | null) => {
    draftRef.current = target
    setDraftState(target)
  }, [])
  const invalidateDelivery = React.useCallback(() => {
    delivery.current = null
    setSending(false)
  }, [])
  const enabled = active && mode === "edit" && isFileAssistFile(activeFile)
  const enabledRef = React.useRef(enabled)
  enabledRef.current = enabled
  const activeRef = React.useRef(activeFile)
  const sessionsRef = React.useRef(sessions)
  activeRef.current = activeFile
  sessionsRef.current = sessions
  const session = activeFile ? sessions[activeFile.id] : undefined
  const items = session?.items ?? []

  React.useEffect(() => {
    invalidateDelivery()
    setDraft(null)
    setError(null)
    setClearEpoch((epoch) => epoch + 1)
    // Mounted viewers keep their registered revision when a tab or panel closes.
    setSessions((current) => Object.fromEntries(Object.entries(current).map(([id, session]) => [
      id, { ...session, nextIndex: 1, items: [] },
    ])))
    return () => { delivery.current = null }
  }, [active, activeFile?.id, invalidateDelivery, mode, setDraft])

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

  const registerValidator = React.useCallback((fileId: string, validate: SelectionValidator) => {
    validators.current.set(fileId, validate)
    return () => {
      if (validators.current.get(fileId) === validate) validators.current.delete(fileId)
    }
  }, [])

  const registerRevision = React.useCallback((fileId: string, revision: string) => {
    const previous = sessionsRef.current[fileId]
    if (previous && previous.revision !== revision && activeRef.current?.id === fileId) {
      invalidateDelivery()
      setDraft(null)
      setClearEpoch((epoch) => epoch + 1)
    }
    setSessions((current) => current[fileId]?.revision === revision ? current : {
      ...current,
      [fileId]: { revision, nextIndex: 1, items: [] },
    })
  }, [invalidateDelivery, setDraft])
  const lock = React.useCallback((target: FileElementTarget) => {
    if (enabledRef.current && activeRef.current?.renderKind === target.kind) setDraft(target)
  }, [setDraft])
  const cancelDraft = React.useCallback(() => setDraft(null), [setDraft])
  const clear = React.useCallback(() => {
    invalidateDelivery()
    const fileId = activeRef.current?.id
    setDraft(null)
    setError(null)
    setClearEpoch((epoch) => epoch + 1)
    if (!fileId) return
    setSessions((current) => !current[fileId] ? current : {
      ...current,
      [fileId]: { ...current[fileId], nextIndex: 1, items: [] },
    })
  }, [invalidateDelivery, setDraft])
  const confirm = React.useCallback((question: string) => {
    const file = activeRef.current
    const draft = draftRef.current
    if (!enabledRef.current || !file || !draft || file.renderKind !== draft.kind) return
    const currentSession = sessionsRef.current[file.id]
    if (!currentSession) return
    if (draft.kind === "html" && currentSession.items.length >= HTML_TARGET_LIMITS.items) {
      setError(t("filePreview.htmlAssist.limitReached", { count: HTML_TARGET_LIMITS.items }))
      return
    }
    invalidateDelivery()
    setError(null)
    setSessions((current) => {
      const session = current[file.id]
      if (!session) return current
      const annotation: ElementFileAnnotation = {
        ...structuredClone(draft),
        filePath: file.path,
        fileRevision: session.revision,
        selectionId: crypto.randomUUID(),
        index: session.nextIndex,
        selectedText: draft.text,
      }
      return { ...current, [file.id]: {
        ...session,
        nextIndex: session.nextIndex + 1,
        items: [...session.items, { annotation, question }],
      } }
    })
    setDraft(null)
    setClearEpoch((epoch) => epoch + 1)
  }, [invalidateDelivery, setDraft, t])
  const remove = React.useCallback((selectionId: string) => {
    invalidateDelivery()
    const fileId = activeRef.current?.id
    if (!fileId) return
    setSessions((current) => !current[fileId] ? current : {
      ...current,
      [fileId]: { ...current[fileId], items: current[fileId].items.filter((item) => item.annotation.selectionId !== selectionId) },
    })
  }, [invalidateDelivery])
  const send = React.useCallback(async () => {
    const file = activeRef.current
    const items = file && sessionsRef.current[file.id]?.items
    if (!file || !items?.length || !enabledRef.current || delivery.current) return
    const request = Symbol("file-annotation-delivery")
    delivery.current = request
    setSending(true)
    // Confirmation and delivery are separate: never include the unfinished draft.
    setDraft(null)
    setClearEpoch((epoch) => epoch + 1)
    const batch: FileAnnotationInput[] = items.map(({ annotation, question }) => ({ annotation, question }))
    try {
      const validate = validators.current.get(file.id)
      if (file.renderKind === "html" && !validate) throw new Error(t("filePreview.officeAssist.sendFailed"))
      if (validate && !await validate(items.map((item) => item.annotation))) return
      if (delivery.current !== request || !enabledRef.current || activeRef.current?.id !== file.id || sessionsRef.current[file.id]?.items !== items) return
      if (!workspace?.insertFileAnnotations(batch)) {
        setError(t("filePreview.officeAssist.sendFailed"))
        return
      }
      clear()
    } catch (reason) {
      if (delivery.current === request) setError(reason instanceof Error ? reason.message : t("filePreview.officeAssist.sendFailed"))
    } finally {
      if (delivery.current === request) {
        delivery.current = null
        setSending(false)
      }
    }
  }, [clear, setDraft, t, workspace])

  return (
    <FileAssistContext value={{
      activeFile, enabled, sending, items, draft, clearEpoch, error,
      registerRevision, registerValidator, lock, cancelDraft, confirm, remove, clear, send, reportError: setError,
    }}>
      {children}
    </FileAssistContext>
  )
}

export function useFileAssist() {
  return React.useContext(FileAssistContext)
}
