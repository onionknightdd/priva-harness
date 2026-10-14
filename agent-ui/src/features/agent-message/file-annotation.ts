import { fileNameFromPath } from "@/lib/file-path"

export type FileAnnotation =
  | { kind: "text"; filePath: string; lineNum: string; selectedText: string }
  | { kind: "spreadsheet"; filePath: string; sheet: string; cell: string }

function encodeField(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("\r", "\\r").replaceAll("\n", "\\n")
}

function decodeField(value: string) {
  return value.replace(/\\([\\rn])/g, (_, character: string) => character === "r" ? "\r" : character === "n" ? "\n" : "\\")
}

export function formatFileAnnotation(annotation: FileAnnotation) {
  const fields = `file_path: ${encodeField(annotation.filePath)}\n` + (annotation.kind === "text"
    ? `line_num: ${encodeField(annotation.lineNum)}\nselected_text: ${annotation.selectedText}`
    : `sheet: ${encodeField(annotation.sheet)}\ncell: ${encodeField(annotation.cell)}`)
  // Source selections can contain fenced code examples themselves.
  let longestFence = 0
  for (const match of fields.matchAll(/`+/g)) longestFence = Math.max(longestFence, match[0].length)
  const fence = "`".repeat(Math.max(3, longestFence + 1))
  return `${fence}file_annotation\n${fields}\n${fence}`
}

export function parseFileAnnotationBlock(block: string): FileAnnotation | null {
  const match = /^(`{3,})file_annotation\r?\n([\s\S]*?)\r?\n\1(?:\r?\n)?$/.exec(block)
  if (!match || new RegExp(`^${match[1]}[\\t ]*$`, "m").test(match[2])) return null
  const text = /^file_path: ([^\r\n]+)\r?\nline_num: ([^\r\n]+)\r?\nselected_text: ([\s\S]+)$/.exec(match[2])
  if (text) {
    const filePath = decodeField(text[1])
    const lineNum = decodeField(text[2])
    return filePath.trim() && lineNum.trim()
      ? { kind: "text", filePath, lineNum, selectedText: text[3] }
      : null
  }
  const spreadsheet = /^file_path: ([^\r\n]+)\r?\nsheet: ([^\r\n]+)\r?\ncell: ([^\r\n]+)$/.exec(match[2])
  if (!spreadsheet) return null
  const filePath = decodeField(spreadsheet[1])
  const sheet = decodeField(spreadsheet[2])
  const cell = decodeField(spreadsheet[3])
  return filePath.trim() && sheet.trim() && cell.trim() ? { kind: "spreadsheet", filePath, sheet, cell } : null
}

export function fileAnnotationLabel(annotation: FileAnnotation) {
  return `${fileNameFromPath(annotation.filePath)} ${annotation.kind === "text" ? annotation.lineNum : annotation.cell}`
}
