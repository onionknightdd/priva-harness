import type { UploadedFile } from "@/lib/api/sandbox-files"

export type UploadTaskStatus =
  | "uploading"
  | "succeeded"
  | "failed"
  | "canceled"

export type UploadTask = {
  id: string
  directory: string
  fileName: string
  mimeType: string
  size: number
  progress: number
  status: UploadTaskStatus
  error?: string
}

export type UploadBatchResult = {
  results: UploadResult[]
  total: number
  succeeded: number
  failed: number
  canceled: number
}

export type UploadBatchHandle = {
  cancel: () => void
  taskIds: string[]
  completion: Promise<UploadBatchResult>
}
export type UploadResult =
  | { status: "succeeded"; file: UploadedFile }
  | { status: "failed"; error: string }
  | { status: "canceled" }

export type UploadBatchOptions = {
  purpose?: "attachment"
  onProgress?: (index: number, progress: number) => void
}
