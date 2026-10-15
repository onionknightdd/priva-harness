export type OfficeElementType = "paragraph" | "table" | "table-cell" | "image" | "chart" | "shape" | "media"

export type OfficeElementBox = {
  /** Zero-based page or slide. DOCX uses points; PPTX uses native slide pixels. */
  surfaceIndex: number
  x: number
  y: number
  width: number
  height: number
  rotation?: number
}

export type OfficeElementLocator = {
  /** Actual OOXML archive part, without a leading slash. */
  part: string
  xpath?: string
  paragraphId?: string
  shapeId?: string
  origin?: "slide" | "layout" | "master"
  path?: number[]
  story?: string
  storyInstance?: string
  row?: number
  column?: number
  elementIndex?: number
  rotation?: number
  flipH?: boolean
  flipV?: boolean
}

export type OfficeElementTarget = {
  kind: "document" | "presentation"
  elementType: OfficeElementType
  label: string
  text: string
  coordinateSpace: "docx-page-points" | "pptx-slide-pixels"
  boxes: OfficeElementBox[]
  locator: OfficeElementLocator
}

export type OfficeElementPicker = {
  hitTest: (
    surfaceIndex: number,
    point: { x: number; y: number },
    options?: { parent?: boolean }
  ) => Promise<OfficeElementTarget | null>
}

export type OfficeAssistSurface = {
  picker: OfficeElementPicker
  fileRevision: string
  /** Returns mounted canvas geometry, so references survive virtual scrolling. */
  getCanvas: (surfaceIndex: number) => HTMLCanvasElement | null
  scrollTo: (surfaceIndex: number) => void
  unitsPerCssPixel: (surfaceIndex: number) => number
}
