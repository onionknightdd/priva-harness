import type { PptxElementContext, PptxPresentation, PptxTextRunInfo } from "@silurus/ooxml/pptx"

import type { OfficeElementTarget } from "./office-assist.types"
import {
  PPTX_DRAWING_NS,
  PPTX_PRESENTATION_NS,
  pptxChild,
  pptxChildren,
  pptxXPath,
  readPptxSources,
  type PptxSourceObject,
} from "./pptx-source"

const EMU_PER_PIXEL = 9525
type Point = { x: number; y: number }
type Frame = { x: number; y: number; width: number; height: number; rotation: number; flipH: boolean; flipV: boolean }
type Presentation = Pick<PptxPresentation, "slideWidth" | "getElementContextAt" | "getElementBoundsByIds" | "collectSlideRuns">

export interface PptxElementPicker {
  hitTest(slideIndex: number, point: Point, options?: { parent?: boolean }): Promise<OfficeElementTarget | null>
}

function numberAttribute(element: Element | undefined, attribute: string) {
  const value = element?.getAttribute(attribute)
  return value === null || value === undefined ? 0 : Number(value)
}

function sameFrame(a: Frame, b: Frame) {
  return [a.x - b.x, a.y - b.y, a.width - b.width, a.height - b.height].every((difference) => Math.abs(difference) < 2)
    && Math.abs(a.rotation - b.rotation) < 0.01
}

function sourceFrame(source: PptxSourceObject): Frame | undefined {
  const transform = source.type === "table" || source.type === "chart"
    ? pptxChild(source.element, PPTX_PRESENTATION_NS, "xfrm")
    : source.element.getElementsByTagNameNS(PPTX_DRAWING_NS, "xfrm")[0]
  if (!transform) return undefined
  const offset = pptxChild(transform, PPTX_DRAWING_NS, "off")
  const extent = pptxChild(transform, PPTX_DRAWING_NS, "ext")
  if (!offset || !extent) return undefined
  return {
    x: numberAttribute(offset, "x"), y: numberAttribute(offset, "y"),
    width: numberAttribute(extent, "cx"), height: numberAttribute(extent, "cy"),
    rotation: numberAttribute(transform, "rot") / 60000,
    flipH: ["1", "true"].includes(transform.getAttribute("flipH") ?? ""),
    flipV: ["1", "true"].includes(transform.getAttribute("flipV") ?? ""),
  }
}

function inverseTransform(point: Point, frame: Frame): Point {
  const centerX = frame.x + frame.width / 2
  const centerY = frame.y + frame.height / 2
  const angle = -frame.rotation * Math.PI / 180
  const deltaX = point.x - centerX
  const deltaY = point.y - centerY
  let x = Math.cos(angle) * deltaX - Math.sin(angle) * deltaY
  let y = Math.sin(angle) * deltaX + Math.cos(angle) * deltaY
  if (frame.flipH) x = -x
  if (frame.flipV) y = -y
  return { x: centerX + x, y: centerY + y }
}

function transform(point: Point, frame: Frame): Point {
  const centerX = frame.x + frame.width / 2
  const centerY = frame.y + frame.height / 2
  const angle = frame.rotation * Math.PI / 180
  const x = (point.x - centerX) * (frame.flipH ? -1 : 1)
  const y = (point.y - centerY) * (frame.flipV ? -1 : 1)
  return {
    x: centerX + Math.cos(angle) * x - Math.sin(angle) * y,
    y: centerY + Math.sin(angle) * x + Math.cos(angle) * y,
  }
}

function pixelFrame(frame: Frame): Frame {
  return { ...frame, x: frame.x / EMU_PER_PIXEL, y: frame.y / EMU_PER_PIXEL, width: frame.width / EMU_PER_PIXEL, height: frame.height / EMU_PER_PIXEL }
}

function textOf(element: Element) {
  return Array.from(element.getElementsByTagNameNS(PPTX_DRAWING_NS, "p"))
    .map((paragraph) => Array.from(paragraph.getElementsByTagNameNS(PPTX_DRAWING_NS, "t")).map((text) => text.textContent ?? "").join(""))
    .join("\n")
}

