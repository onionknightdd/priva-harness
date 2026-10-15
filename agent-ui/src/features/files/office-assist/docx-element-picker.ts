import type { DocxDocument, DocxPageElementRegion } from "@silurus/ooxml/docx"

import { createDocxSourceIndex, docxSourceKey } from "./docx-source"
import type { OfficeElementBox, OfficeElementPicker, OfficeElementTarget } from "./office-assist.types"

type Candidate = {
  target: OfficeElementTarget
  box: OfficeElementBox
}

const labels = {
  paragraph: "Paragraph",
  table: "Table",
  "table-cell": "Table cell",
  image: "Image",
  chart: "Chart",
  shape: "Shape",
} as const

function contains(box: OfficeElementBox, point: { x: number; y: number }) {
  return point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height
}

function area(candidate: Candidate) {
  return candidate.box.width * candidate.box.height
}

function onBorder(box: OfficeElementBox, point: { x: number; y: number }) {
  return Math.min(point.x - box.x, box.x + box.width - point.x, point.y - box.y, box.y + box.height - point.y) <= 3
}

export async function createDocxElementPicker(document: DocxDocument, data: ArrayBuffer): Promise<OfficeElementPicker> {
  if (document.mode !== "main") throw new Error("DOCX element picking requires the main document model")
  const sourceIndex = createDocxSourceIndex(data, document.document)
  await document.waitUntilLayoutComplete()
  const pageCandidates = new Map<number, Candidate[]>()
  const targets = new Map<string, OfficeElementTarget>()

  const addRegion = (region: DocxPageElementRegion) => {
    const source = sourceIndex.resolve(region.source, region.elementType)
    // A synthetic layout object without an original XML source cannot be sent
    // to the agent as a precise file selection.
    if (!source) return
    const key = `${region.elementType}:${docxSourceKey(source.source)}`
    const text = (region.text ?? source.text).slice(0, 20000)
    let target = targets.get(key)
    if (!target) {
      target = {
        kind: "document",
        elementType: region.elementType,
        coordinateSpace: "docx-page-points",
        label: text.trim().replace(/\s+/g, " ").slice(0, 80) || labels[region.elementType],
        text,
        boxes: [],
        locator: {
          ...source.locator,
          ...(region.elementIndex === undefined ? {} : { elementIndex: region.elementIndex }),
        },
      }
      targets.set(key, target)
    }
    const box: OfficeElementBox = {
      surfaceIndex: region.pageIndex,
      x: region.bounds.xPt,
      y: region.bounds.yPt,
      width: region.bounds.widthPt,
      height: region.bounds.heightPt,
    }
    if (!Object.values(box).every(Number.isFinite) || box.width <= 0 || box.height <= 0) return
    target.boxes.push(box)
    const candidates = pageCandidates.get(region.pageIndex) ?? []
    candidates.push({ target, box })
    pageCandidates.set(region.pageIndex, candidates)
  }

  // The public extension reads retained geometry only; no page rasterization is
  // needed. Group by source so a split table/cell keeps every page fragment.
  for (let pageIndex = 0; pageIndex < document.pageCount; pageIndex++) {
    const regions = await document.getPageElementRegions(pageIndex)
    regions.forEach(addRegion)
  }

  return {
    async hitTest(pageIndex, point, options) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
      const candidates = (pageCandidates.get(pageIndex) ?? []).filter((candidate) => contains(candidate.box, point))
      const tables = candidates.filter((candidate) => candidate.target.elementType === "table").sort((left, right) => area(left) - area(right))
      if (options?.parent && tables[0]) return tables[0].target
      const drawing = [...candidates].reverse().find((candidate) => ["image", "chart", "shape"].includes(candidate.target.elementType))
      if (drawing) return drawing.target
      const border = tables.find((candidate) => onBorder(candidate.box, point))
      if (border) return border.target
      const paragraphs = candidates.filter((candidate) => candidate.target.elementType === "paragraph").sort((left, right) => area(left) - area(right))
      if (paragraphs[0]) return paragraphs[0].target
      const cells = candidates.filter((candidate) => candidate.target.elementType === "table-cell").sort((left, right) => area(left) - area(right))
      return cells[0]?.target ?? tables[0]?.target ?? null
    },
  }
}
