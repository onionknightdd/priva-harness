import * as React from "react"
import { PptxPresentation, PptxScrollViewer } from "@silurus/ooxml/pptx"
import { useTranslation } from "react-i18next"

import { usePreviewSelectionReporter } from "@/features/files/selection"
import { OfficeAssistOverlay } from "@/features/files/office-assist/office-assist-overlay"
import type { OfficeAssistSurface } from "@/features/files/office-assist/office-assist.types"
import { createPptxElementPicker } from "@/features/files/office-assist/pptx-element-picker"
import { readOfficeSource } from "@/features/files/office-assist/office-source"

import { PreviewRequestState } from "../preview-request-state"
import { presentationPreviewSelection } from "./presentation-selection"

export function PresentationRenderer({ fileId, source }: { fileId: string; source: string }) {
  const { t } = useTranslation()
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [surface, setSurface] = React.useState<OfficeAssistSurface | null>(null)
  const { clearSelection, reportSelection } = usePreviewSelectionReporter(fileId)

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const controller = new AbortController()
    let active = true
    let presentation: PptxPresentation | undefined
    let viewer: Omit<PptxScrollViewer, "load"> | undefined
    const fail = (reason: unknown) => {
      if (!active) return
      clearSelection()
      setLoading(false)
      setError(reason instanceof Error ? reason.message : String(reason))
      setSurface(null)
    }
    setLoading(true)
    setError(null)
    setSurface(null)
    clearSelection()

    void (async () => {
      const { data, fileRevision } = await readOfficeSource(source, controller.signal, t("filePreview.loadFailedDescription"))
      if (!active) return
      const loaded = await PptxPresentation.load(data.slice(0), { mode: "main", useGoogleFonts: false })
      if (!active) { loaded.destroy(); return }
      presentation = loaded
      const picker = await createPptxElementPicker(loaded, data)
      if (!active) return
      viewer = PptxScrollViewer.fromPresentation(container, loaded, {
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
      if (viewer.slideCount === 0) throw new Error(t("filePreview.loadFailedDescription"))
      const getCanvas = (index: number) => container.querySelector<HTMLCanvasElement>('[data-slide-index="' + index + '"] > canvas')
      setSurface({
        picker, fileRevision, getCanvas,
        scrollTo: (index) => viewer?.scrollToSlide(index),
        unitsPerCssPixel: (index) => {
          const width = getCanvas(index)?.getBoundingClientRect().width ?? 0
          return width ? loaded.slideWidth / 9525 / width : 0
        },
      })
      setLoading(false)
    })().catch(fail)

    return () => {
      active = false
      controller.abort()
      viewer?.destroy()
      presentation?.destroy()
      clearSelection()
    }
  }, [clearSelection, fileId, reportSelection, source, t])

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-muted/30">
      <div ref={containerRef} tabIndex={0} role="region" aria-label={t("filePreview.officeAssist.surface")}
        className="h-full min-h-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring" />
      {!loading && !error && <OfficeAssistOverlay fileId={fileId} containerRef={containerRef} surface={surface} />}
      {(loading || error) && (
        <div className="absolute inset-0 bg-background/85">
          <PreviewRequestState loading={loading} error={error ?? undefined} />
        </div>
      )}
    </div>
  )
}