function cellAt(source: PptxSourceObject, context: PptxElementContext, point: Point, runs: PptxTextRunInfo[]) {
  const table = source.element.getElementsByTagNameNS(PPTX_DRAWING_NS, "tbl")[0]
  if (!table) return null
  const authoredFrame = sourceFrame(source)
  const scaleX = authoredFrame && authoredFrame.width > 0 ? context.bounds.width / authoredFrame.width : 1
  const scaleY = authoredFrame && authoredFrame.height > 0 ? context.bounds.height / authoredFrame.height : 1
  const grid = pptxChild(table, PPTX_DRAWING_NS, "tblGrid")
  const columns = grid ? pptxChildren(grid, PPTX_DRAWING_NS, "gridCol").map((column) => numberAttribute(column, "w") / EMU_PER_PIXEL * scaleX) : []
  const rows = pptxChildren(table, PPTX_DRAWING_NS, "tr")
  if (columns.length === 0 || rows.length === 0) return null
  const frame = pixelFrame(context.bounds)
  const local = inverseTransform(point, frame)
  const rowHeights = rows.map((row) => numberAttribute(row, "h") / EMU_PER_PIXEL * scaleY)
  const boundaries = new Map<number, number>([[0, frame.y]])

  // Rendered text runs carry the real cell frame, including rows expanded by
  // the renderer. Combining those boundaries with the source grid also locates
  // empty cells, which have no text spans to hit-test.
  for (const run of runs) {
    if (run.elementIndex !== context.elementIndex || run.origin !== context.origin || !run.tableCell) continue
    const rowIndex = run.tableCell.row
    const cell = rows[rowIndex] && pptxChildren(rows[rowIndex], PPTX_DRAWING_NS, "tc")[run.tableCell.column]
    if (!cell) continue
    const center = inverseTransform({ x: run.shapeX + run.shapeW / 2, y: run.shapeY + run.shapeH / 2 }, frame)
    const span = Math.max(1, numberAttribute(cell, "rowSpan"))
    boundaries.set(rowIndex, center.y - run.shapeH / 2)
    boundaries.set(Math.min(rows.length, rowIndex + span), center.y + run.shapeH / 2)
  }
  const anchors = [...boundaries.entries()].sort(([a], [b]) => a - b)
  for (let index = 0; index < anchors.length - 1; index++) {
    const [startRow, startY] = anchors[index]
    const [endRow, endY] = anchors[index + 1]
    const declared = rowHeights.slice(startRow, endRow).reduce((sum, height) => sum + height, 0)
    const growth = (endY - startY - declared) / (endRow - startRow)
    let y = startY
    for (let row = startRow; row < endRow; row++) {
      boundaries.set(row, y)
      rowHeights[row] = Math.max(0, rowHeights[row] + growth)
      y += rowHeights[row]
    }
  }
  let y = frame.y
  for (let row = 0; row < rows.length; row++) {
    y = boundaries.get(row) ?? y
    boundaries.set(row, y)
    y += rowHeights[row]
  }
  boundaries.set(rows.length, boundaries.get(rows.length) ?? y)

  const tableWidth = columns.reduce((sum, width) => sum + width, 0)
  const rtl = ["1", "true"].includes(pptxChild(table, PPTX_DRAWING_NS, "tblPr")?.getAttribute("rtl") ?? "")
  for (let row = 0; row < rows.length; row++) {
    const cells = pptxChildren(rows[row], PPTX_DRAWING_NS, "tc")
    for (let column = 0; column < cells.length; column++) {
      const cell = cells[column]
      if (["1", "true"].includes(cell.getAttribute("hMerge") ?? "") || ["1", "true"].includes(cell.getAttribute("vMerge") ?? "")) continue
      const columnSpan = Math.max(1, numberAttribute(cell, "gridSpan"))
      const rowSpan = Math.max(1, numberAttribute(cell, "rowSpan"))
      const before = columns.slice(0, column).reduce((sum, width) => sum + width, 0)
      const width = columns.slice(column, column + columnSpan).reduce((sum, width) => sum + width, 0)
      const x = frame.x + (rtl ? tableWidth - before - width : before)
      const top = boundaries.get(row)!
      const height = boundaries.get(Math.min(rows.length, row + rowSpan))! - top
      if (local.x < x || local.x > x + width || local.y < top || local.y > top + height) continue
      const center = transform({ x: x + width / 2, y: top + height / 2 }, frame)
      return {
        row, column, element: cell,
        box: { surfaceIndex: context.slideIndex, x: center.x - width / 2, y: center.y - height / 2, width, height, rotation: frame.rotation },
      }
    }
  }
  return null
}

