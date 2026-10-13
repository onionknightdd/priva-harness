import type { XlsxSheetLoadOptions } from "@silurus/ooxml/xlsx"

export function isCsvSource(fileName: string, mediaType: string) {
  const extension = fileName.split(".").at(-1)?.toLocaleLowerCase()
  const type = mediaType.split(";", 1)[0].trim().toLocaleLowerCase()

  return type === "text/csv" || type === "application/csv" || extension === "csv"
}

export function csvLoadOptions(
  fileName: string,
  data: ArrayBuffer
): Extract<XlsxSheetLoadOptions, { format: "csv" | "tsv" }> {
  const bytes = new Uint8Array(data, 0, Math.min(2, data.byteLength))
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe
    ? "utf-16le"
    : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8"

  return {
    format: "csv",
    encoding,
    sheetName: fileName.replace(/\.[^.]+$/, "").trim() || "Sheet1",
  }
}
