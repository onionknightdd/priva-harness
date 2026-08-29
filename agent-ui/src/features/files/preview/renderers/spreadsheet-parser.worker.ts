import { parseSpreadsheetWorkbook } from "./spreadsheet-workbook"
import type {
  SpreadsheetWorkerRequest,
  SpreadsheetWorkerResponse,
} from "./spreadsheet-worker-protocol"

type SpreadsheetWorkerScope = {
  onmessage:
    | ((event: MessageEvent<SpreadsheetWorkerRequest>) => void)
    | null
  postMessage(message: SpreadsheetWorkerResponse): void
}

const workerScope = self as unknown as SpreadsheetWorkerScope

workerScope.onmessage = async (event) => {
  try {
    const response = await fetch(event.data.source)

    if (!response.ok) {
      throw new Error(
        response.statusText || `HTTP ${response.status}`
      )
    }

    const data = await response.arrayBuffer()
    const workbook = parseSpreadsheetWorkbook(
      data,
      event.data.fileName,
      event.data.mediaType
    )

    workerScope.postMessage({ status: "ready", workbook })
  } catch (error: unknown) {
    workerScope.postMessage({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
