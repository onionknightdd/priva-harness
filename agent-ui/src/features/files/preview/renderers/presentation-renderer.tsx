import * as React from "react"
import {
  PptxViewer,
  RECOMMENDED_ZIP_LIMITS,
  type TextBounds,
} from "@aiden0z/pptx-renderer"

import {
  usePreviewSelectionReporter,
  type PresentationSelectionPayload,
  type PreviewSelectionBox,
} from "@/features/files/selection"

import { PreviewRequestState } from "../preview-request-state"
import { useBinaryPreview } from "./use-binary-preview"

function intersects(
  first: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  second: Pick<DOMRect, "left" | "right" | "top" | "bottom">
) {
  return (
    first.left < second.right &&
    first.right > second.left &&
    first.top < second.bottom &&
    first.bottom > second.top
  )
}

function boxIntersectsTextBounds(
  box: PreviewSelectionBox,
  slideIndex: number,
  bounds: TextBounds
) {
  return (
    box.surfaceIndex === slideIndex &&
    box.x < bounds.x + bounds.w &&
    box.x + box.width > bounds.x &&
    box.y < bounds.y + bounds.h &&
    box.y + box.height > bounds.y
  )
}

function getPresentationSelection(
  container: HTMLElement,
  viewer: PptxViewer
): PresentationSelectionPayload | null {
  const selection = window.getSelection()

  if (
    !selection ||
    selection.isCollapsed ||
    !selection.anchorNode ||
    !selection.focusNode ||
    !container.contains(selection.anchorNode) ||
    !container.contains(selection.focusNode) ||
    selection.rangeCount === 0
  ) {
    return null
  }

  const text = selection.toString().trim()
  if (!text) {
    return null
  }

  const clientRects = Array.from(
    selection.getRangeAt(0).getClientRects()
  ).filter((rect) => rect.width > 0 && rect.height > 0)
  const boxes: PreviewSelectionBox[] = []

  for (const slideItem of container.querySelectorAll<HTMLElement>(
    "[data-slide-index]"
  )) {
    const slideIndex = Number(slideItem.dataset.slideIndex)
    const slideElement = slideItem.firstElementChild?.firstElementChild

    if (
      !Number.isInteger(slideIndex) ||
      !(slideElement instanceof HTMLElement)
    ) {
      continue
    }

    const slideRect = slideElement.getBoundingClientRect()
    const scaleX = slideRect.width / viewer.slideWidth
    const scaleY = slideRect.height / viewer.slideHeight

    if (!scaleX || !scaleY) {
      continue
    }

    for (const rect of clientRects) {
      if (!intersects(rect, slideRect)) {
        continue
      }

      const left = Math.max(rect.left, slideRect.left)
      const top = Math.max(rect.top, slideRect.top)
      const right = Math.min(rect.right, slideRect.right)
      const bottom = Math.min(rect.bottom, slideRect.bottom)

      boxes.push({
        surfaceIndex: slideIndex,
        x: (left - slideRect.left) / scaleX,
        y: (top - slideRect.top) / scaleY,
        width: (right - left) / scaleX,
        height: (bottom - top) / scaleY,
      })
    }
  }

  if (boxes.length === 0) {
    return null
  }

  const slideIndexes = [
    ...new Set(boxes.map((box) => box.surfaceIndex)),
  ]
  const matches =
    text.length <= 500
      ? viewer
          .searchText(text)
          .filter((match) =>
            boxes.some((box) =>
              boxIntersectsTextBounds(box, match.slideIndex, match.bounds)
            )
          )
      : []

  return {
    kind: "presentation",
    confidence: "inferred",
    coordinateSpace: "pptx-slide-pixels",
    text,
    boxes,
    slideIndexes,
    nodeIds:
      matches.length > 0
        ? [...new Set(matches.map((match) => match.nodeId))]
        : undefined,
    nodePaths:
      matches.length > 0
        ? [...new Set(matches.map((match) => match.nodePath))]
        : undefined,
  }
}

export function PresentationRenderer({
  fileId,
  source,
}: {
  fileId: string
  source: string
}) {
  const binary = useBinaryPreview(source)
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const selectionFrameRef = React.useRef<number | null>(null)
  const [rendering, setRendering] = React.useState(true)
  const [renderError, setRenderError] = React.useState<string | null>(null)
  const { clearSelection, reportSelection } =
    usePreviewSelectionReporter(fileId)

  React.useEffect(() => {
    if (
      binary.status !== "ready" ||
      !viewportRef.current ||
      !containerRef.current
    ) {
      return
    }

    let active = true
    const controller = new AbortController()
    const viewport = viewportRef.current
    const container = containerRef.current
    const viewer = new PptxViewer(container, {
      fitMode: "contain",
      lazyMedia: true,
      lazySlides: true,
      scrollContainer: viewport,
      zipLimits: RECOMMENDED_ZIP_LIMITS,
    })

    setRendering(true)
    setRenderError(null)
    clearSelection()

    const handleSelectionChange = () => {
      if (selectionFrameRef.current !== null) {
        cancelAnimationFrame(selectionFrameRef.current)
      }

      selectionFrameRef.current = requestAnimationFrame(() => {
        selectionFrameRef.current = null
        const selection = getPresentationSelection(container, viewer)

        if (selection) {
          reportSelection(selection)
        } else {
          clearSelection()
        }
      })
    }

    document.addEventListener("selectionchange", handleSelectionChange)

    void viewer
      .open(binary.data, {
        renderMode: "list",
        lazyMedia: true,
        lazySlides: true,
        signal: controller.signal,
        listOptions: {
          windowed: true,
          batchSize: 8,
          initialSlides: 3,
          overscanViewport: 1.5,
          showSlideLabels: true,
        },
      })
      .then(() => {
        if (active) {
          setRendering(false)
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setRenderError(
            error instanceof Error ? error.message : String(error)
          )
        }
      })

    return () => {
      active = false
      controller.abort()
      document.removeEventListener("selectionchange", handleSelectionChange)
      if (selectionFrameRef.current !== null) {
        cancelAnimationFrame(selectionFrameRef.current)
        selectionFrameRef.current = null
      }
      clearSelection()
      viewer.destroy()
    }
  }, [binary, clearSelection, reportSelection])

  if (binary.status === "loading") {
    return <PreviewRequestState loading />
  }

  if (binary.status === "error") {
    return <PreviewRequestState error={binary.error} />
  }

  if (renderError) {
    return <PreviewRequestState error={renderError} />
  }

  return (
    <div
      ref={viewportRef}
      className="relative h-full min-h-0 overflow-auto overscroll-contain bg-muted/30"
    >
      <div
        ref={containerRef}
        className="min-h-full min-w-0 px-4 py-5"
      />
      {rendering && (
        <div className="absolute inset-0 bg-background/85">
          <PreviewRequestState loading />
        </div>
      )}
    </div>
  )
}
