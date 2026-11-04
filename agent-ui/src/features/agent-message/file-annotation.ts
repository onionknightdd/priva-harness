import { fileNameFromPath } from "@/lib/file-path"
import { HTML_TARGET_LIMITS, type HtmlElementTarget } from "@/features/files/html-assist/html-assist.types"
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

export type HtmlFileAnnotation = Omit<HtmlElementTarget, "label" | "text"> & {
  filePath: string
  /** SHA-256 of the original file bytes. */
  fileRevision: string
  selectionId: string
  index: number
  selectedText: string
}

export type ElementFileAnnotation = OfficeFileAnnotation | HtmlFileAnnotation

export type ModelVector3 = [number, number, number]
export type ModelAnchor = {
  position: ModelVector3
  locator: {
    /** Child indexes in the source scene, stable only within fileRevision. */
    sourceNodePath: number[]
    /** Stable octree node ID; vertexIndex is local to this node. */
    nodeId?: string
    meshIndex?: number
    primitiveIndex?: number
    vertexIndex?: number
    faceIndex?: number
    instanceIndex?: number
  }
}
export type ModelFileAnnotation = {
  kind: "model"
  filePath: string
  /** SHA-256 binding the model and its geometry dependencies. */
  fileRevision: string
  selectionId: string
  index: number
  selectedText: string
  coordinateSpace: "model-world"
  units: {
    metersPerUnit: number | null
    source: "format" | "user" | "unknown"
    displayUnit: "mm" | "cm" | "m" | "in" | "ft" | "model"
  }
  selection: {
    kind: "point" | "distance" | "angle" | "section" | "object"
    anchors: ModelAnchor[]
    /** Distance in model-world units, before display-unit conversion. */
    distance?: number
    /** Angle at the second anchor, in degrees. */
    angle?: number
  }
  view: {
    camera: {
      position: ModelVector3
      target: ModelVector3
      up: ModelVector3
      projection: "perspective"
      zoom: number
    }
    clipping?: { normal: ModelVector3; constant: number }
    /** Animation mixer time in seconds, restoring the selected source pose. */
    animationTime?: number
  }
  screenshotPath?: string
}

export type SpatialFileAnnotation = ElementFileAnnotation | ModelFileAnnotation

export type FileAnnotation =
  | { kind: "text"; filePath: string; lineNum: string; selectedText: string }
  | { kind: "spreadsheet"; filePath: string; sheet: string; cell: string }
  | ElementFileAnnotation
  | ModelFileAnnotation

export type FileAnnotationInput = { annotation: FileAnnotation; question: string }

export function isOfficeFileAnnotation(annotation: FileAnnotation): annotation is OfficeFileAnnotation {
  return annotation.kind === "document" || annotation.kind === "presentation"
}

export function isElementFileAnnotation(annotation: FileAnnotation): annotation is ElementFileAnnotation {
  return annotation.kind === "html" || isOfficeFileAnnotation(annotation)
}

export function isSpatialFileAnnotation(annotation: FileAnnotation): annotation is SpatialFileAnnotation {
  return annotation.kind === "model" || isElementFileAnnotation(annotation)
}

function encodeField(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("\r", "\\r").replaceAll("\n", "\\n")
}

function decodeField(value: string) {
  return value.replace(/\\([\\rn])/g, (_, character: string) => character === "r" ? "\r" : character === "n" ? "\n" : "\\")
}

