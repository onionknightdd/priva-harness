import * as React from "react"
import { selectionRects } from "@docx-editor.dev/core/layout"
import type {
  DocAnchor,
  DocLocation,
  DocRange,
} from "@docx-editor.dev/core/contracts/types"
import "@docx-editor.dev/core/styles/editor.css"
import {
  DocxEditor,
  useDocxEditor,
  useEditorState,
} from "@docx-editor.dev/react"
import { useTranslation } from "react-i18next"

import {
  usePreviewSelectionReporter,
  type DocxDocumentPosition,
  type DocumentSelectionPayload,
} from "@/features/files/selection"

import { PreviewRequestState } from "../preview-request-state"
import { useBinaryPreview } from "./use-binary-preview"

function normalizeDocumentPosition(
  position: DocAnchor | DocLocation
): DocxDocumentPosition {
  if ("paraId" in position) {
    return {
      kind: "anchor",
      paragraphId: position.paraId,
      search: position.search,
      occurrence: position.occurrence,
    }
  }

  const container = position.container
  let normalizedContainer: Extract<
    DocxDocumentPosition,
    { kind: "location" }
  >["container"]

  if (container.part === "body") {
    normalizedContainer = { part: "body" }
  } else if ("rId" in container) {
    normalizedContainer = {
      part: container.part,
      relationshipId: container.rId,
    }
  } else {
    normalizedContainer = {
      part: container.part,
      noteId: container.noteId,
    }
  }

  return {
    kind: "location",
    container: normalizedContainer,
    path: [...position.path],
    offset: position.offset,
  }
}

function normalizeDocumentRange(range: DocRange | null) {
  if (!range) {
    return undefined
  }

  return {
    from: normalizeDocumentPosition(range.from),
    to: normalizeDocumentPosition(range.to),
  }
}

function DocumentSelectionObserver({
  fileId,
  onParseError,
}: {
  fileId: string
  onParseError: (error: string | null) => void
}) {
  const editor = useDocxEditor()
  const parseError = useEditorState((snapshot) => snapshot.parseError)
  const { clearSelection, reportSelection } =
    usePreviewSelectionReporter(fileId)

  React.useEffect(() => {
    onParseError(parseError)
  }, [onParseError, parseError])

  React.useEffect(() => {
    if (!editor) {
      return
    }

    const updateSelection = (snapshot: ReturnType<typeof editor.snapshot>) => {
      if (snapshot.selectionCollapsed) {
        clearSelection()
        return
      }

      const surface = editor.surface
      const semanticRange = surface?.state().selection
      const boxes = semanticRange
        ? selectionRects(surface.layout(), semanticRange).map((rect) => ({
            surfaceIndex: rect.pageIndex,
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          }))
        : []
      const pageIndexes = [
        ...new Set(
          boxes.length > 0
            ? boxes.map((box) => box.surfaceIndex)
            : [Math.max(0, snapshot.page.current - 1)]
        ),
      ]
      const tableSelection = editor.getTableCellSelection()
      const payload: DocumentSelectionPayload = {
        kind: "document",
        confidence: semanticRange ? "exact" : "inferred",
        coordinateSpace: "docx-page-points",
        text: editor.query({ type: "selectedText" }),
        boxes,
        pageIndexes,
        semanticRange: semanticRange
          ? {
              anchor: { ...semanticRange.anchor },
              head: { ...semanticRange.head },
            }
          : undefined,
        documentRange: normalizeDocumentRange(snapshot.selection),
        table: tableSelection
          ? {
              tableId: tableSelection.tableId,
              rowStart: tableSelection.rows.from,
              rowEnd: tableSelection.rows.to,
              columnStart: tableSelection.columns.from,
              columnEnd: tableSelection.columns.to,
              cellIds: [...tableSelection.cellIds],
            }
          : undefined,
      }

      reportSelection(payload)
    }

    updateSelection(editor.snapshot())
    const unsubscribe = editor.on("selectionChange", updateSelection)

    return () => {
      unsubscribe()
      clearSelection()
    }
  }, [clearSelection, editor, reportSelection])

  return null
}

export function DocumentRenderer({
  fileId,
  source,
}: {
  fileId: string
  source: string
}) {
  const { i18n } = useTranslation()
  const binary = useBinaryPreview(source)
  const [parseError, setParseError] = React.useState<string | null>(null)
  const document = React.useMemo(
    () =>
      binary.status === "ready"
        ? new Uint8Array(binary.data)
        : undefined,
    [binary]
  )

  if (binary.status === "loading") {
    return <PreviewRequestState loading />
  }

  if (binary.status === "error") {
    return <PreviewRequestState error={binary.error} />
  }

  if (!document) {
    return <PreviewRequestState />
  }

  if (parseError) {
    return <PreviewRequestState error={parseError} />
  }

  return (
    <div className="h-full min-h-0 overflow-hidden bg-muted/30">
      <DocxEditor.Root
        document={document}
        locale={i18n.resolvedLanguage ?? i18n.language}
        mode="view"
        zoomMode="auto"
      >
        <DocumentSelectionObserver
          fileId={fileId}
          onParseError={setParseError}
        />
        <DocxEditor.Loading className="h-full" />
        <DocxEditor.Viewport
          className="h-full min-h-0 overscroll-contain"
          style={{ height: "100%" }}
        >
          <DocxEditor.Content />
        </DocxEditor.Viewport>
      </DocxEditor.Root>
    </div>
  )
}
