const EXCEL_MEDIA_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
  "application/vnd.ms-excel.template.macroenabled.12",
])

export type ExcelWorkbookFileType = "xlsx" | "xlsm" | "xltx" | "xltm"

export function excelWorkbookFileType(
  fileName: string
): ExcelWorkbookFileType | null {
  const extension = fileName.split(".").at(-1)?.toLocaleLowerCase()
  if (
    extension === "xlsx" ||
    extension === "xlsm" ||
    extension === "xltx" ||
    extension === "xltm"
  ) {
    return extension
  }

  return null
}

export function isExcelSpreadsheetFile(fileName: string, mediaType: string) {
  if (excelWorkbookFileType(fileName) !== null) {
    return true
  }

  return EXCEL_MEDIA_TYPES.has(mediaType.toLocaleLowerCase())
}
