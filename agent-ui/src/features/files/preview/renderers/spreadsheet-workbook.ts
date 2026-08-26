import { read, utils, type CellObject, type WorkSheet } from "xlsx"

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

function isCsvSource(fileName: string, mediaType: string) {
  const extension = fileName.split(".").at(-1)?.toLocaleLowerCase()
  const type = mediaType.toLocaleLowerCase()

  return (
    type === "text/csv" ||
    type === "application/csv" ||
    extension === "csv"
  )
}

function decodeTextWorkbook(data: ArrayBuffer) {
  const bytes = new Uint8Array(data)

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes)
  }

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes)
  }

  return new TextDecoder("utf-8").decode(bytes)
}

function cellKey(row: number, column: number) {
  return `${row},${column}`
}

function cellDisplayValue(cell: CellObject | undefined) {
  if (!cell) {
    return ""
  }

  const formatted = utils.format_cell(cell)

  if (formatted) {
    return formatted
  }

  if (cell.v == null) {
    return ""
  }

  if (typeof cell.v === "boolean") {
    return cell.v ? "TRUE" : "FALSE"
  }

  if (cell.v instanceof Date) {
    return cell.v.toISOString()
  }

  return String(cell.v)
}

function cellFormula(cell: CellObject | undefined) {
  if (!cell?.f) {
    return undefined
  }

  return cell.f.startsWith("=") ? cell.f : `=${cell.f}`
}

function worksheetToSheet(name: string, worksheet: WorkSheet): SpreadsheetSheet {
  const fullRange = worksheet["!ref"]
    ? utils.decode_range(worksheet["!ref"])
    : { s: { r: 0, c: 0 }, e: { r: -1, c: -1 } }
  const totalRows = Math.max(0, fullRange.e.r - fullRange.s.r + 1)
  const totalColumns = Math.max(0, fullRange.e.c - fullRange.s.c + 1)
  const originRow = fullRange.s.r
  const originColumn = fullRange.s.c
  const endRow = Math.min(
    fullRange.e.r,
    originRow + MAX_PREVIEW_ROWS - 1
  )
  const endColumn = Math.min(
    fullRange.e.c,
    originColumn + MAX_PREVIEW_COLS - 1
  )
  const rowCount = totalRows === 0 ? 0 : endRow - originRow + 1
  const columnCount = totalColumns === 0 ? 0 : endColumn - originColumn + 1
  const values =
    rowCount === 0
      ? []
      : Array.from({ length: rowCount }, () =>
          Array.from({ length: columnCount }, () => "")
        )
  const formulas = new Map<string, string>()

  for (const key of Object.keys(worksheet)) {
    if (key.startsWith("!")) {
      continue
    }

    const address = utils.decode_cell(key)

    if (
      address.r < originRow ||
      address.r > endRow ||
      address.c < originColumn ||
      address.c > endColumn
    ) {
      continue
    }

    const cell = worksheet[key] as CellObject
    const relativeRow = address.r - originRow
    const relativeColumn = address.c - originColumn
    values[relativeRow][relativeColumn] = cellDisplayValue(cell)
    const formula = cellFormula(cell)

    if (formula) {
      formulas.set(cellKey(relativeRow, relativeColumn), formula)
    }
  }

  const coveredCells = new Set<string>()
  const merges: SpreadsheetMerge[] = []

  for (const merge of worksheet["!merges"] ?? []) {
    if (
      merge.e.r < originRow ||
      merge.s.r > endRow ||
      merge.e.c < originColumn ||
      merge.s.c > endColumn
    ) {
      continue
    }

    const row = merge.s.r - originRow
    const column = merge.s.c - originColumn
    const rowEnd = Math.min(merge.e.r, endRow) - originRow
    const columnEnd = Math.min(merge.e.c, endColumn) - originColumn

    if (row < 0 || column < 0) {
      for (
        let coveredRow = Math.max(0, row);
        coveredRow <= rowEnd;
        coveredRow += 1
      ) {
        for (
          let coveredColumn = Math.max(0, column);
          coveredColumn <= columnEnd;
          coveredColumn += 1
        ) {
          coveredCells.add(cellKey(coveredRow, coveredColumn))
        }
      }
      continue
    }

    merges.push({
      row,
      column,
      rowSpan: rowEnd - row + 1,
      columnSpan: columnEnd - column + 1,
    })

    for (let coveredRow = row; coveredRow <= rowEnd; coveredRow += 1) {
      for (
        let coveredColumn = column;
        coveredColumn <= columnEnd;
        coveredColumn += 1
      ) {
        if (coveredRow !== row || coveredColumn !== column) {
          coveredCells.add(cellKey(coveredRow, coveredColumn))
        }
      }
    }
  }

  return {
    id: name,
    name,
    originRow,
    originColumn,
    rowCount,
    columnCount,
    totalRows,
    totalColumns,
    truncated:
      rowCount < totalRows ||
      columnCount < totalColumns ||
      rowCount === MAX_PREVIEW_ROWS ||
      columnCount === MAX_PREVIEW_COLS,
    values,
    formulas,
    merges,
    coveredCells,
  }
}

export function parseSpreadsheetWorkbook(
  data: ArrayBuffer,
  fileName: string,
  mediaType: string
): SpreadsheetWorkbook {
  const parseOptions = {
    cellDates: true,
    cellFormula: true,
    cellText: true,
    sheetRows: MAX_PREVIEW_ROWS,
  } as const

  const workbook = isCsvSource(fileName, mediaType)
    ? read(decodeTextWorkbook(data), {
        ...parseOptions,
        type: "string",
        sheet: fileName.replace(/\.[^.]+$/, "") || "Sheet1",
      })
    : read(new Uint8Array(data), {
        ...parseOptions,
        type: "array",
      })

  return {
    sheets: workbook.SheetNames.flatMap((name) => {
      const worksheet = workbook.Sheets[name]

      if (!worksheet) {
        return []
      }

      return [worksheetToSheet(name, worksheet)]
    }),
  }
}

export function encodeColumnLabel(column: number) {
  return utils.encode_col(column)
}

export function encodeCellAddress(row: number, column: number) {
  return utils.encode_cell({ r: row, c: column })
}

export function encodeRangeAddress(range: SpreadsheetCellRange) {
  if (
    range.rowStart === range.rowEnd &&
    range.columnStart === range.columnEnd
  ) {
    return encodeCellAddress(range.rowStart, range.columnStart)
  }

  return utils.encode_range({
    s: { r: range.rowStart, c: range.columnStart },
    e: { r: range.rowEnd, c: range.columnEnd },
  })
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
    sheet.formulas.get(cellKey(relativeRow, relativeColumn)) ??
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
    (merge) => merge.row === relativeRow && merge.column === relativeColumn
  )
}

export function isCoveredCell(
  sheet: SpreadsheetSheet,
  relativeRow: number,
  relativeColumn: number
) {
  return sheet.coveredCells.has(cellKey(relativeRow, relativeColumn))
}
