import * as React from "react"
import { transformExcelToFortune } from "@corbe30/fortune-excel"
import type { Cell, Selection, Sheet } from "@fortune-sheet/core"
import {
  Workbook,
  type WorkbookInstance,
} from "@fortune-sheet/react"
import "@fortune-sheet/react/dist/index.css"
import { useTranslation } from "react-i18next"

import { usePreviewSelectionReporter } from "@/features/files/selection"

import { PreviewRequestState } from "../preview-request-state"
import { useBinaryPreview } from "./use-binary-preview"

const MAX_SELECTION_TEXT_CELLS = 2_000

function cellDisplayValue(cell: Cell | null) {
  if (!cell) {
    return ""
  }

  const value = cell.m ?? cell.v

  if (value === null || value === undefined) {
    return ""
  }

  return typeof value === "object" ? JSON.stringify(value) : String(value)
}

function selectionCellCount(selection: Selection) {
  return (
    (selection.row[1] - selection.row[0] + 1) *
    (selection.column[1] - selection.column[0] + 1)
  )
}

function selectionText(
  workbook: WorkbookInstance,
  selections: Selection[],
  sheetId: string
) {
  const totalCells = selections.reduce(
    (count, selection) => count + selectionCellCount(selection),
    0
  )

  if (totalCells > MAX_SELECTION_TEXT_CELLS) {
    return undefined
  }

  return selections
    .map((selection) =>
      workbook
        .getCellsByRange(selection, { id: sheetId })
        .map((row) => row.map(cellDisplayValue).join("\t"))
        .join("\n")
    )
    .join("\n\n")
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
  const { i18n } = useTranslation()
  const binary = useBinaryPreview(source)
  const workbookRef = React.useRef<WorkbookInstance>(null)
  const selectionFrameRef = React.useRef<number | null>(null)
  const [sheets, setSheets] = React.useState<Sheet[] | null>(null)
  const [workbookKey, setWorkbookKey] = React.useState(0)
  const [parseError, setParseError] = React.useState<string | null>(null)
  const { clearSelection, reportSelection } =
    usePreviewSelectionReporter(fileId)

  React.useEffect(() => {
    if (binary.status !== "ready") {
      return
    }

    let active = true
    setSheets(null)
    setParseError(null)
    clearSelection()

    const file = new File([binary.data], fileName, { type: mediaType })

    void transformExcelToFortune(
      file,
      (nextSheets: Sheet[]) => {
        if (active) {
          setSheets(nextSheets)
        }
      },
      (update: number | ((currentKey: number) => number)) => {
        if (!active) {
          return
        }

        setWorkbookKey((currentKey) =>
          typeof update === "function" ? update(currentKey) : update
        )
      },
      workbookRef
    ).catch((error: unknown) => {
      if (active) {
        setParseError(
          error instanceof Error ? error.message : String(error)
        )
      }
    })

    return () => {
      active = false
    }
  }, [binary, clearSelection, fileName, mediaType])

  React.useEffect(
    () => () => {
      if (selectionFrameRef.current !== null) {
        cancelAnimationFrame(selectionFrameRef.current)
      }
    },
    []
  )

  const handleSelectionChange = React.useCallback(
    (sheetId: string, latestSelection: Selection) => {
      if (selectionFrameRef.current !== null) {
        cancelAnimationFrame(selectionFrameRef.current)
      }

      selectionFrameRef.current = requestAnimationFrame(() => {
        selectionFrameRef.current = null
        const workbook = workbookRef.current

        if (!workbook) {
          return
        }

        const selections = workbook.getSelection() ?? [latestSelection]
        const addresses = workbook.getSelectionCoordinates()
        const sheet = workbook.getAllSheets().find(
          (candidate) => candidate.id === sheetId
        )

        reportSelection({
          kind: "spreadsheet",
          confidence: "exact",
          coordinateSpace: "sheet-cells",
          sheetId,
          sheetName: sheet?.name,
          ranges: selections.map((selection, index) => ({
            rowStart: selection.row[0],
            rowEnd: selection.row[1],
            columnStart: selection.column[0],
            columnEnd: selection.column[1],
            address: addresses[index],
          })),
          text: selectionText(workbook, selections, sheetId),
        })
      })
    },
    [reportSelection]
  )

  if (
    binary.status === "loading" ||
    (binary.status === "ready" && !sheets && !parseError)
  ) {
    return <PreviewRequestState loading />
  }

  if (binary.status === "error") {
    return <PreviewRequestState error={binary.error} />
  }

  if (parseError || !sheets) {
    return <PreviewRequestState error={parseError ?? undefined} />
  }

  return (
    <div className="h-full min-h-0 w-full bg-background">
      <Workbook
        key={workbookKey}
        ref={workbookRef}
        allowEdit={false}
        data={sheets}
        hooks={{ afterSelectionChange: handleSelectionChange }}
        lang={i18n.resolvedLanguage?.startsWith("zh") ? "zh" : "en"}
        showFormulaBar
        showSheetTabs
        showToolbar={false}
      />
    </div>
  )
}