export function formatFileAnnotation(annotation: FileAnnotation) {
  const fields = annotation.kind === "model" ? JSON.stringify(formatModelAnnotation(annotation), null, 2) : annotation.kind === "html" ? JSON.stringify(formatHtmlAnnotation(annotation), null, 2) : isOfficeFileAnnotation(annotation) ? JSON.stringify({
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
  if (match[2].startsWith("{")) return parseElementAnnotation(match[2])
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
  if (annotation.kind === "model") return `${fileNameFromPath(annotation.filePath)} · 3D #${annotation.index}`
  if (annotation.kind === "html") return `${fileNameFromPath(annotation.filePath)} · #${annotation.index} <${annotation.locator.tagName}>`
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

function parseElementAnnotation(text: string): SpatialFileAnnotation | null {
  let value: unknown
  try { value = JSON.parse(text) } catch { return null }
  if (!isRecord(value)) return null
  return value.kind === "model" ? parseModelAnnotation(value) : value.kind === "html" ? parseHtmlAnnotation(value) : parseOfficeAnnotation(value)
}

function parseOfficeAnnotation(value: Record<string, unknown>): OfficeFileAnnotation | null {
  if (value.kind !== "document" && value.kind !== "presentation") return null
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

function formatHtmlAnnotation(annotation: HtmlFileAnnotation) {
  return {
    kind: annotation.kind,
    file_path: annotation.filePath,
    file_revision: annotation.fileRevision,
    selection_id: annotation.selectionId,
    index: annotation.index,
    element_type: annotation.elementType,
    selected_text: annotation.selectedText,
    coordinate_space: annotation.coordinateSpace,
    boxes: annotation.boxes.map(({ surfaceIndex, x, y, width, height }) => ({ surface_index: surfaceIndex, x, y, width, height })),
    locator: {
      document_id: annotation.locator.documentId,
      node_id: annotation.locator.nodeId,
      selectors: annotation.locator.selectors,
      tag_name: annotation.locator.tagName,
      snapshot_hash: annotation.locator.snapshotHash,
    },
    html: annotation.html,
    ancestors: annotation.ancestors,
    text_truncated: annotation.textTruncated,
    html_truncated: annotation.htmlTruncated,
  }
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function boundedString(value: unknown, maximum: number, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= maximum && (allowEmpty || Boolean(value.trim()))
}

function parseHtmlAnnotation(value: Record<string, unknown>): HtmlFileAnnotation | null {
  if (!hasExactKeys(value, ["kind", "file_path", "file_revision", "selection_id", "index", "element_type", "selected_text", "coordinate_space", "boxes", "locator", "html", "ancestors", "text_truncated", "html_truncated"])
    || !boundedString(value.file_path, 4096) || !boundedString(value.file_revision, 64) || !/^[a-f\d]{64}$/i.test(value.file_revision)
    || !boundedString(value.selection_id, HTML_TARGET_LIMITS.identity) || !Number.isSafeInteger(value.index) || Number(value.index) < 1
    || value.element_type !== "element" || value.coordinate_space !== "html-viewport-css-pixels"
    || !boundedString(value.selected_text, HTML_TARGET_LIMITS.text, true) || !boundedString(value.html, HTML_TARGET_LIMITS.html)
    || typeof value.text_truncated !== "boolean" || typeof value.html_truncated !== "boolean"
    || !Array.isArray(value.ancestors) || value.ancestors.length > HTML_TARGET_LIMITS.ancestors
    || !value.ancestors.every((ancestor) => boundedString(ancestor, HTML_TARGET_LIMITS.ancestor))
    || !Array.isArray(value.boxes) || value.boxes.length !== 1 || !isRecord(value.locator)) return null

  const box: unknown = value.boxes[0]
  if (!isRecord(box) || !hasExactKeys(box, ["surface_index", "x", "y", "width", "height"]) || box.surface_index !== 0
    || ![box.x, box.y, box.width, box.height].every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate) && Math.abs(coordinate) <= HTML_TARGET_LIMITS.coordinate)
    || Number(box.width) <= 0 || Number(box.height) <= 0) return null

  const locator = value.locator
  if (!hasExactKeys(locator, ["document_id", "node_id", "selectors", "tag_name", "snapshot_hash"])
    || !boundedString(locator.document_id, HTML_TARGET_LIMITS.identity) || !/^[a-z][a-z\d-]*$/i.test(locator.document_id)
    || !boundedString(locator.node_id, HTML_TARGET_LIMITS.identity) || !/^[a-z][a-z\d-]*$/i.test(locator.node_id)
    || !boundedString(locator.tag_name, HTML_TARGET_LIMITS.tagName) || !/^[a-z][a-z\d:-]*$/.test(locator.tag_name)
    || typeof locator.snapshot_hash !== "string" || !/^[a-f\d]{16}$/.test(locator.snapshot_hash)
    || !Array.isArray(locator.selectors) || locator.selectors.length === 0 || locator.selectors.length > HTML_TARGET_LIMITS.selectors
    || !locator.selectors.every((selector) => boundedString(selector, HTML_TARGET_LIMITS.selector))) return null

  return {
    kind: "html", filePath: value.file_path, fileRevision: value.file_revision, selectionId: value.selection_id,
    index: Number(value.index), elementType: "element", selectedText: value.selected_text, coordinateSpace: "html-viewport-css-pixels",
    boxes: [{ surfaceIndex: 0, x: Number(box.x), y: Number(box.y), width: Number(box.width), height: Number(box.height) }],
    locator: { documentId: locator.document_id, nodeId: locator.node_id, selectors: locator.selectors, tagName: locator.tag_name, snapshotHash: locator.snapshot_hash },
    html: value.html, ancestors: value.ancestors, textTruncated: value.text_truncated, htmlTruncated: value.html_truncated,
  }
}

function formatModelAnnotation(annotation: ModelFileAnnotation) {
  return {
    kind: "model", file_path: annotation.filePath, file_revision: annotation.fileRevision,
    selection_id: annotation.selectionId, index: annotation.index, selected_text: annotation.selectedText,
    coordinate_space: annotation.coordinateSpace,
    units: { meters_per_unit: annotation.units.metersPerUnit, source: annotation.units.source, display_unit: annotation.units.displayUnit },
    selection: {
      kind: annotation.selection.kind,
      anchors: annotation.selection.anchors.map(({ position, locator }) => ({
        position,
        locator: Object.fromEntries(Object.entries(locator).map(([key, value]) => [
          key.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`), value,
        ])),
      })),
      ...(annotation.selection.distance === undefined ? {} : { distance: annotation.selection.distance }),
      ...(annotation.selection.angle === undefined ? {} : { angle: annotation.selection.angle }),
    },
    view: annotation.view,
    ...(annotation.screenshotPath === undefined ? {} : { screenshot_path: annotation.screenshotPath }),
  }
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function modelVector(value: unknown): value is ModelVector3 {
  return Array.isArray(value) && value.length === 3 && value.every(finiteNumber)
}

function allowedKeys(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
}

function parseModelAnnotation(value: Record<string, unknown>): ModelFileAnnotation | null {
  if (!allowedKeys(value, ["kind", "file_path", "file_revision", "selection_id", "index", "selected_text", "coordinate_space", "units", "selection", "view"], ["screenshot_path"])
    || !boundedString(value.file_path, 4096) || !boundedString(value.file_revision, 64) || !/^[a-f\d]{64}$/i.test(value.file_revision)
    || !boundedString(value.selection_id, 256) || !Number.isSafeInteger(value.index) || Number(value.index) < 1
    || !boundedString(value.selected_text, 8192, true) || value.coordinate_space !== "model-world"
    || !isRecord(value.units) || !isRecord(value.selection) || !isRecord(value.view)
    || (value.screenshot_path !== undefined && (!boundedString(value.screenshot_path, 4096) || /^[a-z][\w+.-]*:/i.test(value.screenshot_path)))) return null
  const units = value.units
  if (!hasExactKeys(units, ["meters_per_unit", "source", "display_unit"])
    || !["format", "user", "unknown"].includes(String(units.source))
    || !["mm", "cm", "m", "in", "ft", "model"].includes(String(units.display_unit))
    || (units.meters_per_unit !== null && (!finiteNumber(units.meters_per_unit) || units.meters_per_unit <= 0))
    || ((units.source === "unknown") !== (units.meters_per_unit === null))
    || (units.meters_per_unit === null && units.display_unit !== "model")) return null
  const selection = value.selection
  if (!allowedKeys(selection, ["kind", "anchors"], ["distance", "angle"])
    || !["point", "distance", "angle", "section", "object"].includes(String(selection.kind))
    || !Array.isArray(selection.anchors) || selection.anchors.length > 3) return null
  const anchors: ModelAnchor[] = []
  for (const anchor of selection.anchors) {
    if (!isRecord(anchor) || !hasExactKeys(anchor, ["position", "locator"]) || !modelVector(anchor.position) || !isRecord(anchor.locator)) return null
    const locator = anchor.locator
    const indexes = ["mesh_index", "primitive_index", "vertex_index", "face_index", "instance_index"]
    if (!allowedKeys(locator, ["source_node_path"], [...indexes, "node_id"])
      || !Array.isArray(locator.source_node_path) || locator.source_node_path.length > 128
      || !locator.source_node_path.every((index) => Number.isSafeInteger(index) && Number(index) >= 0)
      || (locator.node_id !== undefined && (!boundedString(locator.node_id, 256) || !/^[a-zA-Z\d_-]+$/.test(locator.node_id)))
      || indexes.some((key) => locator[key] !== undefined && (!Number.isSafeInteger(locator[key]) || Number(locator[key]) < 0))) return null
    anchors.push({ position: anchor.position, locator: Object.fromEntries(Object.entries(locator).map(([key, item]) => [
      key.replace(/_([a-z])/g, (_, character: string) => character.toUpperCase()), item,
    ])) as ModelAnchor["locator"] })
  }
  if ((selection.kind === "point" && anchors.length !== 1)
    || (selection.kind === "distance" && (anchors.length !== 2 || !finiteNumber(selection.distance) || selection.distance < 0))
    || (selection.kind === "angle" && (anchors.length !== 3 || !finiteNumber(selection.angle) || selection.angle < 0 || selection.angle > 180))
    || (selection.kind !== "distance" && selection.distance !== undefined)
    || (selection.kind !== "angle" && selection.angle !== undefined)) return null
  if (selection.kind === "distance") {
    const distance = Math.hypot(...anchors[0].position.map((position, index) => position - anchors[1].position[index]))
    if (!Number.isFinite(distance) || Math.abs(distance - Number(selection.distance)) > Math.max(1, distance) * 1e-6) return null
  }
  if (selection.kind === "angle") {
    const a = anchors[0].position.map((position, index) => position - anchors[1].position[index])
    const b = anchors[2].position.map((position, index) => position - anchors[1].position[index])
    const length = Math.hypot(...a) * Math.hypot(...b)
    if (!Number.isFinite(length) || length === 0) return null
    const cosine = a.reduce((sum, coordinate, index) => sum + coordinate * b[index], 0) / length
    const angle = Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI
    if (Math.abs(angle - Number(selection.angle)) > 1e-5) return null
  }
  const view = value.view
  if (!allowedKeys(view, ["camera"], ["clipping", "animationTime"]) || !isRecord(view.camera)
    || (view.animationTime !== undefined && (!finiteNumber(view.animationTime) || view.animationTime < 0))) return null
  const camera = view.camera
  if (!hasExactKeys(camera, ["position", "target", "up", "projection", "zoom"])
    || !modelVector(camera.position) || !modelVector(camera.target) || !modelVector(camera.up)
    || Math.hypot(...camera.up) === 0 || camera.position.every((position, index) => position === (camera.target as ModelVector3)[index])
    || camera.projection !== "perspective" || !finiteNumber(camera.zoom) || camera.zoom <= 0) return null
  if (view.clipping !== undefined && (!isRecord(view.clipping) || !hasExactKeys(view.clipping, ["normal", "constant"])
    || !modelVector(view.clipping.normal) || Math.abs(Math.hypot(...view.clipping.normal) - 1) > 1e-5 || !finiteNumber(view.clipping.constant))) return null
  if (selection.kind === "section" && view.clipping === undefined) return null
  return {
    kind: "model", filePath: value.file_path, fileRevision: value.file_revision, selectionId: value.selection_id,
    index: Number(value.index), selectedText: value.selected_text, coordinateSpace: "model-world",
    units: { metersPerUnit: units.meters_per_unit as number | null, source: units.source as ModelFileAnnotation["units"]["source"], displayUnit: units.display_unit as ModelFileAnnotation["units"]["displayUnit"] },
    selection: { kind: selection.kind as ModelFileAnnotation["selection"]["kind"], anchors, ...(selection.distance === undefined ? {} : { distance: Number(selection.distance) }), ...(selection.angle === undefined ? {} : { angle: Number(selection.angle) }) },
    view: view as ModelFileAnnotation["view"],
    ...(value.screenshot_path === undefined ? {} : { screenshotPath: value.screenshot_path as string }),
  }
}
