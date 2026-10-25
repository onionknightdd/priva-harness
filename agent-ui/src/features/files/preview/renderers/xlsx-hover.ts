import type { CellAddress, Worksheet, XlsxCellViewportRect, XlsxViewportOffset } from "@silurus/ooxml/xlsx"

import { encodeRangeAddress } from "./spreadsheet-model"

export type XlsxHoverTarget = { address: string; rects: XlsxCellViewportRect[] }

export function xlsxHoverTarget(
  cell: CellAddress,
  sheet: Pick<Worksheet, "mergeCells" | "freezeRows" | "freezeCols" | "rightToLeft"> | undefined,
  viewport: { width: number; height: number },
  offset: XlsxViewportOffset,
  cellRect: (cell: CellAddress) => XlsxCellViewportRect | null,
): XlsxHoverTarget | null {
  const first = cellRect({ row: 1, col: 1 })
  if (!first || viewport.width <= 0 || viewport.height <= 0) return null
  const range = sheet?.mergeCells.find((merge) => cell.row >= merge.top && cell.row <= merge.bottom &&
    cell.col >= merge.left && cell.col <= merge.right) ?? {
    top: cell.row, bottom: cell.row, left: cell.col, right: cell.col,
  }
  const frozenRows = sheet?.freezeRows ?? 0
  const frozenCols = sheet?.freezeCols ?? 0
  const rtl = Boolean(sheet?.rightToLeft)
  // Cell geometry includes scrolling. Undo it only on unfrozen first bands to
  // obtain the header edge without duplicating the viewer's header dimensions.
  const gridTop = first.y + (frozenRows ? 0 : offset.y)
  const gridLeft = rtl ? 0 : first.x + (frozenCols ? 0 : offset.x)
  const gridRight = rtl ? first.x + first.width - (frozenCols ? 0 : offset.x) : viewport.width
  const lastFrozenRow = frozenRows ? cellRect({ row: frozenRows, col: 1 }) : null
  const lastFrozenCol = frozenCols ? cellRect({ row: 1, col: frozenCols }) : null
  const splitY = Math.min(viewport.height, lastFrozenRow ? lastFrozenRow.y + lastFrozenRow.height : gridTop)
  const splitX = lastFrozenCol
    ? Math.max(gridLeft, Math.min(gridRight, rtl ? lastFrozenCol.x : lastFrozenCol.x + lastFrozenCol.width))
    : rtl ? gridRight : gridLeft
  const split = (start: number, end: number, frozen: number) => start <= frozen && end > frozen
    ? [[start, frozen], [frozen + 1, end]] : [[start, end]]
  const rects: XlsxCellViewportRect[] = []
  for (const [top, bottom] of split(range.top, range.bottom, frozenRows)) {
    for (const [left, right] of split(range.left, range.right, frozenCols)) {
      const start = cellRect({ row: top, col: left })
      const end = cellRect({ row: bottom, col: right })
      if (!start || !end) continue
      const frozenX = left <= frozenCols
      const frozenY = top <= frozenRows
      const x = Math.max(Math.min(start.x, end.x), rtl ? frozenX ? splitX : gridLeft : frozenX ? gridLeft : splitX)
      const y = Math.max(start.y, frozenY ? gridTop : splitY)
      const maxX = Math.min(Math.max(start.x + start.width, end.x + end.width), rtl ? frozenX ? gridRight : splitX : frozenX ? splitX : gridRight)
      const maxY = Math.min(end.y + end.height, frozenY ? splitY : viewport.height)
      if (maxX > x && maxY > y) rects.push({ x, y, width: maxX - x, height: maxY - y })
    }
  }
  return rects.length ? {
    address: encodeRangeAddress({ rowStart: range.top - 1, rowEnd: range.bottom - 1, columnStart: range.left - 1, columnEnd: range.right - 1 }),
    rects,
  } : null
}
