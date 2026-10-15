import { fileNameFromPath } from "@/lib/file-path"
import type { OfficeElementBox, OfficeElementLocator, OfficeElementType } from "@/features/files/office-assist/office-assist.types"

export type OfficeFileAnnotation = {
  kind: "document" | "presentation"
  filePath: string
  /** SHA-256 of the original file bytes. */
  fileRevision: string
  selectionId: string
  index: number
  elementType: OfficeElementType
  selectedText: string
  coordinateSpace: "docx-page-points" | "pptx-slide-pixels"
  boxes: OfficeElementBox[]
  locator: OfficeElementLocator
}

export type FileAnnotation =
  | { kind: "text"; filePath: string; lineNum: string; selectedText: string }
  | { kind: "spreadsheet"; filePath: string; sheet: string; cell: string }
  | OfficeFileAnnotation

export type FileAnnotationInput = { annotation: FileAnnotation; question: string }

export function isOfficeFileAnnotation(annotation: FileAnnotation): annotation is OfficeFileAnnotation {
  return annotation.kind === "document" || annotation.kind === "presentation"
}

function encodeField(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("\r", "\\r").replaceAll("\n", "\\n")
}

function decodeField(value: string) {
  return value.replace(/\\([\\rn])/g, (_, character: string) => character === "r" ? "\r" : character === "n" ? "\n" : "\\")
}

export function formatFileAnnotation(annotation: FileAnnotation) {
  const fields = isOfficeFileAnnotation(annotation) ? JSON.stringify({
    kind: annotation.kind,
    file_path: annotation.filePath,
    file_revision: annotation.fileRevision,
    selection_id: annotation.selectionId,
    index: annotation.index,
    element_type: annotation.elementType,
    selected_text: annotation.selectedText,
    coordinate_space: annotation.coordinateSpace,
    boxes: annotation.boxes.map(({ surfaceIndex, ...box }) => ({
      [annotation.kind === "document" ? "page_num" : "slide_num"]: surfaceIndex + 1,
      ...box,
    })),
    locator: Object.fromEntries(Object.entries(annotation.locator).map(([key, value]) => [
      key.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`), value,
    ])),
  }, null, 2) : `file_path: ${encodeField(annotation.filePath)}\n` + (annotation.kind === "text"
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
  if (match[2].startsWith("{")) return parseOfficeAnnotation(match[2])
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
  if (isOfficeFileAnnotation(annotation)) {
    const surface = annotation.boxes[0].surfaceIndex + 1
    return `${fileNameFromPath(annotation.filePath)} ${annotation.kind === "document" ? "p." : "slide "}${surface} · #${annotation.index}`
  }
  return `${fileNameFromPath(annotation.filePath)} ${annotation.kind === "text" ? annotation.lineNum : annotation.cell}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim())
}

function parseOfficeAnnotation(text: string): OfficeFileAnnotation | null {
  let value: unknown
  try { value = JSON.parse(text) } catch { return null }
  if (!isRecord(value) || (value.kind !== "document" && value.kind !== "presentation")) return null
  const coordinateSpace = value.kind === "document" ? "docx-page-points" : "pptx-slide-pixels"
  if (!nonemptyString(value.file_path) || !nonemptyString(value.file_revision) || !/^[a-f\d]{64}$/i.test(value.file_revision)
    || !nonemptyString(value.selection_id) || !Number.isSafeInteger(value.index) || Number(value.index) < 1
    || !nonemptyString(value.element_type) || !["paragraph", "table", "table-cell", "image", "chart", "shape", "media"].includes(value.element_type)
    || typeof value.selected_text !== "string" || value.coordinate_space !== coordinateSpace
    || !Array.isArray(value.boxes) || value.boxes.length === 0 || !isRecord(value.locator)) return null
  const boxes: OfficeElementBox[] = []
  for (const box of value.boxes) {
    if (!isRecord(box)) return null
    const page = box[value.kind === "document" ? "page_num" : "slide_num"]
    if (!Number.isSafeInteger(page) || Number(page) < 1
      || ![box.x, box.y, box.width, box.height].every((number) => typeof number === "number" && Number.isFinite(number))
      || Number(box.width) <= 0 || Number(box.height) <= 0
      || (box.rotation !== undefined && (typeof box.rotation !== "number" || !Number.isFinite(box.rotation)))) return null
    boxes.push({ surfaceIndex: Number(page) - 1, x: Number(box.x), y: Number(box.y), width: Number(box.width), height: Number(box.height),
      ...(typeof box.rotation === "number" ? { rotation: box.rotation } : {}),
    })
  }
  const locator = Object.fromEntries(Object.entries(value.locator).map(([key, item]) => [
    key.replace(/_([a-z])/g, (_, character: string) => character.toUpperCase()), item,
  ]))
  if (!nonemptyString(locator.part)
    || (![locator.xpath, locator.shapeId, locator.paragraphId].some(nonemptyString) && !Array.isArray(locator.path))) return null
  for (const field of ["xpath", "shapeId", "paragraphId", "story", "storyInstance"]) {
    if (locator[field] !== undefined && typeof locator[field] !== "string") return null
  }
  if (locator.origin !== undefined && !["slide", "layout", "master"].includes(String(locator.origin))) return null
  for (const field of ["elementIndex", "row", "column"]) {
    if (locator[field] !== undefined && (!Number.isSafeInteger(locator[field]) || Number(locator[field]) < 0)) return null
  }
  if (locator.rotation !== undefined && (typeof locator.rotation !== "number" || !Number.isFinite(locator.rotation))) return null
  for (const field of ["flipH", "flipV"]) {
    if (locator[field] !== undefined && typeof locator[field] !== "boolean") return null
  }
  if (locator.path !== undefined && (!Array.isArray(locator.path) || !locator.path.every((item) => Number.isSafeInteger(item) && Number(item) >= 0))) return null
  return {
    kind: value.kind, filePath: value.file_path, fileRevision: value.file_revision, selectionId: value.selection_id,
    index: Number(value.index), elementType: value.element_type as OfficeElementType, selectedText: value.selected_text,
    coordinateSpace, boxes, locator: locator as OfficeElementLocator,
  }
}
