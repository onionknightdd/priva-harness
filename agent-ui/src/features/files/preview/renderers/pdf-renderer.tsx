import * as React from "react"
import {
  PDFViewer,
  SelectionPlugin,
  type PluginRegistry,
} from "@embedpdf/react-pdf-viewer"
import { useTheme } from "next-themes"

import { usePreviewSelectionReporter } from "@/features/files/selection"

const PDF_DISABLED_CATEGORIES = [
  "annotation",
  "redaction",
  "insert",
  "form",
  "history",
  "panel-comment",
  "document-menu",
  "document-open",
  "document-close",
  "document-print",
  "document-protect",
  "document-export",
  "document-capture",
  "document-fullscreen",
]

export function PdfRenderer({
  fileId,
  source,
}: {
  fileId: string
  source: string
}) {
  const { resolvedTheme } = useTheme()
  const cleanupRef = React.useRef<(() => void) | null>(null)
  const selectionRevisionRef = React.useRef(0)
  const { clearSelection, reportSelection } =
    usePreviewSelectionReporter(fileId)

  const config = React.useMemo(
    () => ({
      src: source,
      worker: true,
      tabBar: "never" as const,
      fonts: {
        ui: {
          family: "Inter, system-ui, sans-serif",
          stylesheetUrl: null,
        },
        signature: null,
      },
      theme: {
        preference:
          resolvedTheme === "dark"
            ? ("dark" as const)
            : ("light" as const),
      },
      disabledCategories: PDF_DISABLED_CATEGORIES,
      selection: {
        maxCachedGeometries: 80,
        menuHeight: 40,
        minSelectionDragDistance: 2,
        toleranceFactor: 1.25,
      },
    }),
    [resolvedTheme, source]
  )

  const handleReady = React.useCallback(
    (registry: PluginRegistry) => {
      cleanupRef.current?.()

      const plugin = registry.getPlugin<SelectionPlugin>(
        SelectionPlugin.id
      )
      const capability = plugin?.provides()

      if (!capability) {
        return
      }

      cleanupRef.current = capability.onSelectionChange((event) => {
        const revision = ++selectionRevisionRef.current

        if (!event.selection) {
          clearSelection()
          return
        }

        const scope = capability.forDocument(event.documentId)
        const formattedSelection = scope.getFormattedSelection()
        const boxes = formattedSelection.flatMap((pageSelection) =>
          pageSelection.segmentRects.map((rect) => ({
            surfaceIndex: pageSelection.pageIndex,
            x: rect.origin.x,
            y: rect.origin.y,
            width: rect.size.width,
            height: rect.size.height,
          }))
        )
        const pageIndexes = [
          ...new Set(
            formattedSelection.map((selection) => selection.pageIndex)
          ),
        ]
        const glyphRange = {
          start: {
            pageIndex: event.selection.start.page,
            glyphIndex: event.selection.start.index,
          },
          end: {
            pageIndex: event.selection.end.page,
            glyphIndex: event.selection.end.index,
          },
        }

        void scope
          .getSelectedText()
          .toPromise()
          .then((pageText) => {
            if (revision !== selectionRevisionRef.current) {
              return
            }

            reportSelection({
              kind: "pdf",
              confidence: "exact",
              coordinateSpace: "pdf-page-points",
              text: pageText.join("\n"),
              boxes,
              pageIndexes,
              glyphRange,
            })
          })
          .catch(() => {
            if (revision !== selectionRevisionRef.current) {
              return
            }

            reportSelection({
              kind: "pdf",
              confidence: "exact",
              coordinateSpace: "pdf-page-points",
              boxes,
              pageIndexes,
              glyphRange,
            })
          })
      })
    },
    [clearSelection, reportSelection]
  )

  React.useEffect(
    () => () => {
      selectionRevisionRef.current += 1
      cleanupRef.current?.()
      cleanupRef.current = null
      clearSelection()
    },
    [clearSelection]
  )

  return (
    <div className="h-full min-h-0 w-full overflow-hidden bg-background">
      <PDFViewer
        key={`${source}:${resolvedTheme}`}
        config={config}
        onReady={handleReady}
        style={{ height: "100%", width: "100%" }}
      />
    </div>
  )
}
