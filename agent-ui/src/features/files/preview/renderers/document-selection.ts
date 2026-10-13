import type { DocxSelectionContext } from "@silurus/ooxml/docx"

import type {
  DocumentSelectionPayload,
  PreviewSelectionBox,
} from "@/features/files/selection"

export function documentPreviewSelection(
  container: HTMLElement,
  context: DocxSelectionContext | null,
  scale: number
): DocumentSelectionPayload | null {
  if (!context || context.kind !== "text" || !context.text) return null
  const selection = container.ownerDocument.getSelection()
  if (
    !selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode ||
    !container.contains(selection.anchorNode) || !container.contains(selection.focusNode) ||
    selection.rangeCount === 0 || !Number.isFinite(scale) || scale <= 0
  ) return null

  const rects = Array.from({ length: selection.rangeCount }, (_, index) =>
    Array.from(selection.getRangeAt(index).getClientRects())
  ).flat()
  const boxes: PreviewSelectionBox[] = []
  // DOCX zoom is relative to 96-DPI CSS pixels; the bridge uses 72-DPI points.
  // Canvas backing-store dimensions include DPR and cannot supply this scale.
  const pixelsPerPoint = scale * 96 / 72
  for (const pageIndex of context.pageIndexes) {
    const textLayer = container.querySelector<HTMLElement>(
      '[data-ooxml-selection-surface="docx"][data-page-index="' + pageIndex + '"]'
    )
    const canvas = textLayer?.parentElement?.querySelector<HTMLCanvasElement>(":scope > canvas")
    if (!canvas) continue
    const page = canvas.getBoundingClientRect()
    for (const rect of rects) {
      const left = Math.max(rect.left, page.left)
      const top = Math.max(rect.top, page.top)
      const right = Math.min(rect.right, page.right)
      const bottom = Math.min(rect.bottom, page.bottom)
      if (right <= left || bottom <= top) continue
      boxes.push({
        surfaceIndex: pageIndex,
        x: (left - page.left) / pixelsPerPoint,
        y: (top - page.top) / pixelsPerPoint,
        width: (right - left) / pixelsPerPoint,
        height: (bottom - top) / pixelsPerPoint,
      })
    }
  }

  return {
    kind: "document",
    confidence: "exact",
    coordinateSpace: "docx-page-points",
    text: context.text,
    pageIndexes: [...context.pageIndexes],
    boxes,
    paragraphIds: [...context.paragraphIds],
    runs: context.runs.map(({ source, ...run }) => ({
      ...run,
      ...(source ? { source: { ...source, path: [...source.path] } } : {}),
    })),
    truncated: context.truncated,
    truncationReasons: [...context.truncationReasons],
  }
}
