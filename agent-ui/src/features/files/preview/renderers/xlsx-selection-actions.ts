import type { CellAddress, XlsxCellViewportRect, XlsxSelectionState } from "@silurus/ooxml/xlsx"

export function xlsxSelectionActionsRect(
  selection: XlsxSelectionState,
  canvas: { left: number; top: number; width: number; height: number },
  cellRect: (cell: CellAddress) => XlsxCellViewportRect | null,
  target?: CellAddress | null
) {
  const area = selection.areas[selection.activeAreaIndex]
  if (!area || canvas.width <= 0 || canvas.height <= 0) return null

  let left = 0
  let top = 0
  let right = canvas.width
  let bottom = canvas.height
  if (area.kind !== "sheet") {
    const targetInArea = target && (area.kind === "cells"
      ? target.row >= area.top && target.row <= area.bottom && target.col >= area.left && target.col <= area.right
      : area.kind === "rows" ? target.row >= area.firstRow && target.row <= area.lastRow
        : target.col >= area.firstColumn && target.col <= area.lastColumn)
    const anchor = selection.extensionAnchor
    // Pointer release outside the viewport has no hit; the opposite edge from
    // the extension anchor still identifies the last dragged cell/row/column.
    const endpoint = target && targetInArea ? target : area.kind === "cells"
      ? { row: anchor.row === area.top ? area.bottom : area.top, col: anchor.col === area.left ? area.right : area.left }
      : area.kind === "rows"
        ? { row: anchor.row === area.firstRow ? area.lastRow : area.firstRow, col: 1 }
        : { row: 1, col: anchor.col === area.firstColumn ? area.lastColumn : area.firstColumn }
    const last = cellRect(endpoint)
    if (!last) return null

    // The viewer already applies scrolling, zoom, frozen panes and RTL.
    if (area.kind !== "rows") {
      left = Math.max(0, last.x)
      right = Math.min(canvas.width, last.x + last.width)
    }
    if (area.kind !== "columns") {
      top = Math.max(0, last.y)
      bottom = Math.min(canvas.height, last.y + last.height)
    }
  }
  if (right <= left || bottom <= top) return null
  return {
    left: canvas.left + left,
    top: canvas.top + top,
    bottom: canvas.top + bottom,
    width: right - left,
  }
}
