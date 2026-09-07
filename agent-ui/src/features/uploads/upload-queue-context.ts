import * as React from "react"

import type { UploadBatchHandle, UploadBatchOptions } from "./upload.types"

export type UploadQueueContextValue = {
  enqueueFiles: (directory: string, files: File[], options?: UploadBatchOptions) => UploadBatchHandle
}

export const UploadQueueContext = React.createContext<
  UploadQueueContextValue | undefined
>(undefined)

export function useUploadQueue() {
  const context = React.useContext(UploadQueueContext)

  if (!context) {
    throw new Error("useUploadQueue must be used within UploadQueueProvider")
  }

  return context
}
