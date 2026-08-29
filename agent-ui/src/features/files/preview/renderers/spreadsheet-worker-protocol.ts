import type { SpreadsheetWorkbook } from "./spreadsheet-model"

export type SpreadsheetWorkerRequest = {
  source: string
  fileName: string
  mediaType: string
}

export type SpreadsheetWorkerResponse =
  | { status: "ready"; workbook: SpreadsheetWorkbook }
  | { status: "error"; error: string }