/** Native hit testing supplies object geometry; the source package supplies identity. */
export async function createPptxElementPicker(presentation: Presentation, data: ArrayBuffer): Promise<PptxElementPicker> {
  const slides = readPptxSources(data)
  const boundsBySlide = new Map<number, ReturnType<Presentation["getElementBoundsByIds"]>>()
  const runsBySlide = new Map<number, Promise<PptxTextRunInfo[]>>()
  const runsAt = (slide: number) => {
    let result = runsBySlide.get(slide)
    if (!result) {
      result = presentation.collectSlideRuns(slide, presentation.slideWidth / EMU_PER_PIXEL)
      runsBySlide.set(slide, result)
    }
    return result
  }

  return {
    async hitTest(slideIndex, point, options) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !slides[slideIndex]) return null
      const context = await presentation.getElementContextAt(slideIndex, { x: point.x * EMU_PER_PIXEL, y: point.y * EMU_PER_PIXEL }, { tolerance: 3 * EMU_PER_PIXEL })
      if (!context) return null
      const candidates = slides[slideIndex].objects.filter((object) => object.type === context.elementType && (context.origin === "unknown" || object.origin === context.origin))
      const identified = context.shapeId ? candidates.filter((object) => object.id === context.shapeId) : []
      let source = identified.length === 1 ? identified[0] : undefined
      let runs: PptxTextRunInfo[] | undefined
      if (!source && context.elementType === "table") {
        runs = await runsAt(slideIndex)
        const id = runs.find((run) => run.elementIndex === context.elementIndex && run.origin === context.origin)?.shapeId
        if (id) source = candidates.find((object) => object.id === id)
      }
      if (!source) {
        let bounds = boundsBySlide.get(slideIndex)
        if (!bounds) {
          bounds = presentation.getElementBoundsByIds(slideIndex, slides[slideIndex].objects.map((object) => object.id))
          boundsBySlide.set(slideIndex, bounds)
        }
        const ids = new Set((await bounds).filter((bound) => bound.elementIndex === context.elementIndex && bound.origin === context.origin).map((bound) => bound.elementId))
        source = candidates.find((object) => ids.has(object.id))
      }
      if (!source) {
        const matching = candidates.filter((object) => {
          const frame = sourceFrame(object)
          return frame && sameFrame(frame, context.bounds)
        })
        if (matching.length === 1) source = matching[0]
        else if (candidates.length === 1) source = candidates[0]
      }
      // Never emit a location that points at an unrelated source object.
      if (!source) return null
      const frame = pixelFrame(context.bounds)
      const locator: OfficeElementTarget["locator"] = {
        part: source.part, xpath: source.xpath, shapeId: source.id,
        origin: source.origin, elementIndex: context.elementIndex,
        rotation: context.bounds.rotation, flipH: context.bounds.flipH, flipV: context.bounds.flipV,
      }
      if (context.elementType === "table" && !options?.parent) {
        const cell = cellAt(source, context, point, runs ?? await runsAt(slideIndex))
        if (cell) return {
          kind: "presentation", elementType: "table-cell", label: "Table cell",
          text: textOf(cell.element), coordinateSpace: "pptx-slide-pixels", boxes: [cell.box],
          locator: { ...locator, xpath: pptxXPath(cell.element), row: cell.row, column: cell.column },
        }
      }
      const elementType = context.elementType === "picture" ? "image"
        : context.elementType === "shape" && (context.text?.length || source.element.getElementsByTagNameNS(PPTX_PRESENTATION_NS, "txBody").length) ? "paragraph"
          : context.elementType
      return {
        kind: "presentation", elementType, label: context.name || elementType,
        text: context.text ?? "", coordinateSpace: "pptx-slide-pixels",
        boxes: [{ surfaceIndex: slideIndex, x: frame.x, y: frame.y, width: frame.width, height: frame.height, rotation: frame.rotation }],
        locator,
      }
    },
  }
}
