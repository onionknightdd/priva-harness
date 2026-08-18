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
  total: number
  succeeded: number
  failed: number
  canceled: number
}

export type UploadBatchHandle = {
  taskIds: string[]
  completion: Promise<UploadBatchResult>
}
