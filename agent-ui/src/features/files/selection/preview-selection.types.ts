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

export type DocxSourceLocator = {
  story: "body" | "header" | "footer" | "footnote" | "endnote" | "textbox"
  storyInstance: string
  path: number[]
}

export type DocxRunLocator = {
  /** Zero-based rendered page and text-run indexes. */
  pageIndex: number
  runIndex: number
  paragraphId?: string
  source?: DocxSourceLocator
}

export type DocumentSelectionPayload = PreviewSelectionPayloadBase & {
  kind: "document"
  pageIndexes: number[]
  paragraphIds: string[]
  runs: DocxRunLocator[]
  truncated: boolean
  truncationReasons: ("text" | "runs")[]
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
