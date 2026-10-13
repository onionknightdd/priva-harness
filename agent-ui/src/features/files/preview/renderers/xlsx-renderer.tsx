import * as React from "react"
import { XlsxSheetViewer, XlsxWorkbook, type Worksheet } from "@silurus/ooxml/xlsx"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { Tabs, TabsList, TabsTrigger } from "@/components/assistant-ui/tabs"
import { usePreviewSelectionReporter } from "@/features/files/selection"
import { EASE_OUT } from "@/lib/ease"

import { PreviewRequestState } from "../preview-request-state"
import { createCsvCellReader, type CsvCellReader } from "./csv-cell-values"
import { SpreadsheetFormulaBar } from "./spreadsheet-formula-bar"
import { encodeCellAddress, MAX_SELECTION_TEXT_CELLS } from "./spreadsheet-model"
import { csvLoadOptions, isCsvSource } from "./spreadsheet-source"
import { xlsxKeyboardSelection, xlsxPreviewSelection, xlsxSheetExtent } from "./xlsx-selection"

export function XlsxRenderer({ fileId, fileName, mediaType, source }: {
  fileId: string
  fileName: string
  mediaType: string
  source: string
}) {
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()
  const containerRef = React.useRef<HTMLDivElement>(null)
  const switchSheetRef = React.useRef<(index: number) => void>(() => {})
  const [sheetNames, setSheetNames] = React.useState<string[]>([])
  const [sheetIndex, setSheetIndex] = React.useState(0)
  const [formula, setFormula] = React.useState("")
  const [address, setAddress] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const { clearSelection, reportSelection } = usePreviewSelectionReporter(fileId)

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const controller = new AbortController()
    const canvas = document.createElement("canvas")
    canvas.style.width = "100%"
    canvas.style.height = "100%"
    container.appendChild(canvas)
    let active = true
    let generation = 0
    let workbook: XlsxWorkbook | undefined
    let viewer: Omit<XlsxSheetViewer, "load"> | undefined
    let worksheet: Worksheet | undefined
    let worksheetName: string | undefined
    let readCsvCell: CsvCellReader | undefined
    let extent = { rows: 1, columns: 1 }

    const resetSelection = () => {
      clearSelection()
      setFormula("")
      setAddress("")
    }
    const fail = (reason: unknown) => {
      if (!active) return
      resetSelection()
      setError(reason instanceof Error ? reason.message : String(reason))
      setLoading(false)
    }
    const updateSelection = () => {
      if (!active || !viewer || !worksheetName) return
      const context = viewer.getSelectionContext({ maxCells: MAX_SELECTION_TEXT_CELLS })
      if (!context || context.kind !== "range" || context.sheetName !== worksheetName) {
        resetSelection()
        return
      }
      const payload = xlsxPreviewSelection(context, extent)
      reportSelection(payload)
      setAddress(payload.ranges.map((range) => range.address).join(", "))
      const selected = context.selection.activeCell
      const cell = worksheet?.rows.find((row) => row.index === selected.row)
        ?.cells.find((cell) => cell.col === selected.col)
      if (worksheet && workbook) {
        setFormula(cell?.formula
          ? (cell.formula.startsWith("=") ? cell.formula : "=" + cell.formula)
          : cell ? workbook.cellText(worksheet, cell) : "")
      } else {
        // The active cell can be outside the bounded selection-context snapshot.
        setFormula(readCsvCell?.(selected) ?? "")
      }
    }
    const sheetChanged = async (index: number) => {
      const current = ++generation
      if (!active || !viewer) return
      worksheet = undefined
      worksheetName = undefined
      resetSelection()
      setSheetIndex(index)
      const sheet = await workbook?.getWorksheet(index)
      if (!active || current !== generation || !viewer) return
      worksheet = sheet
      worksheetName = viewer.sheetNames[index]
      // The native CSV surface exposes full Excel row/column selections.
      extent = sheet ? xlsxSheetExtent(sheet) : { rows: 1_048_576, columns: 16_384 }
      if (!viewer.selectionState) viewer.setSelection("A1")
      updateSelection()
      setLoading(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!viewer || !worksheetName || event.defaultPrevented || event.isComposing ||
          event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement &&
          (target.isContentEditable || target.closest("input, textarea, select"))) return
      const selection = viewer.selectionState
      if (!selection) return
      const next = xlsxKeyboardSelection(selection, event.key, event.shiftKey, extent)
      if (!next) return
      // Preserve the application's range extension and focus-cell navigation.
      event.preventDefault()
      event.stopPropagation()
      viewer.setSelection(next)
      void viewer.scrollToCell(encodeCellAddress(next.activeCell.row - 1, next.activeCell.col - 1)).catch(fail)
    }
    container.addEventListener("keydown", handleKeyDown, true)

    setLoading(true)
    setError(null)
    setSheetNames([])
    resetSelection()
    void (async () => {
      const response = await fetch(source, { signal: controller.signal })
      if (!response.ok) throw new Error(response.statusText || "HTTP " + response.status)
      const data = await response.arrayBuffer()
      if (!active) return
      const options = {
        onSheetChange: (index: number) => { void sheetChanged(index).catch(fail) },
        onSelectionContextChange: updateSelection,
        onError: fail,
      }
      if (isCsvSource(fileName, mediaType)) {
        const csvViewer = new XlsxSheetViewer(canvas, { ...options, useGoogleFonts: false })
        const loadOptions = csvLoadOptions(fileName, data)
        viewer = csvViewer
        await csvViewer.load(data, loadOptions)
        if (!active) return
        readCsvCell = createCsvCellReader(data, loadOptions.encoding)
        updateSelection()
        setSheetNames(csvViewer.sheetNames)
        return
      }
      // The archive parser also accepts non-OOXML inputs as empty workbooks.
      const signature = new Uint8Array(data, 0, Math.min(4, data.byteLength))
      if (signature[0] !== 0x50 || signature[1] !== 0x4b ||
          signature[2] !== 0x03 || signature[3] !== 0x04) {
        throw new Error(t("filePreview.loadFailedDescription"))
      }
      const loaded = await XlsxWorkbook.load(data, { useGoogleFonts: false })
      if (!active) { loaded.destroy(); return }
      workbook = loaded
      setSheetNames(loaded.sheetNames)
      if (loaded.sheetCount === 0) throw new Error(t("filePreview.spreadsheetEmpty"))
      viewer = XlsxSheetViewer.fromWorkbook(canvas, loaded, options)
      switchSheetRef.current = (index) => {
        setLoading(true)
        setError(null)
        resetSelection()
        void viewer?.goToSheet(index).catch(fail)
      }
      await viewer.goToSheet(0)
    })().catch(fail)

    return () => {
      active = false
      controller.abort()
      container.removeEventListener("keydown", handleKeyDown, true)
      switchSheetRef.current = () => {}
      // A borrowed viewer must release its rendering work before its workbook.
      viewer?.destroy()
      workbook?.destroy()
      canvas.remove()
      clearSelection()
    }
  }, [clearSelection, fileId, fileName, mediaType, reportSelection, source, t])

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden bg-background">
      <SpreadsheetFormulaBar address={address} value={formula} />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <motion.div
          ref={containerRef}
          className="h-full min-h-0"
          style={{
            "--ooxml-xlsx-chrome-background": "var(--muted)",
            "--ooxml-xlsx-chrome-surface": "var(--muted)",
            "--ooxml-xlsx-chrome-surface-muted": "color-mix(in srgb, var(--primary) 10%, var(--muted))",
            "--ooxml-xlsx-chrome-selection-background": "color-mix(in srgb, var(--primary) 20%, var(--muted))",
            "--ooxml-xlsx-chrome-border": "var(--border)",
            "--ooxml-xlsx-chrome-text": "var(--foreground)",
            "--ooxml-xlsx-chrome-text-muted": "var(--muted-foreground)",
            "--ooxml-xlsx-chrome-accent": "var(--primary)",
          } as React.CSSProperties}
          initial={false}
          animate={{ opacity: loading || error ? 0 : 1 }}
          transition={{ duration: reduceMotion ? 0 : 0.2, ease: EASE_OUT }}
        />
        {(loading || error) && (
          <div className="absolute inset-0 bg-background">
            <PreviewRequestState loading={loading} error={error ?? undefined} />
          </div>
        )}
      </div>
      <div className="flex min-w-0 shrink-0 items-center overflow-hidden border-t border-border px-2 py-1.5">
        <Tabs value={String(sheetIndex)} onValueChange={(value) => switchSheetRef.current(Number(value))} className="min-w-0 flex-1 gap-0">
          <TabsList variant="ghost" size="sm" aria-label={t("filePreview.spreadsheetSheets")} className="min-w-0 max-w-full justify-start overflow-x-auto overflow-y-hidden">
            {sheetNames.map((name, index) => <TabsTrigger key={index} value={String(index)} className="flex-none">{name}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      </div>
    </div>
  )
}
