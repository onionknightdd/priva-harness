import * as React from "react"
import { DocxScrollViewer } from "@silurus/ooxml/docx"
import { useTranslation } from "react-i18next"

import { usePreviewSelectionReporter } from "@/features/files/selection"

import { PreviewRequestState } from "../preview-request-state"
import { documentPreviewSelection } from "./document-selection"

export function DocumentRenderer({ fileId, source }: { fileId: string; source: string }) {
  const { t } = useTranslation()
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const { clearSelection, reportSelection } = usePreviewSelectionReporter(fileId)

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const controller = new AbortController()
    let active = true
    let viewer: DocxScrollViewer | undefined
    let selectionFrame = 0
    const fail = (reason: unknown) => {
      if (!active) return
      clearSelection()
      setLoading(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    }
    const updateSelection = () => {
      if (!active || !viewer) return
      const selection = documentPreviewSelection(container, viewer.getSelectionContext(), viewer.getScale())
      if (selection) reportSelection(selection)
      else clearSelection()
    }
    setLoading(true)
    setError(null)
    clearSelection()

    void (async () => {
      const response = await fetch(source, { signal: controller.signal })
      if (!response.ok) throw new Error(response.statusText || "HTTP " + response.status)
      const data = await response.arrayBuffer()
      if (!active) return
      const signature = new Uint8Array(data, 0, Math.min(4, data.byteLength))
      if (signature[0] !== 0x50 || signature[1] !== 0x4b ||
          signature[2] !== 0x03 || signature[3] !== 0x04) {
        throw new Error(t("filePreview.loadFailedDescription"))
      }
      viewer = new DocxScrollViewer(container, {
        useGoogleFonts: false,
        enableTextSelection: true,
        sliceLayout: true,
        background: "transparent",
        paddingTop: 20,
        paddingBottom: 20,
        paddingLeft: 16,
        paddingRight: 16,
        onError: fail,
        onSelectionContextChange: updateSelection,
        onScaleChange: () => {
          cancelAnimationFrame(selectionFrame)
          selectionFrame = requestAnimationFrame(updateSelection)
        },
      })
      await viewer.load(data)
      if (!active) return
      if (viewer.pageCount === 0) throw new Error(t("filePreview.loadFailedDescription"))
      setLoading(false)
    })().catch(fail)

    return () => {
      active = false
      controller.abort()
      cancelAnimationFrame(selectionFrame)
      viewer?.destroy()
      clearSelection()
    }
  }, [clearSelection, fileId, reportSelection, source, t])

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-muted/30">
      <div ref={containerRef} className="h-full min-h-0" />
      {(loading || error) && (
        <div className="absolute inset-0 bg-background/85">
          <PreviewRequestState loading={loading} error={error ?? undefined} />
        </div>
      )}
    </div>
  )
}
