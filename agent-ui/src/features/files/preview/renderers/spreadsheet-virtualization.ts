import type { SpreadsheetSheet } from "./spreadsheet-model"

export const SPREADSHEET_ROW_HEIGHT = 28
export const SPREADSHEET_ROW_OVERSCAN = 8

export function mergeSafeRowRange(
  sheet: SpreadsheetSheet,
  start: number,
  end: number
) {
  let rowStart = start
  let rowEnd = end
  let changed = true

  while (changed) {
    changed = false

    for (const merge of sheet.merges) {
      const mergeEnd = merge.row + merge.rowSpan - 1

      if (merge.row > rowEnd || mergeEnd < rowStart) {
        continue
      }

      if (merge.row < rowStart) {
        rowStart = merge.row
        changed = true
      }

      if (mergeEnd > rowEnd) {
        rowEnd = mergeEnd
        changed = true
      }
    }
  }

  return {
    start: Math.max(0, rowStart),
    end: Math.min(sheet.rowCount - 1, rowEnd),
  }
}
