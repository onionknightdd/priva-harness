export const MAX_PREVIEW_ROWS = 500
export const MAX_PREVIEW_COLS = 40
export const MAX_SELECTION_TEXT_CELLS = 2_000

export type SpreadsheetMerge = {
  row: number
  column: number
  rowSpan: number
  columnSpan: number
}

export type SpreadsheetSheet = {
  id: string
  name: string
  originRow: number
  originColumn: number
  rowCount: number
  columnCount: number
  totalRows: number
  totalColumns: number
  truncated: boolean
  values: string[][]
  formulas: Map<string, string>
  merges: SpreadsheetMerge[]
  coveredCells: Set<string>
}

export type SpreadsheetWorkbook = {
  sheets: SpreadsheetSheet[]
}

export type SpreadsheetCellRange = {
  rowStart: number
  rowEnd: number
  columnStart: number
  columnEnd: number
}

export function spreadsheetCellKey(row: number, column: number) {
  return `${row},${column}`
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

export function normalizeRange(
  first: { row: number; column: number },
  second: { row: number; column: number }
): SpreadsheetCellRange {
  return {
    rowStart: Math.min(first.row, second.row),
    rowEnd: Math.max(first.row, second.row),
    columnStart: Math.min(first.column, second.column),
    columnEnd: Math.max(first.column, second.column),
  }
}

export function rangeCellCount(range: SpreadsheetCellRange) {
  return (
    (range.rowEnd - range.rowStart + 1) *
    (range.columnEnd - range.columnStart + 1)
  )
}

export function selectionText(
  sheet: SpreadsheetSheet,
  range: SpreadsheetCellRange
) {
  if (rangeCellCount(range) > MAX_SELECTION_TEXT_CELLS) {
    return undefined
  }

  const lines: string[] = []

  for (let row = range.rowStart; row <= range.rowEnd; row += 1) {
    const relativeRow = row - sheet.originRow

    if (relativeRow < 0 || relativeRow >= sheet.rowCount) {
      continue
    }

    const cells: string[] = []

    for (
      let column = range.columnStart;
      column <= range.columnEnd;
      column += 1
    ) {
      const relativeColumn = column - sheet.originColumn

      if (
        relativeColumn < 0 ||
        relativeColumn >= sheet.columnCount
      ) {
        continue
      }

      cells.push(sheet.values[relativeRow]?.[relativeColumn] ?? "")
    }

    lines.push(cells.join("\t"))
  }

  return lines.join("\n")
}

export function cellFormulaOrValue(
  sheet: SpreadsheetSheet,
  row: number,
  column: number
) {
  const relativeRow = row - sheet.originRow
  const relativeColumn = column - sheet.originColumn

  return (
    sheet.formulas.get(
      spreadsheetCellKey(relativeRow, relativeColumn)
    ) ??
    sheet.values[relativeRow]?.[relativeColumn] ??
    ""
  )
}

export function mergeAt(
  sheet: SpreadsheetSheet,
  relativeRow: number,
  relativeColumn: number
) {
  return sheet.merges.find(
    (merge) =>
      merge.row === relativeRow && merge.column === relativeColumn
  )
}

export function isCoveredCell(
  sheet: SpreadsheetSheet,
  relativeRow: number,
  relativeColumn: number
) {
  return sheet.coveredCells.has(
    spreadsheetCellKey(relativeRow, relativeColumn)
  )
}
