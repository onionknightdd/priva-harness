import type { Worksheet, XlsxRangeSelectionContext, XlsxSelectionState } from "@silurus/ooxml/xlsx"

import type { SpreadsheetSelectionPayload } from "@/features/files/selection"

import { encodeRangeAddress, MAX_SELECTION_TEXT_CELLS } from "./spreadsheet-model"

export function xlsxKeyboardSelection(
  selection: XlsxSelectionState,
  key: string,
  shiftKey: boolean,
  extent: { rows: number; columns: number }
): XlsxSelectionState | null {
  const deltas: Record<string, { row: number; col: number }> = {
    ArrowUp: { row: -1, col: 0 },
    ArrowDown: { row: 1, col: 0 },
    ArrowLeft: { row: 0, col: -1 },
    ArrowRight: { row: 0, col: 1 },
    Tab: { row: 0, col: shiftKey ? -1 : 1 },
    Escape: { row: 0, col: 0 },
  }
  const delta = deltas[key]
  if (!delta) return null
  const activeCell = {
    row: Math.max(1, Math.min(extent.rows, selection.activeCell.row + delta.row)),
    col: Math.max(1, Math.min(extent.columns, selection.activeCell.col + delta.col)),
  }
  const extensionAnchor = shiftKey && key.startsWith("Arrow")
    ? selection.extensionAnchor
    : activeCell
  return {
    activeCell,
    extensionAnchor,
    activeAreaIndex: 0,
    areas: [{
      kind: "cells",
      top: Math.min(extensionAnchor.row, activeCell.row),
      left: Math.min(extensionAnchor.col, activeCell.col),
      bottom: Math.max(extensionAnchor.row, activeCell.row),
      right: Math.max(extensionAnchor.col, activeCell.col),
    }],
  }
}

export function xlsxSheetExtent(sheet: Worksheet) {
  let rows = 1
  let columns = 1
  for (const row of sheet.rows) {
    rows = Math.max(rows, row.index)
    for (const cell of row.cells) columns = Math.max(columns, cell.col)
  }
  for (const merge of sheet.mergeCells) {
    rows = Math.max(rows, merge.bottom)
    columns = Math.max(columns, merge.right)
  }
  return { rows, columns }
}

export function xlsxPreviewSelection(
  context: XlsxRangeSelectionContext,
  extent: { rows: number; columns: number }
): SpreadsheetSelectionPayload {
  // OOXML viewer addresses are one-based; the application protocol is zero-based.
  const ranges = context.selection.areas.map((area) => {
    const range = area.kind === "cells"
      ? { rowStart: area.top - 1, rowEnd: area.bottom - 1, columnStart: area.left - 1, columnEnd: area.right - 1 }
      : area.kind === "rows"
        ? { rowStart: area.firstRow - 1, rowEnd: area.lastRow - 1, columnStart: 0, columnEnd: extent.columns - 1 }
        : area.kind === "columns"
          ? { rowStart: 0, rowEnd: extent.rows - 1, columnStart: area.firstColumn - 1, columnEnd: area.lastColumn - 1 }
          : { rowStart: 0, rowEnd: extent.rows - 1, columnStart: 0, columnEnd: extent.columns - 1 }
    return { ...range, address: encodeRangeAddress(range) }
  })
  const values = new Map(context.cells.map((cell) => [
    cell.address.row + ":" + cell.address.col,
    cell.displayText,
  ]))
  let remaining = MAX_SELECTION_TEXT_CELLS
  const blocks: string[] = []
  for (const range of ranges) {
    const lines: string[] = []
    for (let row = range.rowStart; row <= range.rowEnd && remaining > 0; row++) {
      const cells: string[] = []
      for (let column = range.columnStart; column <= range.columnEnd && remaining > 0; column++) {
        cells.push(values.get((row + 1) + ":" + (column + 1)) ?? "")
        remaining--
      }
      lines.push(cells.join("\t"))
    }
    if (lines.length > 0) blocks.push(lines.join("\n"))
  }
  return {
    kind: "spreadsheet",
    confidence: "exact",
    coordinateSpace: "sheet-cells",
    sheetId: context.sheetName,
    sheetName: context.sheetName,
    ranges,
    text: blocks.join("\n\n"),
  }
}
