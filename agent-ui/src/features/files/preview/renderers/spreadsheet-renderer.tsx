import * as React from "react"
import { Table2Icon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/assistant-ui/tabs"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { usePreviewSelectionReporter } from "@/features/files/selection"
import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"

import { PreviewRequestState } from "../preview-request-state"
import {
  cellFormulaOrValue,
  encodeCellAddress,
  encodeColumnLabel,
  encodeRangeAddress,
  isCoveredCell,
  mergeAt,
  normalizeRange,
  parseSpreadsheetWorkbook,
  selectionText,
  type SpreadsheetCellRange,
  type SpreadsheetSheet,
  type SpreadsheetWorkbook,
} from "./spreadsheet-workbook"
import { useBinaryPreview } from "./use-binary-preview"

type CellPosition = {
  row: number
  column: number
}

type DragMode = "cell" | "row" | "column"

function isInRange(
  row: number,
  column: number,
  range: SpreadsheetCellRange
) {
  return (
    row >= range.rowStart &&
    row <= range.rowEnd &&
    column >= range.columnStart &&
    column <= range.columnEnd
  )
}

function clampPosition(
  sheet: SpreadsheetSheet,
  position: CellPosition
): CellPosition {
  return {
    row: Math.min(
      sheet.originRow + Math.max(sheet.rowCount - 1, 0),
      Math.max(sheet.originRow, position.row)
    ),
    column: Math.min(
      sheet.originColumn + Math.max(sheet.columnCount - 1, 0),
      Math.max(sheet.originColumn, position.column)
    ),
  }
}

function originPosition(sheet: SpreadsheetSheet): CellPosition {
  return {
    row: sheet.originRow,
    column: sheet.originColumn,
  }
}

function lastPosition(sheet: SpreadsheetSheet): CellPosition {
  return {
    row: sheet.originRow + Math.max(sheet.rowCount - 1, 0),
    column: sheet.originColumn + Math.max(sheet.columnCount - 1, 0),
  }
}

function readIntegerDataset(value: string | undefined) {
  if (value == null) {
    return null
  }

  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

function pointerTarget(
  event: Pick<React.PointerEvent, "target" | "clientX" | "clientY">
) {
  const target =
    event.target instanceof Element
      ? event.target
      : document.elementFromPoint(event.clientX, event.clientY)

  return target instanceof Element ? target : null
}

function readDragIntent(target: Element | null) {
  const node = target?.closest("[data-sheet-drag]")

  if (!(node instanceof HTMLElement)) {
    return null
  }

  const mode = node.dataset.sheetDrag
  const row = readIntegerDataset(node.dataset.sheetRow)
  const column = readIntegerDataset(node.dataset.sheetColumn)

  if (mode === "all") {
    return { mode: "all" as const }
  }

  if (mode === "row" && row != null) {
    return { mode: "row" as const, row }
  }

  if (mode === "column" && column != null) {
    return { mode: "column" as const, column }
  }

  if (mode === "cell" && row != null && column != null) {
    return { mode: "cell" as const, row, column }
  }

  return null
}

export function SpreadsheetRenderer({
  fileId,
  fileName,
  mediaType,
  source,
}: {
  fileId: string
  fileName: string
  mediaType: string
  source: string
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const binary = useBinaryPreview(source)
  const gridRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef<{
    mode: DragMode
    anchor: CellPosition
  } | null>(null)
  const [workbook, setWorkbook] =
    React.useState<SpreadsheetWorkbook | null>(null)
  const [parseError, setParseError] = React.useState<string | null>(null)
  const [activeSheetId, setActiveSheetId] = React.useState<string | null>(
    null
  )
  const [anchor, setAnchor] = React.useState<CellPosition | null>(null)
  const [focus, setFocus] = React.useState<CellPosition | null>(null)
  const { clearSelection, reportSelection } =
    usePreviewSelectionReporter(fileId)

  React.useEffect(() => {
    if (binary.status !== "ready") {
      return
    }

    let active = true
    setWorkbook(null)
    setParseError(null)
    setActiveSheetId(null)
    setAnchor(null)
    setFocus(null)
    clearSelection()

    try {
      const nextWorkbook = parseSpreadsheetWorkbook(
        binary.data,
        fileName,
        mediaType
      )

      if (!active) {
        return
      }

      if (nextWorkbook.sheets.length === 0) {
        setParseError(t("filePreview.spreadsheetEmpty"))
        return
      }

      setWorkbook(nextWorkbook)
      setActiveSheetId(nextWorkbook.sheets[0]?.id ?? null)
    } catch (error: unknown) {
      if (active) {
        setParseError(
          error instanceof Error ? error.message : String(error)
        )
      }
    }

    return () => {
      active = false
    }
  }, [binary, clearSelection, fileName, mediaType, t])

  const sheet =
    workbook?.sheets.find((candidate) => candidate.id === activeSheetId) ??
    workbook?.sheets[0] ??
    null

  React.useEffect(() => {
    if (!sheet || sheet.rowCount === 0 || sheet.columnCount === 0) {
      return
    }

    const nextOrigin = originPosition(sheet)
    setAnchor(nextOrigin)
    setFocus(nextOrigin)
  }, [sheet])

  const selectionRange = React.useMemo(() => {
    if (!anchor || !focus) {
      return null
    }

    return normalizeRange(anchor, focus)
  }, [anchor, focus])

  React.useEffect(() => {
    if (!sheet || !selectionRange) {
      return
    }

    reportSelection({
      kind: "spreadsheet",
      confidence: "exact",
      coordinateSpace: "sheet-cells",
      sheetId: sheet.id,
      sheetName: sheet.name,
      ranges: [
        {
          ...selectionRange,
          address: encodeRangeAddress(selectionRange),
        },
      ],
      text: selectionText(sheet, selectionRange),
    })
  }, [reportSelection, selectionRange, sheet])

  const selectCells = React.useCallback(
    (nextAnchor: CellPosition, nextFocus: CellPosition) => {
      if (!sheet) {
        return
      }

      setAnchor(clampPosition(sheet, nextAnchor))
      setFocus(clampPosition(sheet, nextFocus))
    },
    [sheet]
  )

  const applyDragIntent = React.useCallback(
    (
      intent: ReturnType<typeof readDragIntent>,
      options: { extend: boolean; beginDrag: boolean }
    ) => {
      if (!sheet || !intent) {
        return
      }

      const origin = originPosition(sheet)
      const last = lastPosition(sheet)

      if (intent.mode === "all") {
        selectCells(origin, last)
        return
      }

      if (intent.mode === "row") {
        const nextAnchor = options.extend && anchor
          ? anchor
          : { row: intent.row, column: origin.column }
        const nextFocus = { row: intent.row, column: last.column }
        selectCells(nextAnchor, nextFocus)

        if (options.beginDrag) {
          dragRef.current = {
            mode: "row",
            anchor: { row: nextAnchor.row, column: origin.column },
          }
        }
        return
      }

      if (intent.mode === "column") {
        const nextAnchor = options.extend && anchor
          ? anchor
          : { row: origin.row, column: intent.column }
        const nextFocus = { row: last.row, column: intent.column }
        selectCells(nextAnchor, nextFocus)

        if (options.beginDrag) {
          dragRef.current = {
            mode: "column",
            anchor: { row: origin.row, column: nextAnchor.column },
          }
        }
        return
      }

      const nextAnchor =
        options.extend && anchor
          ? anchor
          : { row: intent.row, column: intent.column }
      const nextFocus = { row: intent.row, column: intent.column }
      selectCells(nextAnchor, nextFocus)

      if (options.beginDrag) {
        dragRef.current = {
          mode: "cell",
          anchor: nextAnchor,
        }
      }
    },
    [anchor, selectCells, sheet]
  )

  const handleGridPointerDown = (
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    if (event.button !== 0) {
      return
    }

    const intent = readDragIntent(pointerTarget(event))

    if (!intent) {
      return
    }

    event.preventDefault()
    gridRef.current?.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    applyDragIntent(intent, {
      extend: event.shiftKey,
      beginDrag: intent.mode !== "all",
    })
  }

  const handleGridPointerMove = (
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    const drag = dragRef.current

    if (!drag || !sheet) {
      return
    }

    const intent = readDragIntent(
      document.elementFromPoint(event.clientX, event.clientY)
    )

    if (!intent || intent.mode === "all") {
      return
    }

    if (drag.mode === "row" && intent.mode === "row") {
      selectCells(drag.anchor, {
        row: intent.row,
        column: lastPosition(sheet).column,
      })
      return
    }

    if (drag.mode === "column" && intent.mode === "column") {
      selectCells(drag.anchor, {
        row: lastPosition(sheet).row,
        column: intent.column,
      })
      return
    }

    if (drag.mode === "cell" && intent.mode === "cell") {
      selectCells(drag.anchor, {
        row: intent.row,
        column: intent.column,
      })
    }
  }

  const handleGridPointerUp = (
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    dragRef.current = null
  }

  const handleGridKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>
  ) => {
    if (!sheet || !anchor || !focus) {
      return
    }

    const delta = {
      ArrowUp: { row: -1, column: 0 },
      ArrowDown: { row: 1, column: 0 },
      ArrowLeft: { row: 0, column: -1 },
      ArrowRight: { row: 0, column: 1 },
      Tab: { row: 0, column: event.shiftKey ? -1 : 1 },
    }[event.key]

    if (!delta) {
      if (event.key === "Escape") {
        event.preventDefault()
        selectCells(focus, focus)
      }
      return
    }

    event.preventDefault()
    const nextFocus = {
      row: focus.row + delta.row,
      column: focus.column + delta.column,
    }

    if (event.shiftKey && event.key !== "Tab") {
      selectCells(anchor, nextFocus)
      return
    }

    selectCells(nextFocus, nextFocus)
  }

  const handleCopy = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (!sheet || !selectionRange) {
      return
    }

    const text = selectionText(sheet, selectionRange)

    if (!text) {
      return
    }

    event.preventDefault()
    event.clipboardData.setData("text/plain", text)
  }

  if (
    binary.status === "loading" ||
    (binary.status === "ready" && !workbook && !parseError)
  ) {
    return <PreviewRequestState loading />
  }

  if (binary.status === "error") {
    return <PreviewRequestState error={binary.error} />
  }

  if (parseError || !workbook || !sheet) {
    return <PreviewRequestState error={parseError ?? undefined} />
  }

  const rangeAddress = selectionRange
    ? encodeRangeAddress(selectionRange)
    : focus
      ? encodeCellAddress(focus.row, focus.column)
      : ""
  const formulaValue =
    sheet && focus
      ? cellFormulaOrValue(sheet, focus.row, focus.column)
      : ""

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <div className="border-b border-border p-2">
        <InputGroup aria-label={t("filePreview.spreadsheetFormulaBar")}>
          <InputGroupAddon className="min-w-16 justify-center border-r border-border">
            <InputGroupText className="font-mono text-xs tabular-nums">
              {rangeAddress}
            </InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            readOnly
            value={formulaValue}
            aria-label={t("filePreview.spreadsheetCellValue")}
          />
        </InputGroup>
      </div>

      <motion.div
        key={sheet.id}
        className="min-h-0 flex-1"
        initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: shouldReduceMotion ? 0 : 0.2, ease: EASE_OUT }}
      >
        {sheet.rowCount === 0 || sheet.columnCount === 0 ? (
          <Empty className="h-full border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Table2Icon />
              </EmptyMedia>
              <EmptyTitle>{t("filePreview.spreadsheetEmptyTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("filePreview.spreadsheetEmpty")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div
            ref={gridRef}
            role="grid"
            tabIndex={0}
            aria-colcount={sheet.columnCount + 1}
            aria-rowcount={sheet.rowCount + 1}
            aria-label={t("filePreview.spreadsheetGrid", {
              name: sheet.name,
            })}
            className="h-full overflow-auto overscroll-contain outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50"
            onPointerDown={handleGridPointerDown}
            onPointerMove={handleGridPointerMove}
            onPointerUp={handleGridPointerUp}
            onPointerCancel={handleGridPointerUp}
            onKeyDown={handleGridKeyDown}
            onCopy={handleCopy}
          >
            <table className="min-w-full border-separate border-spacing-0 text-xs">
              <thead>
                <tr>
                  <th
                    scope="col"
                    data-sheet-drag="all"
                    aria-label={t("filePreview.spreadsheetSelectAll")}
                    className="sticky top-0 left-0 z-30 h-7 min-w-12 border-b border-r border-border bg-muted"
                  />
                  {Array.from(
                    { length: sheet.columnCount },
                    (_, columnOffset) => {
                      const column = sheet.originColumn + columnOffset
                      const selected = Boolean(
                        selectionRange &&
                          column >= selectionRange.columnStart &&
                          column <= selectionRange.columnEnd
                      )

                      return (
                        <th
                          key={column}
                          scope="col"
                          data-sheet-drag="column"
                          data-sheet-column={column}
                          aria-colindex={columnOffset + 2}
                          className={cn(
                            "sticky top-0 z-20 h-7 min-w-24 border-b border-r border-border bg-muted px-2 text-center font-medium text-muted-foreground",
                            selected &&
                              "bg-[color-mix(in_oklch,var(--muted),var(--primary)_12%)] text-foreground"
                          )}
                        >
                          {encodeColumnLabel(column)}
                        </th>
                      )
                    }
                  )}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: sheet.rowCount }, (_, rowOffset) => {
                  const row = sheet.originRow + rowOffset
                  const rowSelected = Boolean(
                    selectionRange &&
                      row >= selectionRange.rowStart &&
                      row <= selectionRange.rowEnd
                  )

                  return (
                    <tr key={row}>
                      <th
                        scope="row"
                        data-sheet-drag="row"
                        data-sheet-row={row}
                        aria-rowindex={rowOffset + 2}
                        className={cn(
                          "sticky left-0 z-10 h-7 min-w-12 border-b border-r border-border bg-muted px-1 text-center font-medium text-muted-foreground",
                          rowSelected &&
                            "bg-[color-mix(in_oklch,var(--muted),var(--primary)_12%)] text-foreground"
                        )}
                      >
                        {row + 1}
                      </th>
                      {Array.from(
                        { length: sheet.columnCount },
                        (_, columnOffset) => {
                          if (isCoveredCell(sheet, rowOffset, columnOffset)) {
                            return null
                          }

                          const column = sheet.originColumn + columnOffset
                          const merge = mergeAt(
                            sheet,
                            rowOffset,
                            columnOffset
                          )
                          const selected = Boolean(
                            selectionRange &&
                              isInRange(row, column, selectionRange)
                          )
                          const active =
                            focus?.row === row && focus.column === column
                          const value =
                            sheet.values[rowOffset]?.[columnOffset] ?? ""

                          return (
                            <td
                              key={column}
                              data-sheet-drag="cell"
                              data-sheet-row={row}
                              data-sheet-column={column}
                              aria-colindex={columnOffset + 2}
                              aria-rowindex={rowOffset + 2}
                              aria-selected={selected}
                              rowSpan={merge?.rowSpan}
                              colSpan={merge?.columnSpan}
                              title={value || undefined}
                              className={cn(
                                "h-7 max-w-64 min-w-24 border-b border-r border-border bg-background px-2 text-left align-middle text-foreground",
                                selected && "bg-primary/10",
                                active &&
                                  "relative z-10 outline-2 outline-offset-[-1px] outline-ring"
                              )}
                            >
                              <span className="block truncate">{value}</span>
                            </td>
                          )
                        }
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>

      <div className="flex min-h-9 shrink-0 items-center gap-2 border-t border-border px-2 py-1">
        <Tabs
          value={sheet.id}
          onValueChange={(nextSheetId) => {
            if (
              workbook.sheets.some((candidate) => candidate.id === nextSheetId)
            ) {
              setActiveSheetId(nextSheetId)
            }
          }}
          className="min-w-0 flex-1 gap-0"
        >
          <TabsList
            variant="ghost"
            size="sm"
            aria-label={t("filePreview.spreadsheetSheets")}
            className="max-w-full overflow-x-auto"
          >
            {workbook.sheets.map((candidate) => (
              <TabsTrigger key={candidate.id} value={candidate.id}>
                {candidate.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {sheet.truncated ? (
          <p className="shrink-0 text-xs text-muted-foreground">
            {t("filePreview.spreadsheetTruncated", {
              rows: sheet.rowCount,
              totalRows: sheet.totalRows,
              columns: sheet.columnCount,
              totalColumns: sheet.totalColumns,
            })}
          </p>
        ) : null}
      </div>
    </div>
  )
}
