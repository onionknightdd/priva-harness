const FILE_API_PREFIX = "/api/sandbox/files"

export type FileSystemEntryType = "file" | "directory"

export type FileSystemEntry = {
  path: string
  name: string
  type: FileSystemEntryType
  size: number | null
  modified: number | null
  permissions: string | null
}

export type FileSystemDirectory = {
  path: string
  parent: string | null
  entries: FileSystemEntry[]
}

export type FilePreviewResponse = {
  path: string
  name: string
  mime_type: string
  size: number
  content: string | null
  is_binary: boolean
  preview_url: string | null
}

type CreatedDirectory = {
  path: string
  name: string
}

type DeletedPath = {
  status: "ok"
  path: string
}

type UploadedFile = {
  status: "ok"
  path: string
  name: string
  size: number
}

type ErrorResponse = {
  detail?: string
}

export class FileBrowserApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "FileBrowserApiError"
    this.status = status
  }
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)

  if (!response.ok) {
    let detail = response.statusText || `HTTP ${response.status}`

    try {
      const error = (await response.json()) as ErrorResponse
      if (error.detail) {
        detail = error.detail
      }
    } catch {
      // Keep the HTTP status text when the response has no JSON body.
    }

    throw new FileBrowserApiError(response.status, detail)
  }

  return (await response.json()) as T
}

function withPath(endpoint: string, path: string) {
  return `${FILE_API_PREFIX}${endpoint}?${new URLSearchParams({ path })}`
}

export function listDirectory(path?: string) {
  const query = path === undefined ? "" : `?${new URLSearchParams({ path })}`
  return requestJson<FileSystemDirectory>(`${FILE_API_PREFIX}/list${query}`)
}

export function previewFile(path: string) {
  return requestJson<FilePreviewResponse>(withPath("/preview", path))
}

export function createDirectory(directory: string, name: string) {
  return requestJson<CreatedDirectory>(`${FILE_API_PREFIX}/mkdir`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ directory, name }),
  })
}

export function uploadFile(directory: string, file: File) {
  const body = new FormData()
  body.append("directory", directory)
  body.append("file", file, file.name)

  return requestJson<UploadedFile>(`${FILE_API_PREFIX}/upload`, {
    method: "POST",
    body,
  })
}

export function deletePath(path: string) {
  return requestJson<DeletedPath>(withPath("", path), {
    method: "DELETE",
  })
}

export function getDownloadUrl(path: string) {
  return withPath("/download", path)
}

export function startFileDownload(path: string, fileName: string) {
  const anchor = document.createElement("a")
  anchor.href = getDownloadUrl(path)
  anchor.download = fileName
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}
