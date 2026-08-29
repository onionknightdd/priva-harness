import { read, utils, type CellObject, type WorkSheet } from "xlsx"

import {
  MAX_PREVIEW_COLS,
  MAX_PREVIEW_ROWS,
  spreadsheetCellKey,
  type SpreadsheetMerge,
  type SpreadsheetSheet,
  type SpreadsheetWorkbook,
} from "./spreadsheet-model"

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
      formulas.set(
        spreadsheetCellKey(relativeRow, relativeColumn),
        formula
      )
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
          coveredCells.add(
            spreadsheetCellKey(coveredRow, coveredColumn)
          )
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
          coveredCells.add(
            spreadsheetCellKey(coveredRow, coveredColumn)
          )
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
