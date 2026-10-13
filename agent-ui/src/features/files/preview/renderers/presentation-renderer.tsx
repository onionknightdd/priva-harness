import * as React from "react"
import { PptxScrollViewer } from "@silurus/ooxml/pptx"
import { useTranslation } from "react-i18next"

import { usePreviewSelectionReporter } from "@/features/files/selection"

import { PreviewRequestState } from "../preview-request-state"
import { presentationPreviewSelection } from "./presentation-selection"

export function PresentationRenderer({ fileId, source }: { fileId: string; source: string }) {
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
    let viewer: PptxScrollViewer | undefined
    const fail = (reason: unknown) => {
      if (!active) return
      clearSelection()
      setLoading(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    }
    setLoading(true)
    setError(null)
    clearSelection()

    void (async () => {
      const response = await fetch(source, { signal: controller.signal })
      if (!response.ok) throw new Error(response.statusText || "HTTP " + response.status)
      const data = await response.arrayBuffer()
      if (!active) return
      // Reject non-OOXML input before the parser turns it into a blank slide.
      const signature = new Uint8Array(data, 0, Math.min(4, data.byteLength))
      if (signature[0] !== 0x50 || signature[1] !== 0x4b ||
          signature[2] !== 0x03 || signature[3] !== 0x04) {
        throw new Error(t("filePreview.loadFailedDescription"))
      }
      viewer = new PptxScrollViewer(container, {
        useGoogleFonts: false,
        enableTextSelection: true,
        background: "transparent",
        paddingTop: 20,
        paddingBottom: 20,
        paddingLeft: 16,
        paddingRight: 16,
        onError: fail,
        onSelectionContextChange: (context) => {
          if (!active || !viewer) return
          const selection = presentationPreviewSelection(container, context, viewer.getScale())
          if (selection) reportSelection(selection)
          else clearSelection()
        },
      })
      await viewer.load(data)
      if (!active) return
      if (viewer.slideCount === 0) throw new Error(t("filePreview.loadFailedDescription"))
      setLoading(false)
    })().catch(fail)

    return () => {
      active = false
      controller.abort()
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
