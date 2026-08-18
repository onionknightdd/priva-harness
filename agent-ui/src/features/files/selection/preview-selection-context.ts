import { getStrictContext } from "@/lib/get-strict-context"

import type {
  PreviewSelection,
  PreviewSelectionPayload,
} from "./preview-selection.types"

export type PreviewSelectionBridgeValue = {
  clearSelection: (fileId?: string) => void
  reportSelection: (
    fileId: string,
    selection: PreviewSelectionPayload
  ) => void
  selection: PreviewSelection | null
}

export const [
  PreviewSelectionBridgeContext,
  usePreviewSelectionBridgeContext,
] = getStrictContext<PreviewSelectionBridgeValue>(
  "PreviewSelectionBridgeContext"
)
