import type { CellAddress } from "@silurus/ooxml/xlsx"
import { csvParseRows } from "d3-dsv"

export type CsvCellReader = (cell: CellAddress) => string

// Build after the native CSV loader has validated the source and resource limits.
// Values remain independent of the viewer's bounded selection-context snapshot.
export function createCsvCellReader(
  data: ArrayBuffer,
  encoding = "utf-8"
): CsvCellReader {
  const text = new TextDecoder(encoding, { fatal: true }).decode(data)
  // The native loader normalizes CR and CRLF inside quoted fields to LF too.
  const rows = csvParseRows(text.replace(/\r\n?/g, "\n"))

  return ({ row, col }) => rows[row - 1]?.[col - 1] ?? ""
}
