import type { PptxSelectionContext } from "@silurus/ooxml/pptx"

import type { PresentationSelectionPayload, PreviewSelectionBox } from "@/features/files/selection"

export function presentationPreviewSelection(
  container: HTMLElement,
  context: PptxSelectionContext | null,
  scale: number
): PresentationSelectionPayload | null {
  if (!context || context.kind !== "text" || !context.text.trim()) return null
  const selection = container.ownerDocument.getSelection()
  if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode ||
      !container.contains(selection.anchorNode) || !container.contains(selection.focusNode) ||
      selection.rangeCount === 0 || !Number.isFinite(scale) || scale <= 0) return null

  const rects = Array.from(selection.getRangeAt(0).getClientRects())
  const boxes: PreviewSelectionBox[] = []
  // The viewer exposes run identity through its API. Its rendered slide wrappers
  // supply only the viewport geometry needed for the existing pixel-box contract.
  for (const slideIndex of context.slideIndexes) {
    const canvas = container.querySelector<HTMLCanvasElement>(
      '[data-slide-index="' + slideIndex + '"] > canvas'
    )
    if (!canvas) continue
    const slide = canvas.getBoundingClientRect()
    for (const rect of rects) {
      const left = Math.max(rect.left, slide.left)
      const top = Math.max(rect.top, slide.top)
      const right = Math.min(rect.right, slide.right)
      const bottom = Math.min(rect.bottom, slide.bottom)
      if (right <= left || bottom <= top) continue
      boxes.push({
        surfaceIndex: slideIndex,
        x: (left - slide.left) / scale,
        y: (top - slide.top) / scale,
        width: (right - left) / scale,
        height: (bottom - top) / scale,
      })
    }
  }
  return {
    kind: "presentation",
    confidence: "exact",
    coordinateSpace: "pptx-slide-pixels",
    text: context.text.trim(),
    slideIndexes: [...context.slideIndexes],
    boxes,
    nodeIds: [...context.shapeIds],
    nodePaths: [...new Set(context.runs.flatMap((run) => run.elementIndex === undefined ? [] : [
      "slides/" + run.slideIndex + "/" + (run.origin ?? "unknown") + "/elements/" + run.elementIndex,
    ]))],
  }
}
