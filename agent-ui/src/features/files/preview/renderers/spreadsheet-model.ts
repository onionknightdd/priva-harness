export const MAX_SELECTION_TEXT_CELLS = 2_000

export type SpreadsheetCellRange = {
  rowStart: number
  rowEnd: number
  columnStart: number
  columnEnd: number
}

export function encodeColumnLabel(column: number) {
  let value = column + 1
  let label = ""

  while (value > 0) {
    const remainder = (value - 1) % 26
    label = String.fromCharCode(65 + remainder) + label
    value = Math.floor((value - 1) / 26)
  }

  return label
}

export function encodeCellAddress(row: number, column: number) {
  return `${encodeColumnLabel(column)}${row + 1}`
}

export function encodeRangeAddress(range: SpreadsheetCellRange) {
  const start = encodeCellAddress(range.rowStart, range.columnStart)

  if (
    range.rowStart === range.rowEnd &&
    range.columnStart === range.columnEnd
  ) {
    return start
  }

  return `${start}:${encodeCellAddress(range.rowEnd, range.columnEnd)}`
}
