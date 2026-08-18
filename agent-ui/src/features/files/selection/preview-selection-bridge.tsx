import * as React from "react"

import type { PreviewFile } from "@/features/files/model/file.types"

import { PreviewSelectionBridgeContext } from "./preview-selection-context"
import type {
  PreviewSelection,
  PreviewSelectionPayload,
} from "./preview-selection.types"

export function PreviewSelectionBridgeProvider({
  activeFile,
  children,
  onSelectionChange,
  scopeKey,
}: {
  activeFile: PreviewFile | null
  children: React.ReactNode
  onSelectionChange?: (selection: PreviewSelection | null) => void
  scopeKey: string
}) {
  const activeFileRef = React.useRef(activeFile)
  const onSelectionChangeRef = React.useRef(onSelectionChange)
  const selectionRef = React.useRef<PreviewSelection | null>(null)
  const [selection, setSelection] =
    React.useState<PreviewSelection | null>(null)

  activeFileRef.current = activeFile
  onSelectionChangeRef.current = onSelectionChange

  const publish = React.useCallback(
    (nextSelection: PreviewSelection | null) => {
      selectionRef.current = nextSelection
      setSelection(nextSelection)
      onSelectionChangeRef.current?.(nextSelection)
    },
    []
  )

  const clearSelection = React.useCallback(
    (fileId?: string) => {
      if (fileId && activeFileRef.current?.id !== fileId) {
        return
      }

      if (selectionRef.current !== null) {
        publish(null)
      }
    },
    [publish]
  )

  const reportSelection = React.useCallback(
    (fileId: string, payload: PreviewSelectionPayload) => {
      const file = activeFileRef.current

      if (!file || file.id !== fileId) {
        return
      }

      publish({
        ...payload,
        capturedAt: Date.now(),
        file: {
          id: file.id,
          mediaType: file.mediaType,
          name: file.name,
          path: file.path,
        },
      })
    },
    [publish]
  )

  React.useEffect(() => {
    if (selectionRef.current !== null) {
      publish(null)
    }
  }, [publish, scopeKey])

  const value = React.useMemo(
    () => ({ clearSelection, reportSelection, selection }),
    [clearSelection, reportSelection, selection]
  )

  return (
    <PreviewSelectionBridgeContext value={value}>
      {children}
    </PreviewSelectionBridgeContext>
  )
}
