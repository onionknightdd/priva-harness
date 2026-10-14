import * as React from "react"
import { XlsxSheetViewer, XlsxWorkbook, type Worksheet } from "@silurus/ooxml/xlsx"
import { MessageCircleCodeIcon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs"
import { SelectionActionsPopover } from "@/components/primitives/selection-actions-popover"
import { usePreviewSelection, usePreviewSelectionReporter } from "@/features/files/selection"
import { useOptionalWorkspaceFiles } from "@/features/workspace/workspace-files-context"
import { EASE_OUT } from "@/lib/ease"

import { PreviewRequestState } from "../preview-request-state"
import { createCsvCellReader, type CsvCellReader } from "./csv-cell-values"
import { SpreadsheetFormulaBar } from "./spreadsheet-formula-bar"
import { encodeCellAddress, encodeRangeAddress, MAX_SELECTION_TEXT_CELLS } from "./spreadsheet-model"
import { csvLoadOptions, isCsvSource } from "./spreadsheet-source"
import { xlsxKeyboardSelection, xlsxPreviewSelection, xlsxSheetExtent } from "./xlsx-selection"
import { xlsxSelectionActionsRect } from "./xlsx-selection-actions"

export function XlsxRenderer({ fileId, fileName, mediaType, source }: {
  fileId: string
  fileName: string
  mediaType: string
  source: string
}) {
  const { t } = useTranslation()
  const workspaceFiles = useOptionalWorkspaceFiles()
  const previewSelection = usePreviewSelection()
  const reduceMotion = useReducedMotion()
  const containerRef = React.useRef<HTMLDivElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)
  const switchSheetRef = React.useRef<(index: number) => void>(() => {})
  const [anchorRect, setAnchorRect] = React.useState<ReturnType<typeof xlsxSelectionActionsRect>>(null)
  const [keyboardSelection, setKeyboardSelection] = React.useState(false)
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
    let selectionFrame: number | null = null
    let selectionRequest = 0
    let selectingPointer: { id: number; x: number; y: number } | null = null
    let actionsOpen = false

    const dismissActions = (invalidate = true) => {
      if (selectionFrame !== null) cancelAnimationFrame(selectionFrame)
      selectionFrame = null
      if (invalidate) selectionRequest++
      actionsOpen = false
      setAnchorRect(null)
    }
    const visible = () => {
      const bounds = canvas.getBoundingClientRect()
      return bounds.width > 0 && bounds.height > 0 &&
        !container.closest('[hidden], [inert], [aria-hidden="true"]') &&
        getComputedStyle(container).visibility === "visible"
    }
    const showActions = (keyboard: boolean, pointer?: { x: number; y: number }) => {
      if (selectionFrame !== null) cancelAnimationFrame(selectionFrame)
      const request = selectionRequest
      const sheetGeneration = generation
      selectionFrame = requestAnimationFrame(() => {
        selectionFrame = null
        if (!active || request !== selectionRequest || sheetGeneration !== generation ||
            !viewer || !worksheetName || !visible()) return
        const currentViewer = viewer
        const selection = currentViewer.selectionState
        const bounds = canvas.getBoundingClientRect()
        const area = selection?.areas[selection.activeAreaIndex]
        const pointerInside = pointer && pointer.x >= bounds.left && pointer.x < bounds.right &&
          pointer.y >= bounds.top && pointer.y < bounds.bottom
        // Header selections preserve the release row/column by moving only the
        // other coordinate into the grid before using the public hit-test.
        const target = keyboard ? selection?.activeCell : pointerInside ? currentViewer.getCellAt(
          area?.kind === "rows" ? bounds.left + bounds.width / 2 : pointer.x,
          area?.kind === "columns" ? bounds.top + bounds.height / 2 : pointer.y
        ) : null
        const rect = selection && xlsxSelectionActionsRect(selection, bounds,
          (cell) => currentViewer.getCellViewportRect(cell), target)
        actionsOpen = Boolean(rect)
        setKeyboardSelection(keyboard)
        setAnchorRect(rect)
      })
    }
    const viewportInput = () => container.querySelector<HTMLElement>("[data-xlsx-viewport-input]")
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      selectingPointer = null
      dismissActions()
      if (event.button !== 0 || !(event.target instanceof Element)) return
      const input = event.target.closest<HTMLElement>("[data-xlsx-viewport-input]")
      if (!input || !container.contains(input) || !worksheetName || !visible()) return
      const bounds = input.getBoundingClientRect()
      if (event.clientX - bounds.left - input.clientLeft >= input.clientWidth ||
          event.clientY - bounds.top - input.clientTop >= input.clientHeight ||
          ["col-resize", "row-resize"].includes(input.style.cursor)) return
      window.getSelection()?.removeAllRanges()
      selectingPointer = { id: event.pointerId, x: event.clientX, y: event.clientY }
    }
    const handlePointerUp = (event: PointerEvent) => {
      if (selectingPointer?.id !== event.pointerId) return
      const movement = (event.clientX - selectingPointer.x) ** 2 + (event.clientY - selectingPointer.y) ** 2
      selectingPointer = null
      // The native viewer treats touch/pen drags as scrolling rather than selection.
      if (event.pointerType !== "mouse" && movement > 64) return
      showActions(false, { x: event.clientX, y: event.clientY })
    }
    const cancelPointer = () => {
      selectingPointer = null
      dismissActions()
    }
    const handlePointerCancel = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      cancelPointer()
    }
    const handleActionsKeyDown = (event: KeyboardEvent) => {
      if (!actionsOpen || event.isComposing || event.keyCode === 229 || !(event.target instanceof Node)) return
      const inMenu = menuRef.current?.contains(event.target)
      if (event.key === "Escape") {
        if (inMenu && menuRef.current?.querySelector("[data-selection-action-input]")) return
        dismissActions()
        if (inMenu) {
          event.preventDefault()
          event.stopPropagation()
          viewportInput()?.focus({ preventScroll: true })
        }
      } else if (event.key === "Tab" && !event.shiftKey && !inMenu && container.contains(event.target)) {
        event.preventDefault()
        event.stopPropagation()
        menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus()
      }
    }
    const handleScroll = () => dismissActions(false)
    const handleDocumentScroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      handleScroll()
    }
    const handleDismiss = () => dismissActions()
    const resizeObserver = new ResizeObserver(handleDismiss)
    resizeObserver.observe(container)
    const visibilityObserver = new MutationObserver(() => {
      if (!visible()) cancelPointer()
    })
    for (let ancestor: HTMLElement | null = container; ancestor; ancestor = ancestor.parentElement) {
      visibilityObserver.observe(ancestor, { attributes: true,
        attributeFilter: ["class", "style", "hidden", "inert", "aria-hidden"] })
    }
    document.addEventListener("pointerdown", handlePointerDown, true)
    document.addEventListener("pointerup", handlePointerUp, true)
    document.addEventListener("pointercancel", handlePointerCancel, true)
    document.addEventListener("keydown", handleActionsKeyDown, true)
    document.addEventListener("scroll", handleDocumentScroll, true)
    document.addEventListener("contextmenu", handleDismiss, true)
    window.addEventListener("resize", handleDismiss)
    window.addEventListener("blur", cancelPointer)

    const resetSelection = () => {
      selectingPointer = null
      dismissActions()
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
      dismissActions()
      const request = selectionRequest
      const sheetGeneration = generation
      viewer.setSelection(next)
      void viewer.scrollToCell(encodeCellAddress(next.activeCell.row - 1, next.activeCell.col - 1))
        .then(() => {
          if (active && event.key !== "Escape" && request === selectionRequest && sheetGeneration === generation) {
            showActions(true)
          }
        }).catch(fail)
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
        onViewportChange: handleScroll,
        onScaleChange: handleDismiss,
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
      dismissActions()
      resizeObserver.disconnect()
      visibilityObserver.disconnect()
      document.removeEventListener("pointerdown", handlePointerDown, true)
      document.removeEventListener("pointerup", handlePointerUp, true)
      document.removeEventListener("pointercancel", handlePointerCancel, true)
      document.removeEventListener("keydown", handleActionsKeyDown, true)
      document.removeEventListener("scroll", handleDocumentScroll, true)
      document.removeEventListener("contextmenu", handleDismiss, true)
      window.removeEventListener("resize", handleDismiss)
      window.removeEventListener("blur", cancelPointer)
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
      <SelectionActionsPopover
        anchorRect={loading || error ? null : anchorRect}
        instant={Boolean(reduceMotion) || keyboardSelection}
        menuRef={menuRef}
        kind="file"
        label={t("filePreview.selectionMenuLabel")}
        actions={[{
          id: "ask-agent",
          label: t("filePreview.askAgent"),
          icon: <MessageCircleCodeIcon aria-hidden="true" />,
          input: {
            placeholder: t("filePreview.askAgentPlaceholder"),
            confirmLabel: t("filePreview.confirmAgentQuestion"),
            onConfirm: (question) => {
              if (!workspaceFiles || previewSelection?.kind !== "spreadsheet" || previewSelection.file.id !== fileId || !previewSelection.sheetName || !previewSelection.ranges.length) return
              const sheetPrefix = !isCsvSource(fileName, mediaType)
                ? `'${previewSelection.sheetName.replaceAll("'", "''")}'!` : ""
              const cell = previewSelection.ranges.map((range) => sheetPrefix + (range.address ?? encodeRangeAddress(range))).join(", ")
              setAnchorRect(null)
              workspaceFiles.insertFileAnnotation({ kind: "spreadsheet", filePath: previewSelection.file.path, sheet: previewSelection.sheetName, cell }, question)
            },
          },
        }]}
      />
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
        <Tabs variant="underline" value={String(sheetIndex)} onValueChange={(value) => switchSheetRef.current(Number(value))} className="min-w-0 flex-1">
          <TabsList aria-label={t("filePreview.spreadsheetSheets")} className="h-8">
            {sheetNames.map((name, index) => <TabsTrigger key={index} value={String(index)} className="h-8 min-h-0 px-2 py-0 text-xs font-normal">{name}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      </div>
    </div>
  )
}
