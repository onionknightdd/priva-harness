const EXCEL_EXTENSIONS = new Set(["xlsx", "xlsm", "xltx", "xltm"])

const EXCEL_MEDIA_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
  "application/vnd.ms-excel.template.macroenabled.12",
])

export function isExcelSpreadsheetFile(fileName: string, mediaType: string) {
  const extension = fileName.split(".").at(-1)?.toLocaleLowerCase()
  if (extension && EXCEL_EXTENSIONS.has(extension)) {
    return true
  }

  return EXCEL_MEDIA_TYPES.has(mediaType.toLocaleLowerCase())
}
