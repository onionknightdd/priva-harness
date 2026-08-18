export type PreviewSelectionConfidence = "exact" | "inferred"

export type PreviewCoordinateSpace =
  | "docx-page-points"
  | "pdf-page-points"
  | "pptx-slide-pixels"
  | "sheet-cells"
  | "viewport-pixels"

export type PreviewSelectionBox = {
  /** Zero-based page, slide, or sheet surface index. */
  surfaceIndex: number
  x: number
  y: number
  width: number
  height: number
}

type PreviewSelectionPayloadBase = {
  text?: string
  boxes?: PreviewSelectionBox[]
  confidence: PreviewSelectionConfidence
  coordinateSpace: PreviewCoordinateSpace
}

export type SpreadsheetRange = {
  /** All row and column indexes are zero-based and inclusive. */
  rowStart: number
  rowEnd: number
  columnStart: number
  columnEnd: number
  address?: string
}

export type SpreadsheetSelectionPayload = PreviewSelectionPayloadBase & {
  kind: "spreadsheet"
  sheetId: string
  sheetName?: string
  ranges: SpreadsheetRange[]
}

export type DocxSemanticPosition = {
  paragraphId: string
  offset: number
}

export type DocxDocumentPosition =
  | {
      kind: "anchor"
      paragraphId: string
      search?: string
      occurrence?: number
    }
  | {
      kind: "location"
      container:
        | { part: "body" }
        | { part: "header" | "footer"; relationshipId: string }
        | { part: "footnote" | "endnote"; noteId: number }
      path: number[]
      offset?: number
    }

export type DocumentSelectionPayload = PreviewSelectionPayloadBase & {
  kind: "document"
  pageIndexes: number[]
  semanticRange?: {
    anchor: DocxSemanticPosition
    head: DocxSemanticPosition
  }
  documentRange?: {
    from: DocxDocumentPosition
    to: DocxDocumentPosition
  }
  table?: {
    tableId: string
    rowStart: number
    rowEnd: number
    columnStart: number
    columnEnd: number
    cellIds: string[]
  }
}

export type PresentationSelectionPayload = PreviewSelectionPayloadBase & {
  kind: "presentation"
  slideIndexes: number[]
  nodeIds?: string[]
  nodePaths?: string[]
}

export type PdfSelectionPayload = PreviewSelectionPayloadBase & {
  kind: "pdf"
  pageIndexes: number[]
  glyphRange: {
    start: { pageIndex: number; glyphIndex: number }
    end: { pageIndex: number; glyphIndex: number }
  }
}

export type TextSelectionPayload = PreviewSelectionPayloadBase & {
  kind: "text"
}

export type PreviewSelectionPayload =
  | DocumentSelectionPayload
  | PdfSelectionPayload
  | PresentationSelectionPayload
  | SpreadsheetSelectionPayload
  | TextSelectionPayload

export type PreviewSelectionFile = {
  id: string
  mediaType: string
  name: string
  path: string
}

export type PreviewSelection = PreviewSelectionPayload & {
  capturedAt: number
  file: PreviewSelectionFile
}
