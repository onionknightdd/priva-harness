import * as React from "react"

import { useUploadQueue } from "@/features/uploads"

import {
  createComposerAttachments,
  revokeComposerAttachment,
  type ComposerAttachment,
} from "./composer-attachments"

export function useComposerAttachments(cwd: string, harness: string | null, sessionId: string | null) {
  const { enqueueFiles } = useUploadQueue()
  const [attachments, setAttachments] = React.useState<ComposerAttachment[]>([])
  const attachmentsRef = React.useRef(attachments)
  const uploadsRef = React.useRef(new Map<string, () => void>())
  const scopeRef = React.useRef({ cwd, harness, sessionId })

  const replace = React.useCallback((next: ComposerAttachment[]) => {
    attachmentsRef.current = next
    setAttachments(next)
  }, [])

  const dispose = React.useCallback(() => {
    uploadsRef.current.forEach((cancel) => cancel())
    uploadsRef.current.clear()
    attachmentsRef.current.forEach(revokeComposerAttachment)
    attachmentsRef.current = []
  }, [])

  const clear = React.useCallback(() => {
    dispose()
    replace([])
  }, [dispose, replace])

  React.useEffect(() => dispose, [dispose])
  React.useEffect(() => {
    const previous = scopeRef.current
    scopeRef.current = { cwd, harness, sessionId }
    // A draft may change working directory while its attachments are uploading.
    // Uploaded files keep their absolute paths and remain usable in that draft.
    const changingDraftDirectory = previous.sessionId === null && sessionId === null
    if ((previous.cwd !== cwd && !changingDraftDirectory) || previous.harness !== harness ||
      (previous.sessionId !== null && previous.sessionId !== sessionId)) clear()
  }, [cwd, harness, sessionId, clear])

  const update = React.useCallback((id: string, patch: Partial<ComposerAttachment>) => {
    replace(attachmentsRef.current.map((item) => item.id === id ? { ...item, ...patch } : item))
  }, [replace])

  const upload = React.useCallback((attachment: ComposerAttachment) => {
    update(attachment.id, { status: "uploading", progress: 0, error: undefined })
    const batch = enqueueFiles(cwd, [attachment.file], {
      purpose: "attachment",
      onProgress: (_, progress) => update(attachment.id, { progress }),
    })
    uploadsRef.current.set(attachment.id, batch.cancel)
    void batch.completion.then(({ results }) => {
      if (uploadsRef.current.get(attachment.id) !== batch.cancel) return
      uploadsRef.current.delete(attachment.id)
      const result = results[0]
      if (result?.status === "succeeded") {
        update(attachment.id, {
          status: "done",
          progress: 100,
          uploaded: {
            path: result.file.path,
            name: result.file.name,
            size: result.file.size,
            mimeType: attachment.file.type || "application/octet-stream",
          },
        })
      } else {
        update(attachment.id, {
          status: "error",
          error: result?.status === "failed" ? result.error : undefined,
        })
      }
    })
  }, [cwd, enqueueFiles, update])

  const add = React.useCallback((files: File[]) => {
    const next = createComposerAttachments(files)
    replace([...attachmentsRef.current, ...next])
    next.forEach(upload)
  }, [replace, upload])

  const remove = React.useCallback((id: string) => {
    uploadsRef.current.get(id)?.()
    uploadsRef.current.delete(id)
    const removed = attachmentsRef.current.find((item) => item.id === id)
    if (removed) revokeComposerAttachment(removed)
    replace(attachmentsRef.current.filter((item) => item.id !== id))
  }, [replace])

  const retry = React.useCallback((id: string) => {
    const attachment = attachmentsRef.current.find((item) => item.id === id)
    if (attachment?.status === "error") upload(attachment)
  }, [upload])

  return { attachments, add, remove, retry, clear }
}
