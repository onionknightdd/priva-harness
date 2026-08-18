import * as React from "react"

import { usePreviewSelectionBridgeContext } from "./preview-selection-context"
import type { PreviewSelectionPayload } from "./preview-selection.types"

export function usePreviewSelection() {
  return usePreviewSelectionBridgeContext().selection
}

export function usePreviewSelectionReporter(fileId: string) {
  const { clearSelection, reportSelection } =
    usePreviewSelectionBridgeContext()

  return React.useMemo(
    () => ({
      clearSelection: () => clearSelection(fileId),
      reportSelection: (selection: PreviewSelectionPayload) =>
        reportSelection(fileId, selection),
    }),
    [clearSelection, fileId, reportSelection]
  )
}
