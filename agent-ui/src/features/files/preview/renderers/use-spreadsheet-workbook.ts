import * as React from "react"

import type { SpreadsheetWorkbook } from "./spreadsheet-model"
import type {
  SpreadsheetWorkerRequest,
  SpreadsheetWorkerResponse,
} from "./spreadsheet-worker-protocol"

type SpreadsheetWorkbookState =
  | { status: "idle" | "loading"; workbook: null; error: null }
  | {
      status: "ready"
      workbook: SpreadsheetWorkbook
      error: null
    }
  | { status: "error"; workbook: null; error: string }

const IDLE_STATE: SpreadsheetWorkbookState = {
  status: "idle",
  workbook: null,
  error: null,
}

export function useSpreadsheetWorkbook({
  source,
  fileName,
  mediaType,
}: {
  source: string
  fileName: string
  mediaType: string
}) {
  const [state, setState] =
    React.useState<SpreadsheetWorkbookState>(IDLE_STATE)

  React.useEffect(() => {
    if (!source) {
      setState(IDLE_STATE)
      return
    }

    let active = true
    let worker: Worker

    setState({ status: "loading", workbook: null, error: null })

    try {
      worker = new Worker(
        new URL("./spreadsheet-parser.worker.ts", import.meta.url),
        { type: "module" }
      )
    } catch (error: unknown) {
      setState({
        status: "error",
        workbook: null,
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }

    worker.onmessage = (
      event: MessageEvent<SpreadsheetWorkerResponse>
    ) => {
      worker.terminate()

      if (!active) {
        return
      }

      if (event.data.status === "error") {
        setState({
          status: "error",
          workbook: null,
          error: event.data.error,
        })
        return
      }

      setState({
        status: "ready",
        workbook: event.data.workbook,
        error: null,
      })
    }
    worker.onerror = (event) => {
      worker.terminate()

      if (active) {
        setState({
          status: "error",
          workbook: null,
          error: event.message || "Unable to parse spreadsheet",
        })
      }
    }

    const request: SpreadsheetWorkerRequest = {
      source,
      fileName,
      mediaType,
    }
    worker.postMessage(request)

    return () => {
      active = false
      worker.terminate()
    }
  }, [fileName, mediaType, source])

  return state
}
